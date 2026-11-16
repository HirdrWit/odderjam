import React, { useState } from 'react';
import { useStored, useApi, useSlip } from './hooks.js';
import { americanToProb } from './calc.js';
import { FORMATS, formatOdds, isProp, outcomeLabel, lineGroups, groupStats, mainGroup, filterEvents, allBooks } from './odds.js';

const MARKET_LABELS = { moneyline: 'Moneyline', spreads: 'Spread', totals: 'Total' };
const ORDER = Object.keys(MARKET_LABELS);
// "player_points" -> "Points", "batter_total_bases" -> "Total Bases"
const propName = (k) => k.replace(/^(player|batter|pitcher)_/, '').split('_')
  .filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');
function marketLabel(k) {
  if (MARKET_LABELS[k]) return MARKET_LABELS[k];
  return isProp(k) ? propName(k) : k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function holdText(h) {
  return h == null ? '—' : `${h.toFixed(2)}%`;
}

function holdClass(h) {
  if (h == null) return '';
  if (h <= 0) return 'best';
  return h > 5 ? 'bad' : '';
}

function LineTable({ group, books, format, legOf, slip }) {
  const s = groupStats(group, books);
  return (
    <table className="odds">
      <thead><tr><th>Line</th><th>Best</th><th>Fair</th>{books.map((b) => <th key={b}>{b}</th>)}</tr></thead>
      <tbody>
        {group.outcomes.map((o, i) => (
          <tr key={`${o.name}${o.point}`}>
            <td>{outcomeLabel(o)}</td>
            <td className="best">{s.best[i] ? <>{formatOdds(s.best[i].price, format)} <span className="mut small">{s.best[i].book}</span></> : '—'}</td>
            <td className="mut">{formatOdds(s.fair[i], format) || '—'}</td>
            {books.map((b) => (
              <td key={b}
                className={`${o.prices[b] != null && s.best[i] && o.prices[b] === s.best[i].price ? 'best' : ''}${legOf(o) && slip.has(legOf(o)) ? ' inslip' : ''}`}
                onClick={() => o.prices[b] != null && legOf(o) && slip.toggle(legOf(o))}>
                {formatOdds(o.prices[b], format)}
              </td>
            ))}
          </tr>
        ))}
        <tr className="foot"><td>Hold at best</td><td className={holdClass(s.holdPct)}>{holdText(s.holdPct)}</td>
          <td colSpan={books.length + 1} className="mut small">{s.bookCount ? `Fair = no-vig average of ${s.bookCount} book${s.bookCount > 1 ? 's' : ''}` : ''}</td></tr>
      </tbody>
    </table>
  );
}

// Fixed categorical order (dark mode steps); a book keeps its colour whatever else is shown.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const BOOK_ORDER = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'bet365', 'BetRivers', 'Fanatics', 'ESPN BET'];
function bookColor(b, books) {
  const i = BOOK_ORDER.indexOf(b);
  return SERIES[(i >= 0 ? i : BOOK_ORDER.length + books.filter((x) => !BOOK_ORDER.includes(x)).indexOf(b)) % SERIES.length];
}
const shortTime = (t) => new Date(t).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function MoveChart({ rows, outcome, label, books, format }) {
  const [hover, setHover] = useState(null);
  const W = 420, H = 140, L = 44, R = 8, T = 8, B = 20;
  const pts = rows.filter((r) => r.outcome === outcome && books.includes(r.book));
  if (!pts.length) return null;
  const times = [...new Set(pts.map((r) => r.fetched_at))].sort();
  const t0 = Date.parse(times[0]), t1 = Date.parse(times[times.length - 1]);
  const ps = pts.map((r) => americanToProb(r.price));
  let lo = Math.min(...ps), hi = Math.max(...ps);
  if (hi - lo < 0.02) { lo -= 0.01; hi += 0.01; }
  const x = (t) => (t1 === t0 ? (L + W - R) / 2 : L + ((Date.parse(t) - t0) / (t1 - t0)) * (W - L - R));
  const yp = (p) => T + ((hi - p) / (hi - lo)) * (H - T - B);
  const y = (a) => yp(americanToProb(a));
  const toOdds = (p) => formatOdds(p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p, format);
  const shown = books.filter((b) => pts.some((r) => r.book === b));
  const at = hover && pts.filter((r) => r.fetched_at === hover);
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(times.reduce((a, t) => (Math.abs(x(t) - px) < Math.abs(x(a) - px) ? t : a), times[0]));
  };
  return (
    <div className="move">
      <div className="mut">{label} · price by book</div>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={move} onMouseLeave={() => setHover(null)} role="img"
        aria-label={`${label} odds over time`}>
        {[hi, (hi + lo) / 2, lo].map((p) => (
          <g key={p}><line x1={L} x2={W - R} y1={yp(p)} y2={yp(p)} className="grid" />
            <text x={L - 6} y={yp(p) + 4} textAnchor="end" className="axis">{toOdds(p)}</text></g>
        ))}
        <text x={L} y={H - 4} className="axis">{shortTime(t0)}</text>
        <text x={W - R} y={H - 4} textAnchor="end" className="axis">{shortTime(t1)}</text>
        {hover && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />}
        {shown.map((b) => {
          const s = pts.filter((r) => r.book === b);
          const c = bookColor(b, books);
          return <g key={b}>
            {s.length > 1 && <polyline fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round"
              points={s.map((r) => `${x(r.fetched_at)},${y(r.price)}`).join(' ')} />}
            {(s.length === 1 || hover) && s.filter((r) => s.length === 1 || r.fetched_at === hover).map((r) =>
              <circle key={r.fetched_at} cx={x(r.fetched_at)} cy={y(r.price)} r="4" fill={c} stroke="#161c24" strokeWidth="2" />)}
          </g>;
        })}
      </svg>
      <div className="legend">{shown.map((b) => <span key={b}><i style={{ background: bookColor(b, books) }} />{b}</span>)}</div>
      {at && <div className="tip">{new Date(hover).toLocaleString()} · {at.map((r) => `${r.book} ${formatOdds(r.price, format)}`).join(' · ')}</div>}
    </div>
  );
}

