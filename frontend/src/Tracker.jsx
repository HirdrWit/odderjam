import {useState} from 'react';

import {SortTh, useSort} from './SortTable.jsx';
import {TabIntro} from './TabIntro.jsx';
import {Term} from './Term.jsx';
import {trackerEmptyText} from './empty.js';
import {errorDetail, postJson, toast, useApi, useStored} from './hooks.jsx';
import {eventTime, money, percent, signClass} from './fmt.js';
import {formatOdds} from './odds.js';
import {oddsKey} from './sorttable.js';
import {
  PROFIT, betFormError, calendarWeeks, chartNote, chartReady, clvTileText, filterQuery, latestMonth, plColor,
  scaleSeries, statusClass,
} from './tracker.js';

// Field names such as `closing_odds` and `roi_pct` come straight from the
// backend's JSON API, so they keep the backend's snake_case.

function formatMoney(amount) {
  return money(amount);
}

function formatSigned(amount) {
  return money(amount, {signed: true});
}

function formatPct(value) {
  return percent(value);
}

/** Returns 's' when `count` is more than one. */
function plural(count) {
  return count > 1 ? 's' : '';
}

const STRATEGIES = {ev: '+EV', arb: 'Arb', promo: 'Promo', middle: 'Middle', manual: 'Manual'};
const PICKABLE_STRATEGIES = Object.entries(STRATEGIES).filter(([k]) => k !== 'manual');
const MARKETS = {moneyline: 'Moneyline', spreads: 'Spread', totals: 'Total'};
const STATUSES = ['pending', 'won', 'lost', 'push', 'void'];
const BLANK_BET = {
  event: '',
  sport: '',
  market: 'moneyline',
  strategy: '',
  pick: '',
  book: '',
  odds: '',
  stake: '',
  closing_odds: '',
  status: 'pending',
  is_bonus: false,
};
/** Stat tiles whose label is glossary jargon, by tile label. */
const TILE_TERMS = {'Avg CLV': 'clv', 'Sharp CLV': 'sharp-clv'};
const NO_FILTERS = {date_from: '', date_to: '', status: '', sport: '', book: '', strategy: ''};
const DAYS_OF_WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const CHART_WIDTH = 640;
const CHART_HEIGHT = 170;

function ProfitChart({daily}) {
  const [hover, setHover] = useState(null);
  if (!daily.length) return null;
  const {points, zeroY} = scaleSeries(daily, CHART_WIDTH, CHART_HEIGHT, 8);
  const last = daily[daily.length - 1];
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * CHART_WIDTH;
    let best = 0;
    points.forEach(([px], i) => {
      if (Math.abs(px - x) < Math.abs(points[best][0] - x)) best = i;
    });
    setHover(best);
  };
  const day = hover != null && daily[hover];
  const label = `Cumulative profit from ${daily[0].date} to ${last.date}, ending at ` +
      formatSigned(last.cumulative);
  return (
    <div className="card chart">
      <div className="mut">
        Cumulative profit · {formatSigned(last.cumulative)} over {daily.length} day{plural(daily.length)}
      </div>
      <div className="plot">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" onMouseMove={move}
          onMouseLeave={() => {
            setHover(null);
          }} role="img" aria-label={label}>
          <line x1="0" x2={CHART_WIDTH} y1={zeroY} y2={zeroY} className="zero" />
          <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke={PROFIT}
            strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {day && (
            <line x1={points[hover][0]} x2={points[hover][0]} y1="0" y2={CHART_HEIGHT}
              className="cross" />
          )}
        </svg>
        {day && <span className="dot" style={{
          left: `${(points[hover][0] / CHART_WIDTH) * 100}%`,
          top: `${(points[hover][1] / CHART_HEIGHT) * 100}%`,
        }} />}
        {day && (
          <div className="tip" style={{left: `${Math.min(80, (points[hover][0] / CHART_WIDTH) * 100)}%`}}>
            <b>{day.date}</b>
            <div>Day {formatSigned(day.profit)} · {day.bets} bet{plural(day.bets)}</div>
            <div>Total {formatSigned(day.cumulative)}</div>
          </div>
        )}
      </div>
      <div className="axis mut"><span>{daily[0].date}</span><span>{last.date}</span></div>
    </div>
  );
}

