import {useEffect, useState} from 'react';

import {filterCount, filtersLabel} from './cards.js';
import {SortTh, useSort} from './SortTable.jsx';
import {TabIntro} from './TabIntro.jsx';
import {Term} from './Term.jsx';
import {trackerEmptyText} from './empty.js';
import {errorDetail, postJson, toast, useApi, useApiStatus, useStored} from './hooks.jsx';
import {failedText} from './tablestate.js';
import {TableShell} from './TableShell.jsx';
import {eventStartInfo, eventStartSortKey, eventStartToIso} from './eventstart.js';
import {eventTime, impliedPercent, money, percent, signClass} from './fmt.js';
import {americanToProb} from './calc.js';
import {formatOdds} from './odds.js';
import {BAND_COLUMNS, BAND_SORT} from './bands.js';
import {oddsKey} from './sorttable.js';
import {
  ADD_BET_FIELDS, AUTO_SETTLE_KEY, DUE_SETTLE_URL, PROFIT, betFieldErrors, calendarWeeks, chartNote, chartReady, clvTileText, filterQuery, latestMonth, parseOddsInput,
  dueSettleToast, plColor, scaleSeries, shouldAutoSettle, statusClass,
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
  event_start: '',
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

/** Sortable per-band table: profit next to expected profit, plus CLV over bets that have a closing line. */
function BandTable({tab, title, rows}) {
  const [sort, onSort, sorted] = useSort(tab, {key: 'name', dir: 'asc'});
  if (!rows || !rows.length) return null;
  return (
    <table className="group">
      <thead>
        <tr>
          {BAND_COLUMNS.map(([id, label, defaultDir]) => (
            <SortTh key={id} tab={tab} id={id} label={id === 'name' ? title : label} sort={sort} onSort={onSort}
              defaultDir={defaultDir} num={id !== 'name'} />
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted(rows, BAND_SORT).map((g) => (
          <tr key={g.name}>
            <td>{g.name}</td>
            <td className="num">{g.bets}</td>
            <td className="num">{formatMoney(g.staked)}</td>
            <td className={`num ${signClass(g.profit)}`}>{money(g.profit, {signed: true})}</td>
            <td className="num">{money(g.expected_profit, {signed: true})}</td>
            <td className={`num ${signClass(g.roi_pct)}`}>{percent(g.roi_pct, {signed: true})}</td>
            <td className="num">{g.avg_clv == null ? '—' : percent(g.avg_clv, {signed: true})}</td>
            <td className="num">{g.beat_close_pct == null ? '—' : percent(g.beat_close_pct)}</td>
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
    event_start: bet.event_start ? eventStartToIso(bet.event_start) : null,
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
  const start = eventStartInfo(bet.event_start, bet.status);
  const sharpTitle = bet.closing_sharp_odds != null ?
      `Sharp fair close ${formatOdds(bet.closing_sharp_odds)}` :
      '';
  return (
    <tr>
      <td data-label="Placed">{eventTime(bet.placed_at)}</td>
      <td data-label="Event start" title={start.title || undefined}>
        {start.text}
        {start.label && <span className={start.state === 'passed' ? 'bad' : 'mut'}>{start.state === 'passed' ? ' ⚠ ' : ' · '}{start.label}</span>}
      </td>
      <td className="c-pick">{bet.pick}{bet.is_bonus && <span className="mut" title="Bonus bet"> · bonus</span>}</td>
      <td className="c-event">{bet.event}</td>
      <td className="c-book">{bet.book}</td>
      <td className="mut" data-label="Market">
        {MARKETS[bet.market] || bet.market}{bet.strategy ? ` · ${STRATEGIES[bet.strategy]}` : ''}
      </td>
      <td className="num c-odds" data-label="Odds">
        <input className="mini" type="number" defaultValue={bet.odds}
          onBlur={patchNumber('odds', bet.odds)} />
      </td>
      <td className="num" data-label="Implied %">{impliedPercent(bet.odds)}</td>
      <td className="num" data-label="Stake">
        <input className="mini" type="number" step="0.01" defaultValue={bet.stake}
          onBlur={patchNumber('stake', bet.stake)} />
      </td>
      <td className="num" data-label="Close">
        <input className="mini" type="number" defaultValue={bet.closing_odds ?? ''} placeholder="—"
          onBlur={patchClosing} />
      </td>
      <td className={`num ${signClass(bet.clv_pct)}`} data-label="CLV">{percent(bet.clv_pct, {signed: true})}</td>
      <td className={`num ${signClass(bet.clv_sharp_pct)}`} data-label="Sharp CLV" title={sharpTitle}>
        {percent(bet.clv_sharp_pct, {signed: true})}
      </td>
      <td className="c-status">
        <span className={statusClass(bet.status)}>{bet.status}</span>
        <select value={bet.status} aria-label="Change status" onChange={(e) => {
          onPatch({status: e.target.value});
        }}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </td>
      <td className={`num c-pl ${signClass(bet.profit)}`}>{money(bet.profit, {signed: true})}</td>
      <td className="c-actions"><button className="x" aria-label="Delete bet" onClick={onDelete}>✕</button></td>
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
  ['date', 'Date', 'desc'], ['eventStart', 'Event start', 'desc'], ['pick', 'Pick'], ['event', 'Event'], ['book', 'Book'], ['type', 'Type'],
  ['odds', 'Odds', 'desc'], ['implied', 'Implied %', 'desc'], ['stake', 'Stake', 'desc'], ['close', 'Close', 'desc'],
  ['clv', 'CLV', 'desc'], ['sharpClv', 'Sharp CLV', 'desc'], ['status', 'Status'],
  ['profit', 'P/L', 'desc'],
];
const BET_TERM_LABELS = {
  implied: <Term id="win-probability">ⓘ</Term>,
  close: <Term id="closing-odds">ⓘ</Term>,
  clv: <Term id="clv">ⓘ</Term>,
  sharpClv: <Term id="sharp-clv">ⓘ</Term>,
};
const BET_NUM = new Set(['odds', 'implied', 'stake', 'close', 'clv', 'sharpClv', 'profit']);
const BET_SORT = {
  date: (b) => Date.parse(b.placed_at), eventStart: (b) => eventStartSortKey(b), pick: (b) => b.pick, event: (b) => b.event, book: (b) => b.book,
  type: (b) => MARKETS[b.market] || b.market, odds: (b) => oddsKey(b.odds), implied: (b) => (Number.isFinite(b.odds) && Math.abs(b.odds) >= 100 ? americanToProb(b.odds) : null), stake: (b) => b.stake,
  close: (b) => (b.closing_odds == null ? null : oddsKey(b.closing_odds)), clv: (b) => b.clv_pct,
  sharpClv: (b) => b.clv_sharp_pct, status: (b) => b.status, profit: (b) => b.profit,
};

/** Tracker tab: logged bets, filters, P/L charts and per-group stats. */
export function Tracker() {
  const [filters, setFilters] = useStored('trackerFilters', NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = filterQuery(filters);
  // No error state: `all` only feeds the filter dropdowns; the filtered list below has its own Couldn't load + Retry.
  const all = useApi('/api/bets', 600000);
  const {data: bets, refreshing: betsRefreshing, error: betsError, retry: betsRetry} = useApiStatus(`/api/bets?${query}`, 600000);
  const {data: stats, error: statsError, retry: statsRetry} = useApiStatus(`/api/bets/stats?${query}`, 600000);
  const statsFailed = failedText({data: stats, error: statsError, what: 'bet stats'});
  const [sort, onSort, sorted] = useSort('Tracker', {key: 'date', dir: 'desc'});
  const [form, setForm] = useState(BLANK_BET);
  const [format] = useStored('oddsFormat', 'american');
  const [showForm, setShowForm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  // Bumped when an edit is rejected, so the row remounts and shows the stored values again.
  const [rejected, setRejected] = useState(0);
  const [busy, setBusy] = useState(false);
  const reload = () => {
    window.dispatchEvent(new Event('data-changed'));
  };
  const add = async (e) => {
    e.preventDefault();
    const errors = betFieldErrors(form, format);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length) return;
    const response = await postJson('/api/bets', betBody({...form, odds: parseOddsInput(form.odds, format)}));
    if (!response.ok) {
      const detail = await errorDetail(response);
      setFormError(detail || 'Could not add bet');
      toast('Could not add bet', 'err');
      return;
    }
    toast(`Added ${form.pick}`);
    setForm(BLANK_BET);
    setShowForm(false);
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
    try {
      const response = await fetch(`/api/bets/${bet.id}`, {method: 'DELETE'});
      if (!response.ok) throw new Error('delete failed');
    } catch {
      toast(`Could not delete ${bet.pick}. It is still in the Tracker.`, 'err');
      return;
    }
    reload();
  };
  const [autoSettle] = useStored(AUTO_SETTLE_KEY, true);
  // On open: settle bets whose games have probably finished. No confirm, and failures stay silent.
  useEffect(() => {
    if (!shouldAutoSettle(autoSettle)) return;
    fetch(DUE_SETTLE_URL, {method: 'POST'}).then((response) => (response.ok ? response.json() : null)).then((result) => {
      const text = dueSettleToast(result);
      if (text) {
        toast(text);
        reload();
      }
    }).catch(() => {});
  }, []);
  const settle = async () => {
    if (!confirm(SETTLE_PROMPT)) return;
    setBusy(true);
    try {
      const response = await fetch('/api/bets/settle', {method: 'POST'});
      if (!response.ok) {
        toast((await errorDetail(response)) || 'Auto-settle failed. Try again in a moment.', 'err');
        return;
      }
      const result = await response.json();
      toast(result.settled.length ?
          `Settled ${result.settled.length} of ${result.checked} pending bets` :
          `No finished games for ${result.checked} pending bets`);
      reload();
    } catch {
      toast('Auto-settle failed. Check your connection and try again.', 'err');
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
      <div className="bar filters">
        <button type="button" className="filters-toggle" aria-expanded={filtersOpen} onClick={() => {
          setFiltersOpen((open) => !open);
        }}>{filtersLabel(filterCount(filters, NO_FILTERS))}</button>
        <span className={`collapsible${filtersOpen ? ' open' : ''}`}>
          <label>From <input type="date" value={filters.date_from} onChange={filterField('date_from')} /></label>
          <label>To <input type="date" value={filters.date_to} onChange={filterField('date_to')} /></label>
          <select aria-label="Status" value={filters.status} onChange={filterField('status')}>
            <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select aria-label="Sport" value={filters.sport} onChange={filterField('sport')}>
            <option value="">All sports</option>
            {optionsFor('sport').map((s) => <option key={s}>{s}</option>)}
          </select>
          <select aria-label="Book" value={filters.book} onChange={filterField('book')}>
            <option value="">All books</option>
            {optionsFor('book').map((s) => <option key={s}>{s}</option>)}
          </select>
          <select aria-label="Strategy" value={filters.strategy} onChange={filterField('strategy')}>
            <option value="">All strategies</option>{strategyOptions}
          </select>
          {query && <button className="x" onClick={() => {
            setFilters(NO_FILTERS);
          }}>Clear</button>}
        </span>
        <span className="spacer" />
        <button onClick={settle} disabled={busy}>{busy ? 'Settling…' : 'Auto-settle'}</button>
        <button className="primary" aria-expanded={showForm} onClick={() => {
          setShowForm((open) => !open);
        }}>{showForm ? 'Close' : 'Add bet'}</button>
        <details className="more">
          <summary aria-label="More actions">⋯</summary>
          <div className="menu">
            <a className="btn" href={`/api/bets/export.csv${query ? `?${query}` : ''}`} download>Export CSV</a>
            <label className="btn">
              Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={importCsv} />
            </label>
          </div>
        </details>
      </div>
      {statsFailed && (
        <div role="alert">
          <div className="bad">{statsFailed}</div>
          <button type="button" onClick={statsRetry}>Retry</button>
        </div>
      )}
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
{showForm && (
        <form className="card addbet" onSubmit={add} noValidate aria-label="Add bet">
          <div className="formgrid">
            {ADD_BET_FIELDS.map((f) => (
              <div className="fld" key={f.key}>
                <label htmlFor={f.id}>
                  {f.key === 'strategy' ? <Term id="strategy">{f.label}</Term> : f.label}
                  {f.required && ' *'}
                </label>
                {f.key === 'market' ? (
                  <select id={f.id} value={form.market} onChange={field('market')}>
                    {Object.entries(MARKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    <option value="prop">Prop / other</option>
                  </select>
                ) : f.key === 'strategy' ? (
                  <select id={f.id} value={form.strategy} onChange={field('strategy')}>
                    <option value="">Manual</option>{strategyOptions}
                  </select>
                ) : (
                  <input id={f.id} value={form[f.key]} onChange={field(f.key)} required={f.required}
                    type={f.key === 'stake' ? 'number' : f.key === 'event_start' ? 'datetime-local' : 'text'} step={f.key === 'stake' ? '0.01' : undefined}
                    inputMode={f.key === 'odds' ? 'decimal' : undefined}
                    aria-invalid={fieldErrors[f.key] ? true : undefined}
                    aria-describedby={fieldErrors[f.key] ? `${f.id}-err` : undefined} />
                )}
                {fieldErrors[f.key] && <span className="bad err" id={`${f.id}-err`} role="alert">{fieldErrors[f.key]}</span>}
              </div>
            ))}
            <div className="fld">
              <label className="chk" htmlFor="bet-bonus" title="Bonus bet: stake is not returned, a loss costs $0">
                <input id="bet-bonus" type="checkbox" checked={form.is_bonus} onChange={(e) => {
                  setForm({...form, is_bonus: e.target.checked});
                }} /> <Term id="bonus-bet">Bonus bet</Term>
              </label>
            </div>
          </div>
          <div className="bar">
            <button className="primary">Save bet</button>
            {formError && <span className="bad" role="alert">{formError}</span>}
          </div>
        </form>
      )}
      <TableShell data={bets} refreshing={betsRefreshing} columns={12} error={betsError} onRetry={betsRetry}
        what="your bets"
        emptyText={emptyText || 'No bets match these filters. Clear a filter to see more.'}>
      <table className="cards">
        <thead>
          <tr>
            {BET_COLUMNS.map(([id, label, defaultDir]) => (
              <SortTh key={id} tab="Tracker" id={id} label={label} sort={sort} onSort={onSort} defaultDir={defaultDir}
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
      </TableShell>
      {stats && (
        <div className="groups">
          <GroupTable title="Strategy" rows={stats.by_strategy}
            label={(n) => STRATEGIES[n] || n} />
          <GroupTable title="Bet type" rows={stats.by_market} label={(n) => MARKETS[n] || n} />
          <GroupTable title="Sport" rows={stats.by_sport} />
          <GroupTable title="Book" rows={stats.by_book} />
          <BandTable tab="TrackerOddsBand" title="Odds band" rows={stats.by_odds_band} />
          <BandTable tab="TrackerEvBand" title="EV band" rows={stats.by_ev_band} />
        </div>
      )}
    </>
  );
}