function LineMovement({ e, books, format }) {
  const rows = useApi(`/api/history/${encodeURIComponent(e.id)}?market=moneyline`, 300000);
  if (!e.markets.moneyline || !rows) return null;
  if (!rows.length) return <div className="mut">No price history yet.</div>;
  return (
    <div className="moves">
      <MoveChart rows={rows} outcome={e.away} label={e.away} books={books} format={format} />
      <MoveChart rows={rows} outcome={e.home} label={e.home} books={books} format={format} />
    </div>
  );
}

function BookPicker({ books, hidden, setHidden }) {
  const toggle = (b) => {
    setHidden(hidden.includes(b) ? hidden.filter((x) => x !== b) : [...hidden, b]);
  };
  return (
    <div className="subnav">
      {books.map((b) => <button key={b} className={hidden.includes(b) ? '' : 'on'} onClick={() => toggle(b)}>{b}</button>)}
      <button onClick={() => setHidden([])}>All</button>
      <button onClick={() => setHidden(books)}>None</button>
    </div>
  );
}

export default function OddsScreen() {
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
  const markets = [...new Set([...ORDER, ...data.flatMap((e) => Object.keys(e.markets))])];
  const events = filterEvents(data, query);

  return (
    <>
      <div className="bar wrap">
        <select value={sport} onChange={(e) => setSport(e.target.value)}>
          {['', 'NBA', 'NFL', 'MLB', 'NHL'].map((s) => <option key={s} value={s}>{s || 'All sports'}</option>)}
        </select>
        <input className="search" placeholder="Search team" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="chip" onClick={() => setShowBooks(!showBooks)}>Books ({shown.length}/{books.length})</button>
      </div>
      {showBooks && <BookPicker books={books} hidden={hidden} setHidden={setHidden} />}
      <div className="subnav">
        {markets.map((m) => <button key={m} className={m === market ? 'on' : ''} onClick={() => { setMarket(m); setEventMarket({}); }}>{marketLabel(m)}</button>)}
      </div>
      {!shown.length && <div className="mut">No books selected.</div>}
      {events.length === 0 && data.length > 0 && <div className="mut">No events match “{query}”.</div>}
      {shown.length > 0 && events.map((e) => {
        const m = eventMarket[e.id] && e.markets[eventMarket[e.id]] ? eventMarket[e.id] : market;
        const outs = e.markets[m] || [];
        const groups = lineGroups(m, outs, e.home, e.away);
        const main = mainGroup(groups, shown);
        const ms = main && groupStats(main, shown);
        const isOpen = open === e.id;
        return (
          <div className="card" key={e.id} onClick={() => setOpen(isOpen ? null : e.id)}>
            <b>{e.away} @ {e.home}</b> <span className="mut">{e.sport} · {new Date(e.start).toLocaleString()}</span>
            <div className="mut">
              {!main ? `No ${marketLabel(m).toLowerCase()} odds` : <>
                {marketLabel(m)} best: {main.outcomes.map((o, i) => `${outcomeLabel(o)} ${ms.best[i] ? formatOdds(ms.best[i].price, format) : '—'}`).join(' · ')}
                {' · '}hold <span className={holdClass(ms.holdPct)}>{holdText(ms.holdPct)}</span>
                {groups.length > 1 && ` · ${groups.length} lines`}
              </>}
            </div>
            {isOpen && (
              <div onClick={(ev) => ev.stopPropagation()} className="detail">
                <div className="subnav">
                  {Object.keys(e.markets).map((k) => (
                    <button key={k} className={k === m ? 'on' : ''} onClick={() => setEventMarket({ ...eventMarket, [e.id]: k })}>{marketLabel(k)}</button>
                  ))}
                </div>
                {!isProp(m) && <div className="mut small">Click a price to add it to the parlay slip.</div>}
                {groups.map((g) => (
                  <LineTable key={`${g.player ?? ''}${g.point}`} group={g} books={shown} format={format} slip={slip}
                    legOf={(o) => (isProp(m) ? null : { event_id: e.id, event: `${e.away} @ ${e.home}`, sport: e.sport, market: m, name: o.name, point: o.point, pick: outcomeLabel(o) })} />
                ))}
                <LineMovement e={e} books={shown} format={format} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