function Calendar({daily}) {
  const [openYear, openMonth] = latestMonth(daily, new Date().toISOString().slice(0, 10));
  const openKey = `${openYear}-${openMonth}`;
  // The user's navigation applies only until the latest month with bets changes.
  const [nav, setNav] = useState({key: openKey, ym: null});
  const yearMonth = nav.key === openKey ? nav.ym : null;
  const [year, month] = yearMonth || [openYear, openMonth];
  const [hover, setHover] = useState(null);
  const byDay = Object.fromEntries(daily.map((d) => [d.date, d]));
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthDays = daily.filter((d) => d.date.startsWith(prefix));
  const maxAbs = Math.max(0, ...monthDays.map((d) => Math.abs(d.profit)));
  const total = monthDays.reduce((s, d) => s + d.profit, 0);
  const shift = (k) => {
    const d = new Date(Date.UTC(year, month + k, 1));
    setNav({key: openKey, ym: [d.getUTCFullYear(), d.getUTCMonth()]});
  };
  const hovered = hover && byDay[hover];
  const title = new Date(Date.UTC(year, month, 1)).toLocaleString(
      undefined, {month: 'long', year: 'numeric', timeZone: 'UTC'});
  const summary = monthDays.length ?
      `${formatSigned(total)} · ${monthDays.length} active day${plural(monthDays.length)}` :
      'No settled bets';
  let readout = 'Blue = profit, red = loss (−). Hover a day.';
  if (hovered) {
    readout = `${hover}: ${formatSigned(hovered.profit)} on ${hovered.bets} bet${plural(hovered.bets)}`;
  } else if (hover) {
    readout = `${hover}: no settled bets`;
  }
  return (
    <div className="card chart cal">
      <div className="bar">
        <button className="x" onClick={() => {
          shift(-1);
        }} aria-label="Previous month">◀</button>
        <b>{title}</b>
        <button className="x" onClick={() => {
          shift(1);
        }} aria-label="Next month">▶</button>
        <span className="mut">{summary}</span>
      </div>
      <div className="grid">
        {DAYS_OF_WEEK.map((d, i) => <div key={i} className="dow mut">{d}</div>)}
        {calendarWeeks(year, month).flat().map((cell, i) => {
          if (!cell) return <div key={i} />;
          const d = byDay[cell.date];
          return (
            <div key={i} className={`day${d ? ' on' : ''}`}
              style={d ? {background: plColor(d.profit, maxAbs)} : undefined}
              onMouseEnter={() => {
                setHover(cell.date);
              }}
              onMouseLeave={() => {
                setHover(null);
              }}
              aria-label={d ? `${cell.date}: ${formatSigned(d.profit)}` : cell.date}>
              {cell.day}{d && d.profit < 0 && <i>−</i>}
            </div>
          );
        })}
      </div>
      <div className="mut readout">{readout}</div>
    </div>
  );
}

