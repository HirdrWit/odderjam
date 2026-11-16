import {useState} from 'react';

import {americanToProb} from './calc.js';
import {useApi, useSlip, useStored} from './hooks.js';
import {
  FORMATS,
  allBooks,
  filterEvents,
  formatOdds,
  groupStats,
  isProp,
  lineGroups,
  mainGroup,
  outcomeLabel,
} from './odds.js';

// Field names such as `event_id` and `fetched_at` come straight from the
// backend's JSON API, so they keep the backend's snake_case.

const MARKET_LABELS = {moneyline: 'Moneyline', spreads: 'Spread', totals: 'Total'};
const MARKET_ORDER = Object.keys(MARKET_LABELS);
const SPORTS = ['', 'NBA', 'NFL', 'MLB', 'NHL'];

/** Turns "player_points" into "Points" and "batter_total_bases" into "Total Bases". */
function propName(market) {
  return market.replace(/^(player|batter|pitcher)_/, '').split('_')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
}

function marketLabel(market) {
  if (MARKET_LABELS[market]) return MARKET_LABELS[market];
  if (isProp(market)) return propName(market);
  return market.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function holdText(holdPct) {
  return holdPct == null ? '—' : `${holdPct.toFixed(2)}%`;
}

function holdClass(holdPct) {
  if (holdPct == null) return '';
  if (holdPct <= 0) return 'best';
  return holdPct > 5 ? 'bad' : '';
}

function LineTable({group, books, format, legOf, slip}) {
  const stats = groupStats(group, books);
  const priceClass = (o, i, book) => {
    const best = stats.best[i];
    const isBest = o.prices[book] != null && best && o.prices[book] === best.price;
    const leg = legOf(o);
    return `${isBest ? 'best' : ''}${leg && slip.has(leg) ? ' inslip' : ''}`;
  };
  const togglePrice = (o, book) => {
    const leg = legOf(o);
    if (o.prices[book] != null && leg) slip.toggle(leg);
  };
  const bookCount = stats.bookCount;
  return (
    <table className="odds">
      <thead>
        <tr><th>Line</th><th>Best</th><th>Fair</th>{books.map((b) => <th key={b}>{b}</th>)}</tr>
      </thead>
      <tbody>
        {group.outcomes.map((o, i) => (
          <tr key={`${o.name}${o.point}`}>
            <td>{outcomeLabel(o)}</td>
            <td className="best">
              {stats.best[i] ?
                <>
                  {formatOdds(stats.best[i].price, format)}{' '}
                  <span className="mut small">{stats.best[i].book}</span>
                </> :
                '—'}
            </td>
            <td className="mut">{formatOdds(stats.fair[i], format) || '—'}</td>
            {books.map((b) => (
              <td key={b} className={priceClass(o, i, b)} onClick={() => {
                togglePrice(o, b);
              }}>
                {formatOdds(o.prices[b], format)}
              </td>
            ))}
          </tr>
        ))}
        <tr className="foot">
          <td>Hold at best</td>
          <td className={holdClass(stats.holdPct)}>{holdText(stats.holdPct)}</td>
          <td colSpan={books.length + 1} className="mut small">
            {bookCount ? `Fair = no-vig average of ${bookCount} book${bookCount > 1 ? 's' : ''}` : ''}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// Fixed categorical order (dark mode steps); a book keeps its colour whatever
// else is shown.
const SERIES = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767',
];
const BOOK_ORDER = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'bet365', 'BetRivers', 'Fanatics', 'ESPN BET',
];

function bookColor(book, books) {
  const known = BOOK_ORDER.indexOf(book);
  const index = known >= 0 ?
      known :
      BOOK_ORDER.length + books.filter((x) => !BOOK_ORDER.includes(x)).indexOf(book);
  return SERIES[index % SERIES.length];
}

function shortTime(time) {
  return new Date(time).toLocaleString(
      [], {month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}

// Chart geometry in SVG units: width, height and left/right/top/bottom margins.
const CHART_WIDTH = 420;
const CHART_HEIGHT = 140;
const CHART_LEFT = 44;
const CHART_RIGHT = 8;
const CHART_TOP = 8;
const CHART_BOTTOM = 20;

/** Converts a probability to odds and formats them. */
function formatProb(prob, format) {
  const american = prob >= 0.5 ? -100 * prob / (1 - prob) : 100 * (1 - prob) / prob;
  return formatOdds(american, format);
}

function MoveChart({rows, outcome, label, books, format}) {
  const [hover, setHover] = useState(null);
  const points = rows.filter((r) => r.outcome === outcome && books.includes(r.book));
  if (!points.length) return null;
  const times = [...new Set(points.map((r) => r.fetched_at))].sort();
  const t0 = Date.parse(times[0]);
  const t1 = Date.parse(times[times.length - 1]);
  const probs = points.map((r) => americanToProb(r.price));
  let lo = Math.min(...probs);
  let hi = Math.max(...probs);
  if (hi - lo < 0.02) {
    lo -= 0.01;
    hi += 0.01;
  }
  const x = (t) => {
    if (t1 === t0) return (CHART_LEFT + CHART_WIDTH - CHART_RIGHT) / 2;
    const width = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
    return CHART_LEFT + ((Date.parse(t) - t0) / (t1 - t0)) * width;
  };
  const yProb = (p) => CHART_TOP + ((hi - p) / (hi - lo)) * (CHART_HEIGHT - CHART_TOP - CHART_BOTTOM);
  const y = (american) => yProb(americanToProb(american));
  const shown = books.filter((b) => points.some((r) => r.book === b));
  const atHover = hover && points.filter((r) => r.fetched_at === hover);
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * CHART_WIDTH;
    setHover(times.reduce((a, t) => (Math.abs(x(t) - px) < Math.abs(x(a) - px) ? t : a), times[0]));
  };
  return (
    <div className="move">
      <div className="mut">{label} · price by book</div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} onMouseMove={move} onMouseLeave={() => {
        setHover(null);
      }} role="img" aria-label={`${label} odds over time`}>
        {[hi, (hi + lo) / 2, lo].map((p) => (
          <g key={p}>
            <line x1={CHART_LEFT} x2={CHART_WIDTH - CHART_RIGHT} y1={yProb(p)} y2={yProb(p)}
              className="grid" />
            <text x={CHART_LEFT - 6} y={yProb(p) + 4} textAnchor="end" className="axis">
              {formatProb(p, format)}
            </text>
          </g>
        ))}
        <text x={CHART_LEFT} y={CHART_HEIGHT - 4} className="axis">{shortTime(t0)}</text>
        <text x={CHART_WIDTH - CHART_RIGHT} y={CHART_HEIGHT - 4} textAnchor="end" className="axis">
          {shortTime(t1)}
        </text>
        {hover && (
          <line x1={x(hover)} x2={x(hover)} y1={CHART_TOP} y2={CHART_HEIGHT - CHART_BOTTOM}
            className="cross" />
        )}
        {shown.map((b) => {
          const series = points.filter((r) => r.book === b);
          const color = bookColor(b, books);
          const dots = series.filter((r) => series.length === 1 || r.fetched_at === hover);
          return (
            <g key={b}>
              {series.length > 1 && (
                <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"
                  points={series.map((r) => `${x(r.fetched_at)},${y(r.price)}`).join(' ')} />
              )}
              {(series.length === 1 || hover) && dots.map((r) => (
                <circle key={r.fetched_at} cx={x(r.fetched_at)} cy={y(r.price)} r="4" fill={color}
                  stroke="#161c24" strokeWidth="2" />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {shown.map((b) => <span key={b}><i style={{background: bookColor(b, books)}} />{b}</span>)}
      </div>
      {atHover && (
        <div className="tip">
          {new Date(hover).toLocaleString()} ·{' '}
          {atHover.map((r) => `${r.book} ${formatOdds(r.price, format)}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function LineMovement({event, books, format}) {
  const rows = useApi(`/api/history/${encodeURIComponent(event.id)}?market=moneyline`, 300000);
  if (!event.markets.moneyline || !rows) return null;
  if (!rows.length) return <div className="mut">No price history yet.</div>;
  return (
    <div className="moves">
      <MoveChart rows={rows} outcome={event.away} label={event.away} books={books} format={format} />
      <MoveChart rows={rows} outcome={event.home} label={event.home} books={books} format={format} />
    </div>
  );
}

function BookPicker({books, hidden, setHidden}) {
  const toggle = (book) => {
    setHidden(hidden.includes(book) ? hidden.filter((x) => x !== book) : [...hidden, book]);
  };
  return (
    <div className="subnav">
      {books.map((b) => (
        <button key={b} className={hidden.includes(b) ? '' : 'on'} onClick={() => {
          toggle(b);
        }}>{b}</button>
      ))}
      <button onClick={() => {
        setHidden([]);
      }}>All</button>
      <button onClick={() => {
        setHidden(books);
      }}>None</button>
    </div>
  );
}

function EventCard({event, market, books, format, slip, isOpen, onToggle, eventMarket, onPickMarket}) {
  const m = eventMarket && event.markets[eventMarket] ? eventMarket : market;
  const outs = event.markets[m] || [];
  const groups = lineGroups(m, outs, event.home, event.away);
  const main = mainGroup(groups, books);
  const mainStats = main && groupStats(main, books);
  const bestSummary = main && main.outcomes.map((o, i) => {
    const best = mainStats.best[i];
    return `${outcomeLabel(o)} ${best ? formatOdds(best.price, format) : '—'}`;
  }).join(' · ');
  const legOf = (o) => {
    if (isProp(m)) return null;
    return {
      event_id: event.id,
      event: `${event.away} @ ${event.home}`,
      sport: event.sport,
      market: m,
      name: o.name,
      point: o.point,
      pick: outcomeLabel(o),
    };
  };
  return (
    <div className="card" onClick={onToggle}>
      <b>{event.away} @ {event.home}</b>{' '}
      <span className="mut">{event.sport} · {new Date(event.start).toLocaleString()}</span>
      <div className="mut">
        {!main ? `No ${marketLabel(m).toLowerCase()} odds` : (
          <>
            {marketLabel(m)} best: {bestSummary}
            {' · '}hold <span className={holdClass(mainStats.holdPct)}>{holdText(mainStats.holdPct)}</span>
            {groups.length > 1 && ` · ${groups.length} lines`}
          </>
        )}
      </div>
      {isOpen && (
        <div onClick={(e) => {
          e.stopPropagation();
        }} className="detail">
          <div className="subnav">
            {Object.keys(event.markets).map((k) => (
              <button key={k} className={k === m ? 'on' : ''} onClick={() => {
                onPickMarket(k);
              }}>{marketLabel(k)}</button>
            ))}
          </div>
          {!isProp(m) && <div className="mut small">Click a price to add it to the parlay slip.</div>}
          {groups.map((g) => (
            <LineTable key={`${g.player ?? ''}${g.point}`} group={g} books={books} format={format}
              slip={slip} legOf={legOf} />
          ))}
          <LineMovement event={event} books={books} format={format} />
        </div>
      )}
    </div>
  );
}

/** Odds Screen tab: every book's prices per event, with best price, hold and fair odds. */
export function OddsScreen() {
  const [sport, setSport] = useStored('oddsSport', '');
  const [market, setMarket] = useStored('oddsMarket', 'moneyline');
  const [format, setFormat] = useStored('oddsFormat', 'american');
  const [hidden, setHidden] = useStored('oddsHiddenBooks', []);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const [eventMarket, setEventMarket] = useState({});
  const [showBooks, setShowBooks] = useState(false);
  const slip = useSlip();
  const data = useApi(`/api/odds${sport ? `?sport=${sport}` : ''}`) || [];

  const books = allBooks(data);
  const shown = books.filter((b) => !hidden.includes(b));
  const markets = [...new Set([...MARKET_ORDER, ...data.flatMap((e) => Object.keys(e.markets))])];
  const events = filterEvents(data, query);

  return (
    <>
      <div className="bar wrap">
        <select value={sport} onChange={(e) => {
          setSport(e.target.value);
        }}>
          {SPORTS.map((s) => <option key={s} value={s}>{s || 'All sports'}</option>)}
        </select>
        <input className="search" placeholder="Search team" value={query} onChange={(e) => {
          setQuery(e.target.value);
        }} />
        <select value={format} onChange={(e) => {
          setFormat(e.target.value);
        }}>
          {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="chip" onClick={() => {
          setShowBooks(!showBooks);
        }}>Books ({shown.length}/{books.length})</button>
      </div>
      {showBooks && <BookPicker books={books} hidden={hidden} setHidden={setHidden} />}
      <div className="subnav">
        {markets.map((m) => (
          <button key={m} className={m === market ? 'on' : ''} onClick={() => {
            setMarket(m);
            setEventMarket({});
          }}>{marketLabel(m)}</button>
        ))}
      </div>
      {!shown.length && <div className="mut">No books selected.</div>}
      {events.length === 0 && data.length > 0 && <div className="mut">No events match “{query}”.</div>}
      {shown.length > 0 && events.map((e) => (
        <EventCard key={e.id} event={e} market={market} books={shown} format={format} slip={slip}
          isOpen={open === e.id} eventMarket={eventMarket[e.id]}
          onToggle={() => {
            setOpen(open === e.id ? null : e.id);
          }}
          onPickMarket={(k) => {
            setEventMarket({...eventMarket, [e.id]: k});
          }} />
      ))}
    </>
  );
}
