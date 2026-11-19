import {Fragment, useState} from 'react';

import {eventTime, percent} from './fmt.js';
import {sideWinText} from './winprob.js';
import {americanToProb} from './calc.js';
import {useApi, useApiStatus, useSlip, useStored} from './hooks.js';
import {failedText} from './tablestate.js';
import {toast} from './hooks.jsx';
import {booksHelp, holdClass, introVisible, slipToast, suspectNote} from './oddsrow.js';
import {TabIntro} from './TabIntro.jsx';
import {Term} from './Term.jsx';
import {slipLeg} from './slip.js';
import {historyQuery} from './linemove.js';
import {
  FORMATS,
  ageText,
  allBooks,
  filterEvents,
  formatOdds,
  gridRows,
  isProp,
  splitLive,
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
  return percent(holdPct, {digits: 2, signed: true});
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
  return eventTime(time);
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

export function MoveChart({rows, outcome, label, books, format}) {
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
          {eventTime(hover)} ·{' '}
          {atHover.map((r) => `${r.book} ${formatOdds(r.price, format)}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function LineMovement({event, books, format}) {
  const {data: rows, error, retry} = useApiStatus(`/api/history/${encodeURIComponent(event.id)}?market=moneyline`, 300000);
  if (!event.markets.moneyline) return null;
  const failed = failedText({data: rows, error, what: 'price history'});
  if (failed) {
    return (
      <div role="alert">
        <span className="bad">{failed}</span> <button type="button" onClick={retry}>Retry</button>
      </div>
    );
  }
  if (!rows) return null;
  if (!rows.length) return <div className="mut">No price history yet.</div>;
  return (
    <div className="moves">
      <MoveChart rows={rows} outcome={event.away} label={event.away} books={books} format={format} />
      <MoveChart rows={rows} outcome={event.home} label={event.home} books={books} format={format} />
    </div>
  );
}

/** History chart for one +EV row: the bet book and each sharp, for the row's side. */
export function RowHistory({row, format}) {
  const {data: rows, error, retry} = useApiStatus(
      `/api/history/${encodeURIComponent(row.event_id)}?${historyQuery(row)}`, 300000);
  const failed = failedText({data: rows, error, what: 'price history'});
  if (failed) {
    return (
      <div role="alert">
        <span className="bad">{failed}</span> <button type="button" onClick={retry}>Retry</button>
      </div>
    );
  }
  if (!rows) return null;
  const books = [row.book, ...row.sharps.map((s) => s.book)];
  if (!rows.some((r) => r.outcome === row.selection && books.includes(r.book))) {
    return <div className="mut">No price history yet.</div>;
  }
  return (
    <div className="moves">
      <MoveChart rows={rows} outcome={row.selection} label={row.pick} books={books} format={format} />
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

function GameRows({event, market, books, format, slip, historyOpen, onHistory}) {
  const rows = gridRows(event, market, books);
  if (!rows.length) return null;
  const togglePrice = (side, book) => {
    const leg = slipLeg(event, market, side.outcome, book);
    if (side.prices[book] == null || !leg) return;
    const added = !slip.has(leg);
    slip.toggle(leg);
    const t = slipToast(added, slip.slip.length + (added ? 1 : -1));
    toast(t.text, t.kind, t.action);
  };
  const span = books.length + 5;
  return (
    <tbody className={`game${rows.some((r) => r.suspect) ? ' suspect' : ''}`}>
      {rows.map((row, r) => row.sides.map((side, i) => {
        const leg = slipLeg(event, market, side.outcome);
        return (
          <tr key={`${row.key}${i}`} className={i === 0 ? 'first' : ''}>
            {r === 0 && i === 0 && (
              <th scope="row" className="gamecol" rowSpan={rows.reduce((n, x) => n + x.sides.length, 0)}>
                {event.live && <><span className="badge live">LIVE</span>{' '}</>}
                <b>{event.away} @ {event.home}</b>
                <div className="mut small">{event.sport} · {eventTime(event.start)} · prices {ageText(event.price_age_seconds)} old</div>
                {rows.map((hr) => (
                  <div key={hr.key} className="mut small hold">
                    <Term id="hold">Hold</Term> at best <span className={holdClass(hr.holdPct, hr.suspect)}>{holdText(hr.holdPct)}</span>
                    {hr.suspect && <> · {suspectNote()}</>}
                  </div>
                ))}
                {row.extraLines > 0 && <div className="mut small">Main line of {row.extraLines + 1}</div>}
                {market === 'moneyline' && event.markets.moneyline && (
                  <button className="chip" aria-expanded={historyOpen} onClick={onHistory}>Price history</button>
                )}
              </th>
            )}
            <td className="line">{row.player && i === 0 ? <div className="mut small">{row.player}</div> : null}{side.label}</td>
            <td className="num">
              {side.best ? <>{formatOdds(side.best.price, format)}{' '}<span className="mut small">{side.best.book}</span></> : '—'}
            </td>
            <td className="mut num">{formatOdds(side.fair, format) || '—'}</td>
            <td className="mut num">{sideWinText(side.fair)}</td>
            {books.map((b) => (
              <td key={b} className={`num${side.isBest[b] ? ' bestcell' : ''}${leg && slip.has(slipLeg(event, market, side.outcome, b)) ? ' inslip' : ''}`}
                onClick={() => {
                  togglePrice(side, b);
                }}>
                {formatOdds(side.prices[b], format)}
              </td>
            ))}
          </tr>
        );
      }))}
      {historyOpen && (
        <tr><td colSpan={span}><LineMovement event={event} books={books} format={format} /></td></tr>
      )}
    </tbody>
  );
}

function GameGrid({events, market, books, format, slip, history, setHistory}) {
  return (
    <div className="gridwrap">
      <table className="odds grid">
        <thead>
          <tr>
            <th className="gamecol">Game</th><th>Line</th><th className="num">Best</th>
            <th className="num"><Term id="fair-odds">Fair</Term></th>
            <th className="num"><Term id="win-probability">Win %</Term></th>
            {books.map((b) => <th key={b} className="num">{b}</th>)}
          </tr>
        </thead>
        {events.map((e) => (
          <GameRows key={e.id} event={e} market={market} books={books} format={format} slip={slip}
            historyOpen={history === e.id}
            onHistory={() => {
              setHistory(history === e.id ? null : e.id);
            }} />
        ))}
      </table>
    </div>
  );
}

/** Odds Screen tab: a games x books grid with best price, hold and fair odds. */
export function OddsScreen({welcome = false}) {
  const [sport, setSport] = useStored('oddsSport', '');
  const [market, setMarket] = useStored('oddsMarket', 'moneyline');
  const [format, setFormat] = useStored('oddsFormat', 'american');
  const [hidden, setHidden] = useStored('oddsHiddenBooks', []);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState(null);
  const [showBooks, setShowBooks] = useState(false);
  const slip = useSlip();
  const {data: loaded, error, retry} = useApiStatus(`/api/odds${sport ? `?sport=${sport}` : ''}`);
  const data = loaded || [];

  const books = allBooks(data);
  const shown = books.filter((b) => !hidden.includes(b));
  const markets = [...new Set([...MARKET_ORDER, ...data.flatMap((e) => Object.keys(e.markets))])];
  const events = filterEvents(data, query);
  const {live, upcoming} = splitLive(events);

  return (
    <>
      {introVisible(welcome) && <TabIntro tab="Odds Screen" />}
      <div className="bar wrap">
        <select value={sport} onChange={(e) => {
          setSport(e.target.value);
        }}>
          {SPORTS.map((s) => <option key={s} value={s}>{s || 'All sports'}</option>)}
        </select>
        <input className="search" placeholder="Search team" value={query} onChange={(e) => {
          setQuery(e.target.value);
        }} />
        <Term id="american-odds">American</Term> / <Term id="decimal-odds">decimal</Term> odds
        <select value={format} onChange={(e) => {
          setFormat(e.target.value);
        }}>
          {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="chip" title={booksHelp(shown.length, books.length)} onClick={() => {
          setShowBooks(!showBooks);
        }}>Books ({shown.length}/{books.length})</button>
      </div>
      {showBooks && <div className="mut small">{booksHelp(shown.length, books.length)}</div>}
      {showBooks && <BookPicker books={books} hidden={hidden} setHidden={setHidden} />}
      <div className="subnav">
        {markets.map((m) => (
          <button key={m} className={m === market ? 'on' : ''} onClick={() => {
            setMarket(m);
          }}>{marketLabel(m)}</button>
        ))}
      </div>
      {error && !loaded && (
        <div role="alert">
          <div className="bad">Couldn't load odds. {error}</div>
          <button type="button" onClick={retry}>Retry</button>
        </div>
      )}
      {!shown.length && !error && <div className="mut">No books selected.</div>}
      {events.length === 0 && data.length > 0 && <div className="mut">No events match “{query}”.</div>}
      {shown.length > 0 && [['Live', live], ['Upcoming', upcoming]].map(([title, list]) => list.length > 0 && (
        <Fragment key={title}>
          <h3 className="section">{title}</h3>
          <GameGrid events={list} market={market} books={shown} format={format} slip={slip}
            history={history} setHistory={setHistory} />
        </Fragment>
      ))}
    </>
  );
}