function GroupTable({title, rows, label = (name) => name}) {
  if (!rows.length) return null;
  return (
    <table className="group">
      <thead>
        <tr><th>{title}</th><th className="num">Bets</th><th className="num">Staked</th><th className="num">Profit</th><th className="num">ROI</th></tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.name}>
            <td>{label(g.name)}</td>
            <td className="num">{g.bets}</td>
            <td className="num">{formatMoney(g.staked)}</td>
            <td className={`num ${signClass(g.profit)}`}>{money(g.profit, {signed: true})}</td>
            <td className={`num ${signClass(g.roi_pct)}`}>{percent(g.roi_pct, {signed: true})}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Serialises a bet form for the API, converting numeric fields. */
function betBody(bet) {
  const closing = bet.closing_odds === '' || bet.closing_odds == null ?
      null :
      Number(bet.closing_odds);
  return {
    ...bet,
    odds: Number(bet.odds),
    stake: Number(bet.stake),
    strategy: bet.strategy || null,
    closing_odds: closing,
  };
}

function BetRow({bet, onPatch, onDelete}) {
  const patchNumber = (field, current) => (e) => {
    const value = e.target.value;
    if (value !== '' && Number(value) !== current) onPatch({[field]: value});
  };
  const patchClosing = (e) => {
    if (e.target.value !== String(bet.closing_odds ?? '')) {
      onPatch({closing_odds: e.target.value});
    }
  };
  const sharpTitle = bet.closing_sharp_odds != null ?
      `Sharp fair close ${formatOdds(bet.closing_sharp_odds)}` :
      '';
  return (
    <tr>
      <td>{eventTime(bet.placed_at)}</td>
      <td>{bet.pick}{bet.is_bonus && <span className="mut" title="Bonus bet"> · bonus</span>}</td>
      <td>{bet.event}</td>
      <td>{bet.book}</td>
      <td className="mut">
        {MARKETS[bet.market] || bet.market}{bet.strategy ? ` · ${STRATEGIES[bet.strategy]}` : ''}
      </td>
      <td className="num">
        <input className="mini" type="number" defaultValue={bet.odds}
          onBlur={patchNumber('odds', bet.odds)} />
      </td>
      <td className="num">
        <input className="mini" type="number" step="0.01" defaultValue={bet.stake}
          onBlur={patchNumber('stake', bet.stake)} />
      </td>
      <td className="num">
        <input className="mini" type="number" defaultValue={bet.closing_odds ?? ''} placeholder="—"
          onBlur={patchClosing} />
      </td>
      <td className={`num ${signClass(bet.clv_pct)}`}>{percent(bet.clv_pct, {signed: true})}</td>
      <td className={`num ${signClass(bet.clv_sharp_pct)}`} title={sharpTitle}>
        {percent(bet.clv_sharp_pct, {signed: true})}
      </td>
      <td>
        <span className={statusClass(bet.status)}>{bet.status}</span>
        <select value={bet.status} aria-label="Change status" onChange={(e) => {
          onPatch({status: e.target.value});
        }}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </td>
      <td className={`num ${signClass(bet.profit)}`}>{money(bet.profit, {signed: true})}</td>
      <td><button className="x" onClick={onDelete}>✕</button></td>
    </tr>
  );
}

function importMessage(result) {
  const skipped = result.errors.length ?
      `, skipped ${result.errors.length} (first: line ${result.errors[0].line})` :
      '';
  return `Imported ${result.imported} bet${result.imported === 1 ? '' : 's'}${skipped}`;
}

const SETTLE_PROMPT =
    'Fetch final scores from The Odds API to settle pending moneyline, spread and total bets?\n' +
    'This costs 2 API credits per sport with pending bets. Props stay manual.';

const BET_COLUMNS = [
  ['date', 'Date', 'desc'], ['pick', 'Pick'], ['event', 'Event'], ['book', 'Book'], ['type', 'Type'],
  ['odds', 'Odds', 'desc'], ['stake', 'Stake', 'desc'], ['close', 'Close', 'desc'],
  ['clv', 'CLV', 'desc'], ['sharpClv', 'Sharp CLV', 'desc'], ['status', 'Status'],
  ['profit', 'P/L', 'desc'],
];
const BET_TERM_LABELS = {
  close: <Term id="closing-odds">ⓘ</Term>,
  clv: <Term id="clv">ⓘ</Term>,
  sharpClv: <Term id="sharp-clv">ⓘ</Term>,
};
const BET_NUM = new Set(['odds', 'stake', 'close', 'clv', 'sharpClv', 'profit']);
const BET_SORT = {
  date: (b) => Date.parse(b.placed_at), pick: (b) => b.pick, event: (b) => b.event, book: (b) => b.book,
  type: (b) => MARKETS[b.market] || b.market, odds: (b) => oddsKey(b.odds), stake: (b) => b.stake,
  close: (b) => (b.closing_odds == null ? null : oddsKey(b.closing_odds)), clv: (b) => b.clv_pct,
  sharpClv: (b) => b.clv_sharp_pct, status: (b) => b.status, profit: (b) => b.profit,
};

/** Tracker tab: logged bets, filters, P/L charts and per-group stats. */
export function Tracker() {
  const [filters, setFilters] = useStored('trackerFilters', NO_FILTERS);
  const query = filterQuery(filters);
  const all = useApi('/api/bets', 600000);
  const bets = useApi(`/api/bets?${query}`, 600000);
  const stats = useApi(`/api/bets/stats?${query}`, 600000);
  const [sort, onSort, sorted] = useSort('Tracker', {key: 'date', dir: 'desc'});
  const [form, setForm] = useState(BLANK_BET);
  const [formError, setFormError] = useState(null);
  // Bumped when an edit is rejected, so the row remounts and shows the stored values again.
  const [rejected, setRejected] = useState(0);
  const [busy, setBusy] = useState(false);
  const reload = () => {
    window.dispatchEvent(new Event('data-changed'));
  };
  const add = async (e) => {
    e.preventDefault();
    const invalid = betFormError(form);
    setFormError(invalid);
    if (invalid) return;
    const response = await postJson('/api/bets', betBody(form));
    if (!response.ok) {
      const detail = await errorDetail(response);
      setFormError(detail || 'Could not add bet');
      toast('Could not add bet', 'err');
      return;
    }
    toast(`Added ${form.pick}`);
    setForm(BLANK_BET);
    reload();
  };
  const patch = async (bet, change) => {
    const response = await postJson(`/api/bets/${bet.id}`, betBody({...bet, ...change}), 'PUT');
    if (!response.ok) {
      const detail = await errorDetail(response);
      toast(`Could not update bet${detail ? `: ${detail}` : ''}`, 'err');
      setRejected((n) => n + 1);
    }
    reload();
  };
  const remove = async (bet) => {
    if (!confirm(`Delete ${bet.pick}?`)) return;
    await fetch(`/api/bets/${bet.id}`, {method: 'DELETE'});
    reload();
  };
  const settle = async () => {
    if (!confirm(SETTLE_PROMPT)) return;
    setBusy(true);
    try {
      const response = await fetch('/api/bets/settle', {method: 'POST'});
      const result = await response.json();
      if (!response.ok) {
        toast(result.detail || 'Auto-settle failed', 'err');
        return;
      }
      toast(result.settled.length ?
          `Settled ${result.settled.length} of ${result.checked} pending bets` :
          `No finished games for ${result.checked} pending bets`);
      reload();
    } finally {
      setBusy(false);
    }
  };
  const importCsv = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const response = await postJson('/api/bets/import', {csv: await file.text()});
    if (!response.ok) {
      toast('Import failed', 'err');
      return;
    }
    const result = await response.json();
    toast(importMessage(result), result.errors.length && !result.imported ? 'err' : 'ok');
    reload();
  };
  const field = (key) => (e) => {
    setForm({...form, [key]: e.target.value});
  };
  const filterField = (key) => (e) => {
    setFilters({...filters, [key]: e.target.value});
  };
  const optionsFor = (key) => {
    const seen = (all || []).map((b) => b[key]).filter(Boolean);
    return [...new Set([...seen, filters[key]].filter(Boolean))].sort();
  };
  const tiles = stats && [
    ['Profit', formatMoney(stats.profit), stats.profit >= 0 ? 'best' : 'bad'],
    ['ROI', formatPct(stats.roi_pct)],
    ['Win rate', formatPct(stats.win_rate_pct)],
    ['Staked', formatMoney(stats.staked)],
    ['Avg CLV', clvTileText(stats.avg_clv_pct, 'clv')],
    ['Sharp CLV', clvTileText(stats.avg_clv_sharp_pct, 'sharp')],
    ['Pending', stats.pending],
  ];
  const strategyOptions = PICKABLE_STRATEGIES.map(([k, v]) => <option key={k} value={k}>{v}</option>);
  const emptyText = trackerEmptyText(all);
  return (
    <>
      <TabIntro tab="Tracker" />
      <div className="bar wrap filters">
        From <input type="date" value={filters.date_from} onChange={filterField('date_from')} />
        To <input type="date" value={filters.date_to} onChange={filterField('date_to')} />
        <select value={filters.status} onChange={filterField('status')}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={filters.sport} onChange={filterField('sport')}>
          <option value="">All sports</option>
          {optionsFor('sport').map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={filters.book} onChange={filterField('book')}>
          <option value="">All books</option>
          {optionsFor('book').map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={filters.strategy} onChange={filterField('strategy')}>
          <option value="">All strategies</option>{strategyOptions}
        </select>
        {query && <button className="x" onClick={() => {
          setFilters(NO_FILTERS);
        }}>Clear</button>}
        <span className="spacer" />
        <button onClick={settle} disabled={busy}>{busy ? 'Settling…' : 'Auto-settle'}</button>
        <a className="btn" href={`/api/bets/export.csv${query ? `?${query}` : ''}`} download>Export CSV</a>
        <label className="btn">
          Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={importCsv} />
        </label>
      </div>
      <div className="tiles">
        {(tiles || []).map(([label, value, cls]) => (
          <div className="card tile" key={label}>
            <div className="mut">{TILE_TERMS[label] ? <Term id={TILE_TERMS[label]}>{label}</Term> : label}</div>
            <b className={`${cls || ''}${value.length > 12 ? ' small' : ''}`}>{value}</b>
          </div>
        ))}
      </div>
      {stats && stats.daily.length > 0 && (
        <div className="charts">
          {chartReady(stats.daily) ?
            <ProfitChart daily={stats.daily} /> :
            <div className="card chart mut">{chartNote(stats.daily)}</div>}
          <Calendar daily={stats.daily} />
        </div>
      )}
      <form className="bar wrap" onSubmit={add}>
        <input placeholder="Pick *" required value={form.pick} onChange={field('pick')} />
        <input placeholder="Event (Away @ Home)" value={form.event} onChange={field('event')} />
        <input placeholder="Sport" value={form.sport} onChange={field('sport')} />
        <select value={form.market} onChange={field('market')}>
          {Object.entries(MARKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="prop">Prop / other</option>
        </select>
        <Term id="strategy">Strategy</Term>
        <select value={form.strategy} onChange={field('strategy')}>
          <option value="">Manual</option>{strategyOptions}
        </select>
        <input placeholder="Book" value={form.book} onChange={field('book')} />
        <input placeholder="Odds *" required type="number" value={form.odds}
          onChange={field('odds')} />
        <input placeholder="Stake *" required type="number" step="0.01" value={form.stake}
          onChange={field('stake')} />
        <label className="chk" title="Bonus bet: stake is not returned, a loss costs $0">
          <input type="checkbox" checked={form.is_bonus} onChange={(e) => {
            setForm({...form, is_bonus: e.target.checked});
          }} /> <Term id="bonus-bet">Bonus bet</Term>
        </label>
        <button className="primary">Add bet</button>
        {formError && <span className="bad" role="alert">{formError}</span>}
      </form>
      <table>
        <thead>
          <tr>
            {BET_COLUMNS.map(([id, label, defaultDir]) => (
              <SortTh key={id} id={id} label={label} sort={sort} onSort={onSort} defaultDir={defaultDir}
                num={BET_NUM.has(id)}>
                {BET_TERM_LABELS[id]}
              </SortTh>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted(bets || [], BET_SORT).map((b) => (
            <BetRow key={`${b.id}-${b.odds}-${b.stake}-${b.closing_odds}-${rejected}`} bet={b}
              onPatch={(change) => {
                patch(b, change);
              }}
              onDelete={() => {
                remove(b);
              }} />
          ))}
        </tbody>
      </table>
      {emptyText && <p className="mut">{emptyText}</p>}
      {stats && (
        <div className="groups">
          <GroupTable title="Strategy" rows={stats.by_strategy}
            label={(n) => STRATEGIES[n] || n} />
          <GroupTable title="Bet type" rows={stats.by_market} label={(n) => MARKETS[n] || n} />
          <GroupTable title="Sport" rows={stats.by_sport} />
          <GroupTable title="Book" rows={stats.by_book} />
        </div>
      )}
    </>
  );
}
