import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';

import './style.css';
import {Calculators} from './Calculators.jsx';
import {RowExample, Th} from './ColumnHelp.jsx';
import {SortBar, SortTh, useSort} from './SortTable.jsx';
import {oddsKey} from './sorttable.js';
import {zeroStakeReason} from './columns.js';
import {parseStakeInput, trackButtonLabel, trackKey, trackStake, trackToast} from './track.js';
import {Glossary} from './Glossary.jsx';
import {Help} from './Help.jsx';
import {GOTO_EVENT, HELP_TAB} from './help.js';
import {OddsScreen} from './OddsScreen.jsx';
import {Pickem} from './Pickem.jsx';
import {SizingBar, sizingQuery, useSizing} from './Sizing.jsx';
import {activeChips, clearFilter, resetFilters, sportsParam} from './evfilters.js';
import {stakingSummary} from './staking.js';
import {TabIntro, WelcomeContext} from './TabIntro.jsx';
import {afterNavigate, initialWelcome} from './onboarding.js';
import {Term} from './Term.jsx';
import {NAV_GROUPS, NAV_SUBTITLES, navLabel} from './navgroups.js';
import {Tracker} from './Tracker.jsx';
import {ruleFormError} from './alerts.js';
import {windowText} from './middles.js';
import {
  alertsEmptyText, arbMinWarning, ARB_TOTAL_NOTE, arbsEmptyText, evEmptyText, LOW_HOLD_DEFAULT_MAX,
  lowHoldEmptyText, middlesEmptyText, sharpEmptyText,
} from './empty.js';
import {legKey, useSlip} from './hooks.js';
import {INDEPENDENT_NOTE, devigLabel, restoredNote, slipLegPriceText, tinyStakeNote} from './slip.js';
import {FILTER_HELP, ROW_ACTION_TIPS, methodLabel, pendingStartText} from './evbar.js';
import {slipToast} from './oddsrow.js';
import {Toaster, errorDetail, postJson, toast, useApi, useStored} from './hooks.jsx';
import {eventTime, money, percent, signClass} from './fmt.js';
import {ageText, isProp} from './odds.js';
import {rowFreshness, showsStrip, stripState} from './freshness.js';
import {dismissWelcome} from './welcome.js';

// Field names such as `age_seconds` and `ev_pct` come straight from the
// backend's JSON API, so they keep the backend's snake_case.

const JSON_HEADERS = {'Content-Type': 'application/json'};

/** Formats American odds with a leading sign. */
function formatOdds(odds) {
  const rounded = Math.round(odds);
  return odds > 0 ? `+${rounded}` : `${rounded}`;
}

/** Returns true if `value` is a key of `options`. */
function isOption(options, value) {
  return value != null && Object.prototype.hasOwnProperty.call(options, value);
}

/** Tells every useApi hook to refetch. */
function notifyDataChanged() {
  window.dispatchEvent(new Event('data-changed'));
}

/** Formats a number to `digits` decimals; "—" when missing. */
function formatNumber(value, digits = 0) {
  return value == null ? '—' : value.toFixed(digits);
}

/**
 * Live-mode state and credit budget (GET/POST /api/live). While live mode is
 * on, refetches the tables every refresh interval.
 */
function useLive() {
  const [status, setStatus] = useState(null);
  // Bumped on a rejected save to remount the inputs with the unchanged settings.
  const [saves, setSaves] = useState(0);
  const load = () => fetch('/api/live').then((r) => r.json()).then(setStatus);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const every = status?.enabled ? Math.max(10, status.interval_seconds) * 1000 : null;
  useEffect(() => {
    if (!every) return undefined;
    const timer = setInterval(() => {
      notifyDataChanged();
      load();
    }, every);
    return () => {
      clearInterval(timer);
    };
  }, [every]);
  const save = async (change) => {
    const response = await fetch('/api/live', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(change),
    });
    if (response.ok) {
      setStatus(await response.json());
    } else {
      setSaves((n) => n + 1);
      load();
    }
  };
  return {status, save, saves};
}

/** Live mode checkbox, shown in the freshness strip. */
function LiveToggle({live}) {
  const {status, save} = live;
  if (!status) return null;
  return (
    <label className="chk">
      <input type="checkbox" checked={status.enabled} onChange={(e) => {
        save({enabled: e.target.checked});
      }} /> Live
      {status.live_events > 0 && <span className="mut small">({status.live_events} live)</span>}
    </label>
  );
}

/** Live-mode budget fields, shown in the settings area. */
function LiveSettings({live}) {
  const {status, save, saves} = live;
  const field = (key, label, min) => (
    <label className="fld">{label}
      <input key={`${key}-${status[key]}-${saves}`} type="number" min={min} defaultValue={status[key]}
        onBlur={(e) => {
          if (e.target.value !== '' && Number(e.target.value) !== status[key]) {
            save({[key]: Number(e.target.value)});
          }
        }} />
    </label>
  );
  if (!status?.enabled) return null;
  return (
    <div className="livebox">
      {field('credits_per_hour', 'Credits/hour cap', 0)}
      {field('interval_seconds', 'Refresh every (s)', 5)}
      {field('max_price_age', 'Max price age (s)', 1)}
      <div className="mut small">
        burn {formatNumber(status.planned_rate)}/h · used {formatNumber(status.used_last_hour)} last hour
        {status.projected_hours != null && ` · ~${formatNumber(status.projected_hours, 1)}h left`}
      </div>
    </div>
  );
}

/** Live badge and price age shown next to the event name in the tool tables. */
function LiveTag({row}) {
  const fresh = rowFreshness(row);
  return (
    <>
      {row.live && <span className="badge live">LIVE</span>}{' '}
      <span className={`age-chip ${fresh.className}`.trim()} aria-label={fresh.label} title={fresh.label}>
        {ageText(row.price_age_seconds)}
      </span>
    </>
  );
}

/** Freshness strip above every price tab: data age, Refresh, Live toggle, and a settings area. */
function FreshnessStrip() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const live = useLive();
  useEffect(() => {
    const load = () => {
      fetch('/api/cache').then((r) => r.json()).then((d) => {
        setInfo(d);
      });
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/refresh', {method: 'POST'});
      setInfo(await response.json());
      notifyDataChanged();
    } finally {
      setBusy(false);
    }
  };
  if (!info) return null;
  const propCount = info.prop_markets?.length ?? 0;
  const state = stripState(info, !!live.status?.enabled);
  return (
    <div className={`fresh-strip${state.stale ? ' stale' : ''}`} role="status">
      <div className="fresh-main">
        <span className="fresh-text">
          {state.stale && <b>Stale · </b>}{state.text}
        </span>
        {info.live && (
          <button onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        )}
        <LiveToggle live={live} />
        <details className="settings">
          <summary>Settings</summary>
          <div className="settings-body">
            {info.remaining != null && <div className="mut">API credits left: {info.remaining}</div>}
            {info.live && <div className="mut small">Each refresh spends API credits</div>}
            {info.live && propCount > 0 && (
              <div className="bad small">
                Player props on ({propCount} markets): each refresh costs about {propCount * 2} more
                credits per game
              </div>
            )}
            <LiveSettings live={live} />
            <AlertWatcher />
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * "Bet" button: opens the sportsbook (deep link to the bet when the feed has
 * one) in a new tab.
 */
function BetLink({href, title}) {
  if (!href) return null;
  return <a className="bet" href={href} title={title} target="_blank" rel="noopener noreferrer">Bet</a>;
}

const MARKETS = {moneyline: 'Moneyline', spreads: 'Spread', totals: 'Total'};

/** Turns "player_points" into "Points" and "batter_total_bases" into "Total Bases". */
function propName(market) {
  return market.replace(/^(player|batter|pitcher)_/, '').split('_')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
}

function marketName(market) {
  return MARKETS[market] || (isProp(market) ? propName(market) : market);
}

const PROP_FILTER = {include: 'Include props', mainlines: 'Mainlines only'};

function propsParam(filter) {
  return filter === 'mainlines' ? '&props=false' : '';
}

function formatMoney(amount) {
  return money(amount);
}
function formatPct(value) {
  return percent(value);
}

const BOOKS = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'bet365', 'BetRivers', 'Fanatics', 'ESPN BET',
  'Hard Rock Bet',
];
// Exchanges and prediction markets: shown where a single leg is placed, not on promo tools.
const EXCHANGE_BOOKS = ['Kalshi', 'Polymarket', 'Novig', 'ProphetX'];
const EV_BOOKS = [...BOOKS, ...EXCHANGE_BOOKS, ''];
const SPORTS = ['', 'NBA', 'NFL', 'MLB', 'NHL'];

function loadEvBook() {
  try {
    return localStorage.getItem('evBook') ?? 'DraftKings';
  } catch {
    // Storage can be unavailable; use the default book.
    return 'DraftKings';
  }
}

function FilterHelp({help}) {
  return <span className="info" title={FILTER_HELP[help]} tabIndex={0} aria-label={FILTER_HELP[help]}> ⓘ</span>;
}

function Bankroll({bank, onSetStart}) {
  const [typed, setTyped] = useState(String(bank.starting));
  useEffect(() => {
    if (typed === '' || Number(typed) === bank.starting) return undefined;
    const timer = setTimeout(() => {
      onSetStart(Number(typed));
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);
  const pending = pendingStartText(typed, bank.starting);
  return (
    <span className="bankroll">
      <FilterHelp help="bankroll" /> Start $<input className="bankroll-start" type="number" min="0" value={typed}
        aria-label="Starting bankroll" onChange={(e) => {
          setTyped(e.target.value);
        }} />
      {' · '}Current <b className={bank.profit >= 0 ? 'best' : 'bad'}>${bank.current.toFixed(2)}</b>
      <span className="mut">
        {' '}({bank.profit >= 0 ? '+' : '-'}${Math.abs(bank.profit).toFixed(2)} P/L){pending && ` ${pending}`}
      </span>
    </span>
  );
}

function SharpWeights({cfg, weights, maxHold, canReset, onWeight, onMaxHold, onReset}) {
  return (
    <div className="bar wrap">
      <Term id="sharp-book">Sharp</Term> weights<FilterHelp help="sharpWeights" /> {cfg.books.map((b) => (
        <span key={b}>
          {b} <input className="mini" type="number" step="0.25" min="0" value={weights[b] ?? 0}
            onChange={(e) => {
              onWeight(b, Number(e.target.value));
            }} />
        </span>
      ))}
      Max sharp <Term id="hold">hold</Term> %<FilterHelp help="maxHold" /> <input className="mini" type="number" step="0.5" value={maxHold}
        onChange={(e) => {
          onMaxHold(Number(e.target.value));
        }} />
      {canReset && <button onClick={onReset}>Reset</button>}
    </div>
  );
}

/**
 * Shows the API's validation message when a list endpoint rejects the query (422) instead of returning rows.
 * @param {{data: *}} props
 */
function ApiError({data}) {
  const detail = data && !Array.isArray(data) ? data.detail : null;
  if (!detail) return null;
  const text = typeof detail === 'string' ? detail :
      detail.map((e) => `${(e.loc || []).slice(-1)[0] ?? ''}: ${e.msg}`).join('; ');
  return <div className="bad">{text}</div>;
}

const ROW_FMT = {odds: (o) => formatOdds(o), money: (m) => formatMoney(m)};

function EmptyState({text}) {
  return text ? <div className="mut">{text}</div> : null;
}

const EV_COLUMNS = [
  ['ev', 'EV%', 'desc'], ['pick', 'Pick'], ['market', 'Market'], ['event', 'Event'], ['book', 'Book'],
  ['odds', 'Odds', 'desc'], ['fair', 'Fair', 'desc'], ['sharps', 'Sharps (hold)'], ['stake', 'Stake', 'desc'],
];
const EV_NUM = new Set(['ev', 'odds', 'fair', 'stake']);
const EV_SORT = {
  ev: (r) => r.ev_pct, pick: (r) => r.pick, market: (r) => marketName(r.market), event: (r) => r.event,
  book: (r) => r.book, odds: (r) => oddsKey(r.odds), fair: (r) => oddsKey(r.fair_odds), sharps: (r) => r.sharps.length,
  stake: (r) => r.stake,
};

function PositiveEv() {
  const [minEv, setMinEv] = useStored('evMin', 1);
  const [method, setMethod] = useStored('evMethod', 'multiplicative');
  const [kelly, setKelly] = useStored('evKelly', 0.25);
  const [props, setProps] = useStored('evProps', 'include');
  const [sport, setSport] = useStored('evSport', '');
  const [panel, setPanel] = useState(null);
  const [book, setBook] = useState(() => loadEvBook());
  const [sort, onSort, sorted] = useSort('+EV', {key: 'ev', dir: 'desc'});
  const bank = useApi('/api/bankroll', 30000);
  const sizing = useSizing();
  // Bumped when a start bankroll is rejected, so the input remounts showing the stored value.
  const [startRejected, setStartRejected] = useState(0);
  const setStart = async (starting) => {
    const response = await postJson('/api/bankroll', {starting}, 'PUT');
    if (!response.ok) {
      toast(response.status === 422 ? 'Starting bankroll must be 0 or more' : 'Could not set bankroll', 'err');
      setStartRejected((n) => n + 1);
    }
    notifyDataChanged();
  };
  const pickBook = (next) => {
    setBook(next);
    try {
      localStorage.setItem('evBook', next);
    } catch {
      // Storage can be unavailable; the choice just is not remembered.
    }
  };
  const setters = {book: pickBook, minEv: setMinEv, sport: setSport, props: setProps};
  const chips = activeChips({book, minEv, sport, props});
  const resetAll = (d) => {
    Object.keys(d).forEach((key) => setters[key](d[key]));
  };
  const [tracked, setTracked] = useState(() => new Set());
  const track = async (row) => {
    let stake = trackStake(row);
    if (stake == null) {
      stake = parseStakeInput(window.prompt(`Suggested stake is $0.00. Stake to log for ${row.pick} @ ${row.book}?`));
      if (stake == null) {
        toast('Not tracked: enter a stake above 0', 'err');
        return;
      }
    }
    const response = await postJson('/api/bets', {
      event: row.event,
      event_id: row.event_id,
      sport: row.sport,
      market: row.market,
      pick: row.pick,
      selection: row.selection,
      point: row.point,
      book: row.book,
      odds: row.odds,
      stake,
      ev_pct: row.ev_pct,
      strategy: 'ev',
      event_start: row.start,
    });
    if (response.ok) {
      const t = trackToast(row, stake);
      toast(t.text, t.kind, t.action);
      setTracked((prev) => new Set(prev).add(trackKey(row)));
    } else {
      toast('Could not track bet', 'err');
    }
    notifyDataChanged();
  };
  const {slip, has, toggle} = useSlip();
  const cfg = useApi('/api/sharps', 600000);
  const [weights, setWeights] = useStored('evSharpWeights', null);
  const [maxHold, setMaxHold] = useStored('evMaxHold', null);
  const sharpWeights = weights ?? cfg?.weights;
  const sharpMaxHold = maxHold ?? cfg?.max_hold;
  const setWeight = (sharpBook, value) => {
    setWeights({...sharpWeights, [sharpBook]: value});
  };
  const sharpSpec = sharpWeights ?
      Object.entries(sharpWeights).filter(([, v]) => v > 0).map(([b, v]) => `${b}:${v}`).join(',') :
      null;
  const query = `book=${encodeURIComponent(book)}&min_ev=${minEv}&method=${method}&kelly=${kelly}` +
      `&sharps=${encodeURIComponent(sharpSpec)}&max_hold=${sharpMaxHold}` +
      `${sizingQuery(sizing)}${propsParam(props)}${sportsParam(sport)}`;
  const data = useApi(cfg && `/api/ev?${query}`);
  return (
    <>
      <TabIntro tab="+EV" />
      <div className="bar filter-bar">
        Book <select value={book} onChange={(e) => {
          pickBook(e.target.value);
        }}>
          {EV_BOOKS.map((b) => <option key={b} value={b}>{b || 'All books'}</option>)}
        </select>
        Min <Term id="ev">EV</Term> % <input type="number" step="0.5" value={minEv} onChange={(e) => {
          setMinEv(Number(e.target.value));
        }} />
        Sport <select value={sport} onChange={(e) => {
          setSport(e.target.value);
        }}>
          {SPORTS.map((x) => <option key={x} value={x}>{x || 'Any sport'}</option>)}
        </select>
        Market <PropsFilter value={props} onChange={setProps} />
        <button type="button" className="link" onClick={() => {
          resetAll(resetFilters());
        }}>Reset</button>
        <button type="button" aria-expanded={panel === 'model'} onClick={() => {
          setPanel(panel === 'model' ? null : 'model');
        }}>Model settings</button>
        <button type="button" aria-expanded={panel === 'staking'} onClick={() => {
          setPanel(panel === 'staking' ? null : 'staking');
        }}>Bankroll &amp; staking</button>
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c.key} type="button" className="chip" aria-label={`Remove filter ${c.label}`} onClick={() => {
              setters[c.key](clearFilter({book, minEv, sport, props}, c.key)[c.key]);
            }}>{c.label} ✕</button>
          ))}
        </div>
      )}
      {panel === 'model' && (
        <div className="panel">
          <div className="bar">
            <Term id="devig">Devig</Term><FilterHelp help="devig" /> <select value={method} onChange={(e) => {
              setMethod(e.target.value);
            }}>
              {(cfg?.methods || [method]).map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
            </select>
          </div>
          {cfg && sharpWeights && (
            <SharpWeights cfg={cfg} weights={sharpWeights} maxHold={sharpMaxHold}
              canReset={Boolean(weights) || maxHold != null} onWeight={setWeight} onMaxHold={setMaxHold}
              onReset={() => {
                setWeights(null);
                setMaxHold(null);
              }} />
          )}
        </div>
      )}
      {panel === 'staking' && (
        <div className="panel bar wrap">
          {bank && <Bankroll key={`${bank.starting}-${startRejected}`} bank={bank} onSetStart={(v) => {
            setStart(v);
          }} />}
          <Term id="kelly">Kelly</Term><FilterHelp help="kelly" /> <input type="number" step="0.05" value={kelly} onChange={(e) => {
            setKelly(Number(e.target.value));
          }} />
          <SizingBar s={sizing} />
        </div>
      )}
      <ApiError data={data} />
      <table>
        <thead>
          <tr>
            {EV_COLUMNS.map(([id, label, defaultDir]) => (
              <SortTh key={id} tab="+EV" id={id} label={label} sort={sort} onSort={onSort} defaultDir={defaultDir}
                num={EV_NUM.has(id)} />
            ))}
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {sorted(Array.isArray(data) ? data : [], EV_SORT).map((r, i) => (
            <tr key={i}>
              <td className={`num ${signClass(r.ev_pct)}`}>{percent(r.ev_pct, {signed: true})}</td>
              <td>{r.pick}</td>
              <td>{marketName(r.market)}</td>
              <td>{r.event} <LiveTag row={r} /></td>
              <td>{r.book}</td>
              <td className="num">{formatOdds(r.odds)}</td>
              <td className="num">{formatOdds(r.fair_odds)}</td>
              <td className="mut small">
                {r.sharps.map((s) => `${s.book} ${s.hold_pct.toFixed(1)}%`).join(' · ')}
              </td>
              <td className="num" title={`Raw Kelly $${r.kelly_stake.toFixed(2)}`}>
                {zeroStakeReason(r) ? <span className="mut small">{zeroStakeReason(r)}</span> : formatMoney(r.stake)}
              </td>
              <td className="row-actions">
                <div className="row-actions-inner">
                  <BetLink href={r.link} title={ROW_ACTION_TIPS.bet} />
                  <button className={tracked.has(trackKey(r)) ? 'track on' : 'track'} title={ROW_ACTION_TIPS.track} onClick={() => {
                    track(r);
                  }}>{trackButtonLabel(tracked.has(trackKey(r)))}</button>
                  {!r.player && (
                    <button className={has(r) ? 'track on' : 'track'} title={ROW_ACTION_TIPS.slip}
                      onClick={() => {
                        const added = !has(r);
                        toggle(r);
                        const t = slipToast(added, slip.length + (added ? 1 : -1));
                        toast(t.text, t.kind, t.action);
                      }}>{has(r) ? '✓ Slip' : '+ Slip'}</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <EmptyState text={evEmptyText(data, minEv)} />
      <RowExample tab="+EV" row={Array.isArray(data) ? data[0] : null} fmt={ROW_FMT} />
    </>
  );
}

function PropsFilter({value, onChange}) {
  return (
    <select value={value} onChange={(e) => {
      onChange(e.target.value);
    }}>
      {Object.entries(PROP_FILTER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

function ArbCard({arb, onTrack}) {
  return (
    <div className="card">
      <b className="best">{percent(arb.profit_pct, {digits: 2, signed: true})}</b> {arb.event} <LiveTag row={arb} />{' '}
      <span className="mut">{arb.sport} · {marketName(arb.market)}</span>
      <button className="track right" onClick={onTrack}>Track legs</button>
      {arb.legs.map((leg, j) => (
        <div key={j}>
          {leg.pick} {formatOdds(leg.odds)} @ {leg.book} — stake <b>{formatMoney(leg.stake)}</b>{' '}
          <BetLink href={leg.link} />{' '}
          <span className="mut">
            · profit if wins{' '}
            <span className={signClass(leg.profit_if_wins)}>
              {money(leg.profit_if_wins, {signed: true})}
            </span>
          </span>
        </div>
      ))}
      <div className="mut">
        Total {formatMoney(arb.total_stake)} · profit {formatMoney(arb.min_profit)} to{' '}
        {formatMoney(arb.max_profit)}{arb.capped ? ' · scaled down to max per side' : ''}
      </div>
      {arb.warning && <div className="bad">⚠ {arb.warning}</div>}
    </div>
  );
}

const ARB_SORT_OPTIONS = [
  {id: 'profit', label: 'Profit %', defaultDir: 'desc'}, {id: 'event', label: 'Event'},
  {id: 'stake', label: 'Total stake', defaultDir: 'desc'},
];
const ARB_SORT = {profit: (r) => r.profit_pct, event: (r) => r.event, stake: (r) => r.total_stake};

function Arbs() {
  const [min, setMin] = useStored('arbMin', 0);
  const [props, setProps] = useStored('arbProps', 'include');
  const [sort, onSort, sorted] = useSort('Arbitrage', {key: 'profit', dir: 'desc'});
  const sizing = useSizing();
  const bank = useApi('/api/bankroll', 30000);
  const data = useApi(`/api/arbs?min_profit=${min}${sizingQuery(sizing, true)}${propsParam(props)}`);
  const track = async (row) => {
    const responses = await Promise.all(row.legs.map((leg) => postJson('/api/bets', {
      event: row.event,
      event_id: row.event_id,
      sport: row.sport,
      market: row.market,
      pick: leg.pick,
      selection: leg.selection,
      point: leg.point,
      book: leg.book,
      odds: leg.odds,
      stake: Number(leg.stake.toFixed(2)),
      strategy: 'arb',
    })));
    if (responses.every((x) => x.ok)) {
      toast(`Tracked ${row.legs.length} legs of ${row.event} (${formatMoney(row.total_stake)} total)`);
    } else {
      toast('Could not track every leg', 'err');
    }
    notifyDataChanged();
  };
  return (
    <>
      <TabIntro tab="Arbitrage" />
      <div className="bar">
        Min profit % (<Term id="arb">arb</Term>) <input type="number" step="0.5" value={min} onChange={(e) => {
          setMin(Number(e.target.value));
        }} />
        <SizingBar s={sizing} showTotal totalHint={bank ? bank.current.toFixed(0) : 'bankroll'} />
        <PropsFilter value={props} onChange={setProps} />
        <div className="mut">{ARB_TOTAL_NOTE}</div>
      </div>
      {arbMinWarning(min) && <div className="bad">⚠ {arbMinWarning(min)}</div>}
      <ApiError data={data} />
      <EmptyState text={arbsEmptyText(data, min)} />
      <RowExample tab="Arbitrage" row={Array.isArray(data) ? data[0] : null} fmt={ROW_FMT} />
      <SortBar options={ARB_SORT_OPTIONS} sort={sort} onSort={onSort} />
      {sorted(Array.isArray(data) ? data : [], ARB_SORT).map((r, i) => (
        <ArbCard key={i} arb={r} onTrack={() => {
          track(r);
        }} />
      ))}
    </>
  );
}

const PROMOS = {
  'bonus-bet': [
    'Bonus bet',
  ],
  'profit-boost': [
    'Profit boost',
  ],
  'second-chance': [
    'Second chance / no-sweat',
  ],
};

function PromoCard({promo, onTrack}) {
  const legName = (leg) => {
    if (!leg.promo) return 'Hedge';
    return leg.is_bonus ? 'Bonus' : 'Promo';
  };
  return (
    <div className="card calc">
      <b className={promo.profit >= 0 ? 'best' : 'bad'}>{promo.conversion_pct.toFixed(1)}%</b>{' '}
      {formatMoney(promo.profit)} locked · {promo.event}
      <span className="mut">{promo.sport} · {marketName(promo.market)}</span>
      <button className="track" style={{float: 'right'}} onClick={onTrack}>Track</button>
      {promo.legs.map((leg, j) => (
        <div key={j}>
          {legName(leg)}: {leg.pick} {formatOdds(leg.odds)}
          {leg.promo && promo.boosted_odds != null && (
            <span className="mut">→ {formatOdds(promo.boosted_odds)}</span>
          )} @ {leg.book} — stake {formatMoney(leg.stake)}
        </div>
      ))}
    </div>
  );
}

function Promos() {
  const [kind, setKind] = useStored('promoKind', 'bonus-bet');
  const [book, setBook] = useStored('promoBook', 'DraftKings');
  const [amount, setAmount] = useStored('promoAmount', 100);
  const [boost, setBoost] = useStored('promoBoost', 50);
  const [maxBoost, setMaxBoost] = useStored('promoMaxBoost', '');
  const [rate, setRate] = useStored('promoRate', 70);
  const [market, setMarket] = useStored('promoMarket', '');
  const params = new URLSearchParams({book, amount, limit: 25});
  if (kind === 'profit-boost') {
    params.set('boost_pct', boost);
    if (maxBoost !== '') params.set('max_boost', maxBoost);
  }
  if (kind === 'second-chance') params.set('refund_value', rate / 100);
  if (market) params.set('market', market);
  const data = useApi(amount > 0 ? `/api/promo/${kind}?${params}` : null);
  const [promoName] = PROMOS[kind];
  const track = async (row) => {
    for (const leg of row.legs) {
      const boosted = leg.promo && row.boosted_odds != null;
      const promoNote = boosted ? ` (posted ${formatOdds(leg.odds)}, +${boost}%)` : '';
      await fetch('/api/bets', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          event: row.event,
          sport: row.sport,
          market: row.market,
          pick: leg.pick,
          book: leg.book,
          odds: boosted ? Number(row.boosted_odds.toFixed(2)) : leg.odds,
          stake: Number(leg.stake.toFixed(2)),
          is_bonus: leg.is_bonus,
          strategy: 'promo',
          notes: leg.promo ? `${promoName}${promoNote}` : `${promoName} hedge`,
        }),
      });
    }
    notifyDataChanged();
    alert(`Tracked both legs of ${row.event}`);
  };
  return (
    <>
      <TabIntro tab="Promos" />
      <div className="bar wrap">
        <select value={kind} onChange={(e) => {
          setKind(e.target.value);
        }}>
          {Object.entries(PROMOS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
        </select>
        Book <select value={book} onChange={(e) => {
          setBook(e.target.value);
        }}>
          {BOOKS.map((b) => <option key={b}>{b}</option>)}
        </select>
        Amount $ <input type="number" step="1" value={amount} onChange={(e) => {
          setAmount(Number(e.target.value));
        }} />
        {kind === 'profit-boost' && (
          <>
            Boost % <input type="number" step="5" value={boost} onChange={(e) => {
              setBoost(Number(e.target.value));
            }} />
            Max $ <input type="number" placeholder="none" value={maxBoost} onChange={(e) => {
              setMaxBoost(e.target.value);
            }} />
          </>
        )}
        {kind === 'second-chance' && (
          <>
            Bonus conversion % <input type="number" step="5" value={rate} onChange={(e) => {
              setRate(Number(e.target.value));
            }} />
          </>
        )}
        <select value={market} onChange={(e) => {
          setMarket(e.target.value);
        }}>
          <option value="">All markets</option>
          {Object.entries(MARKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {(Array.isArray(data) ? data : []).map((r, i) => (
        <PromoCard key={i} promo={r} onTrack={() => {
          track(r);
        }} />
      ))}
      {Array.isArray(data) && data.length === 0 && (
        <p className="mut">No two-sided markets with a <Term id="hedge">hedge</Term> at another book.</p>
      )}
    </>
  );
}

function ParlayBookRow({book, onTrack}) {
  return (
    <tr className={book.blocked ? 'blocked' : ''}>
      <td>{book.book}</td>
      <td className="num">{formatOdds(book.odds)}</td>
      <td className={`num ${signClass(book.ev_pct)}`}>{percent(book.ev_pct, {signed: true})}</td>
      <td className="num">{book.stake == null ? '—' : formatMoney(book.stake)}{tinyStakeNote(book.stake) && <div className="mut small">{tinyStakeNote(book.stake)}</div>}</td>
      <td className="mut">{book.leg_odds.map((o) => formatOdds(o)).join(' × ')}</td>
      <td>
        {book.blocked ?
          <span className="mut">No SGP</span> :
          <button className="track" onClick={onTrack}>Track</button>}
      </td>
    </tr>
  );
}

function Parlay() {
  const {slip, toggle, clear} = useSlip();
  const [restored] = useState(() => slip.length > 0);
  const [method] = useStored('evMethod', 'multiplicative');
  const [kelly] = useStored('evKelly', 0.25);
  const sizing = useSizing();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const legs = slip.map(({event_id, market, name, point}) => ({event_id, market, name, point}));
  const body = JSON.stringify({legs, method, kelly});
  useEffect(() => {
    if (legs.length < 2) {
      setResult(null);
      setError(null);
      return undefined;
    }
    let live = true;
    const load = () => {
      fetch('/api/parlay', {method: 'POST', headers: JSON_HEADERS, body}).then(async (r) => {
        const d = await r.json();
        if (!live) return;
        if (r.ok) {
          setResult(d);
          setError(null);
        } else {
          setResult(null);
          setError(d.detail);
        }
      });
    };
    load();
    window.addEventListener('data-changed', load);
    return () => {
      live = false;
      window.removeEventListener('data-changed', load);
    };
  }, [body]);
  const track = async (book) => {
    const picks = result.legs.map((l) => l.pick);
    await fetch('/api/bets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        event: [...new Set(result.legs.map((l) => l.event))].join(' / '),
        sport: [...new Set(result.legs.map((l) => l.sport))].join('/'),
        market: 'parlay',
        pick: `${picks.length}-leg parlay: ${picks.join(' + ')}`,
        book: book.book,
        odds: Math.round(book.odds),
        stake: Number((book.stake ?? 0).toFixed(2)) || 1,
        ev_pct: book.ev_pct,
        notes: result.legs.map((l, i) => `${l.pick} (${l.event}) ${formatOdds(book.leg_odds[i])}`)
            .join('; '),
      }),
    });
    alert(`Tracked parlay @ ${book.book}`);
  };
  return (
    <>
      <TabIntro tab="Parlay" />
      <div className="bar">
        <span className="mut">{stakingSummary({kelly, round: sizing.round, max: sizing.max})}</span>
        <button type="button" className="link" onClick={() => {
          window.dispatchEvent(new CustomEvent(GOTO_EVENT, {detail: '+EV'}));
        }}>Change in +EV: Bankroll &amp; staking</button>
        <span className="mut">{devigLabel(method)}</span>
        {slip.length > 0 && <button className="track on" onClick={() => {
          clear();
        }}>Clear slip</button>}
      </div>
      {restoredNote(slip.length, restored) && <div className="mut">{restoredNote(slip.length, restored)}</div>}
      {slip.length === 0 && (
        <div className="mut">
          Add legs with "+ Slip" on the +EV tab, or click a price on the Odds Screen.
        </div>
      )}
      {slip.map((l, i) => {
        const fair = result?.legs[i]?.fair_prob;
        return (
          <div className="card calc" key={legKey(l)}>
            <button className="x" onClick={() => {
              toggle(l);
            }}>✕</button> <b>{l.pick}</b>{' '}
            <span className={l.odds == null || !l.book ? 'bad' : ''}>{slipLegPriceText(l)}</span>{' '}
            <span className="mut">{marketName(l.market)} · {l.event}</span>
            {fair != null && <span className="mut">fair {(fair * 100).toFixed(1)}%</span>}
            {result && fair == null && (
              <span className="mut">no sharp price for this line — EV unknown</span>
            )}
          </div>
        );
      })}
      {slip.length === 1 && <div className="mut">Add at least one more leg.</div>}
      {error && (
        <div className="bad">{typeof error === 'string' ? error : 'Could not price this parlay'}</div>
      )}
      {result && (
        <>
          <div className="bar">
            Fair <b>{result.fair_odds == null ? '—' : formatOdds(result.fair_odds)}</b>
            {result.fair_prob != null && (
              <span className="mut">
                {(result.fair_prob * 100).toFixed(2)}% · legs treated as independent. {INDEPENDENT_NOTE}
              </span>
            )}
          </div>
          {result.same_game && (
            <div className="bad">
              Same-game legs: correlation is not modelled, and books without same-game parlays are
              blocked.
            </div>
          )}
          {result.books.length === 0 && (
            <div className="mut">No book offers every leg at these lines.</div>
          )}
          <table>
            <thead>
              <tr><th>Book</th><th className="num">Odds</th><th className="num">EV%</th><th className="num">Stake</th><th>Legs</th><th></th></tr>
            </thead>
            <tbody>
              {result.books.map((b) => (
                <ParlayBookRow key={b.book} book={b} onTrack={() => {
                  track(b);
                }} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

/** Parses a number input's text, returning `fallback` when it is not a valid number. */
function parseNumberInput(value, fallback) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const LOW_HOLD_BOOKS = ['', ...BOOKS, ...EXCHANGE_BOOKS];

const LOW_HOLD_COLUMNS = [
  ['hold', 'Hold'], ['event', 'Event'], ['market', 'Market'], ['legs', 'Legs'], ['loss', 'Exp. loss'],
];
const LOW_HOLD_SORT = {
  hold: (r) => r.hold_pct, event: (r) => r.event, market: (r) => marketName(r.market), legs: (r) => r.legs.length,
  loss: (r) => r.expected_loss,
};

function LowHold() {
  const [maxHold, setMaxHold] = useStored('lhMax', LOW_HOLD_DEFAULT_MAX);
  const [book, setBook] = useStored('lhBook', '');
  const [stake, setStake] = useStored('lhStake', 100);
  const [market, setMarket] = useStored('lhMarket', '');
  const [sort, onSort, sorted] = useSort('Low Hold', {key: 'hold', dir: 'asc'});
  const marketParam = market ? `&market=${market}` : '';
  const data = useApi(
      `/api/lowhold?max_hold=${maxHold}&book=${encodeURIComponent(book)}&stake=${stake}${marketParam}`);
  // Nearest miss: only fetched once the filtered list comes back empty.
  const empty = Array.isArray(data) && data.length === 0;
  const all = useApi(empty ? '/api/lowhold?max_hold=100&stake=100' : null);
  const lowest = Array.isArray(all) && all.length ? all[0].hold_pct : null;
  return (
    <>
      <TabIntro tab="Low Hold" />
      <div className="bar">
        Max hold % <input type="number" step="0.25" value={maxHold} onChange={(e) => {
          setMaxHold(parseNumberInput(e.target.value, maxHold));
        }} />
        One leg at <select value={book} onChange={(e) => {
          setBook(e.target.value);
        }}>
          {LOW_HOLD_BOOKS.map((b) => <option key={b} value={b}>{b || 'Any book'}</option>)}
        </select>
        Market <select value={market} onChange={(e) => {
          setMarket(e.target.value);
        }}>
          <option value="">All markets</option>
          {Object.entries(MARKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        Total stake $<input type="number" step="10" value={stake} onChange={(e) => {
          setStake(parseNumberInput(e.target.value, stake));
        }} />
      </div>
      <ApiError data={data} />
      <table>
        <thead>
          <tr>
            {LOW_HOLD_COLUMNS.map(([id, label]) => (
              <SortTh key={id} tab="Low Hold" id={id} label={label} sort={sort} onSort={onSort}
                num={id === 'hold' || id === 'loss'} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted(Array.isArray(data) ? data : [], LOW_HOLD_SORT).map((r, i) => (
            <tr key={i}>
              <td className={`num ${signClass(-r.hold_pct)}`}>{percent(r.hold_pct, {digits: 2, signed: true})}</td>
              <td>{r.event} <LiveTag row={r} /> <span className="mut">{r.sport}</span></td>
              <td>{marketName(r.market)}</td>
              <td>
                {r.legs.map((l, j) => (
                  <div key={j}>{l.pick} {formatOdds(l.odds)} @ {l.book} — ${l.stake.toFixed(2)}</div>
                ))}
              </td>
              <td className={`num ${signClass(-r.expected_loss)}`}>{money(r.expected_loss, {signed: true})}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <EmptyState text={lowHoldEmptyText(data, maxHold, lowest)} />
      <RowExample tab="Low Hold" row={Array.isArray(data) ? data[0] : null} fmt={ROW_FMT} />
    </>
  );
}

const MIDDLES_COLUMNS = [
  ['ev', 'EV%', 'desc'], ['hit', 'Hit %', 'desc'], ['event', 'Event'], ['market', 'Market'], ['window', 'Window', 'desc'],
  ['legs', 'Legs'], ['worst', 'Worst case', 'desc'], ['both', 'Win both', 'desc'],
];
const MIDDLES_NUM = new Set(['ev', 'hit', 'worst', 'both']);
const MIDDLES_SORT = {
  ev: (r) => r.ev_pct, hit: (r) => r.hit_prob, event: (r) => r.event, market: (r) => marketName(r.market),
  window: (r) => r.window, legs: (r) => r.legs.length, worst: (r) => r.worst_case, both: (r) => r.win_both,
};

function Middles() {
  const [minWindow, setMinWindow] = useStored('midWindow', 0.5);
  const [maxCost, setMaxCost] = useStored('midCost', 5);
  const [minEv, setMinEv] = useStored('midMinEv', 0);
  const [market, setMarket] = useStored('midMarket', '');
  const [sort, onSort, sorted] = useSort('Middles', {key: 'ev', dir: 'desc'});
  const params = new URLSearchParams({min_window: minWindow});
  if (minEv !== '') params.set('min_ev', minEv);
  if (maxCost !== '') params.set('max_cost', maxCost);
  if (market) params.set('market', market);
  const data = useApi(`/api/middles?${params}`);
  const track = async (row) => {
    for (const leg of row.legs) {
      await fetch('/api/bets', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          event: row.event,
          sport: row.sport,
          market: row.market,
          pick: leg.pick,
          book: leg.book,
          odds: leg.odds,
          stake: Math.round(leg.stake * 100) / 100,
          ev_pct: row.ev_pct,
          notes: `middle ${row.legs.map((x) => x.pick).join(' / ')}`,
        }),
      });
    }
    alert(`Tracked both legs: ${row.legs.map((l) => `${l.pick} @ ${l.book}`).join(', ')}`);
  };
  const onMinWindow = (e) => {
    const value = Number(e.target.value);
    if (!Number.isNaN(value)) setMinWindow(value);
  };
  const onMaxCost = (e) => {
    const value = e.target.value === '' ? '' : Number(e.target.value);
    if (value === '' || !Number.isNaN(value)) setMaxCost(value);
  };
  const onMinEv = (e) => {
    const value = e.target.value === '' ? '' : Number(e.target.value);
    if (value === '' || !Number.isNaN(value)) setMinEv(value);
  };
  return (
    <>
      <TabIntro tab="Middles" />
      <div className="bar">
        Market <select value={market} onChange={(e) => {
          setMarket(e.target.value);
        }}>
          <option value="">All</option><option value="spreads">Spread</option>
          <option value="totals">Total</option>
        </select>
        Min window <input type="number" step="0.5" min="0" value={minWindow} onChange={onMinWindow} />
        Max cost % <input type="number" step="0.5" min="0" placeholder="any" value={maxCost}
          onChange={onMaxCost} />
        Min EV % <input type="number" step="0.5" placeholder="any" value={minEv} onChange={onMinEv} />
      </div>
      <div className="mut small">
        A <Term id="middle">middle</Term> wins both bets when the result lands in the window. Per $100 total stake, split so both misses cost the same. EV uses a normal model of the
        result (NFL margins weighted to key numbers).
      </div>
      <table>
        <thead>
          <tr>
            {MIDDLES_COLUMNS.map(([id, label, defaultDir]) => (
              <SortTh key={id} tab="Middles" id={id} label={label} sort={sort} onSort={onSort}
                defaultDir={defaultDir} num={MIDDLES_NUM.has(id)} />
            ))}
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {sorted(Array.isArray(data) ? data : [], MIDDLES_SORT).map((r, i) => (
            <tr key={i}>
              <td className={`num ${signClass(r.ev_pct)}`}>{percent(r.ev_pct, {signed: true})}</td>
              <td className="num">{percent(r.hit_prob * 100)}</td>
              <td>{r.event} <LiveTag row={r} /> <span className="mut">{r.sport}</span></td>
              <td>{marketName(r.market)}</td>
              <td>{windowText(r)}</td>
              <td>
                {r.legs.map((l, j) => (
                  <div key={j}>{l.pick} {formatOdds(l.odds)} @ {l.book} — ${l.stake.toFixed(2)}</div>
                ))}
              </td>
              <td className={`num ${signClass(r.worst_case)}`}>{money(r.worst_case, {signed: true})}</td>
              <td className={`num ${signClass(r.win_both)}`}>{money(r.win_both, {signed: true})}</td>
              <td className="row-actions">
                <div className="row-actions-inner">
                  <button className="track" onClick={() => {
                    track(r);
                  }}>Track</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <EmptyState text={middlesEmptyText(data, minWindow, maxCost, minEv)} />
      <RowExample tab="Middles" row={Array.isArray(data) ? data[0] : null} fmt={ROW_FMT} />
    </>
  );
}

function notificationsAllowed() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

function initialPermission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/**
 * Polls the alert feed while the tab is open and shows a browser Notification
 * for each new opportunity.
 */
function AlertWatcher() {
  const [on, setOn] = useStored('alertsNotify', false);
  const [permission, setPermission] = useState(() => initialPermission());
  useEffect(() => {
    if (!on || permission !== 'granted') return undefined;
    let live = true;
    let after = null;
    const poll = async () => {
      const limit = after == null ? 1 : 20;
      const response = await fetch(`/api/alerts?after=${after ?? 0}&limit=${limit}`);
      const feed = await response.json();
      if (!live) return;
      if (after != null) {
        for (const item of [...feed.items].reverse()) {
          // The constructor shows the notification; the object is not needed.
          new Notification('Odderjam alert', {body: item.title, tag: `odderjam-${item.id}`});
        }
      }
      // The first poll only sets the starting point, so old alerts don't fire.
      after = feed.latest_id;
    };
    const pollQuietly = () => {
      poll().catch(() => {
        // A failed poll is retried on the next interval.
      });
    };
    pollQuietly();
    const timer = setInterval(pollQuietly, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [on, permission]);
  if (permission === 'unsupported') return null;
  const toggle = async () => {
    if (on) {
      setOn(false);
      return;
    }
    const next = permission === 'granted' ?
        permission :
        await Notification.requestPermission();
    setPermission(next);
    setOn(next === 'granted');
  };
  return (
    <div className="refresh">
      <label className="chk mut">
        <input type="checkbox" checked={on && notificationsAllowed()} onChange={toggle} />
        Browser alerts
      </label>
      {permission === 'denied' && (
        <div className="mut small">Notifications are blocked in this browser</div>
      )}
    </div>
  );
}

const BLANK_RULE = {name: '', kind: 'ev', min_value: 2, book: '', market: '', sport: ''};
const ANY_BOOKS = ['', ...BOOKS];

function Alerts() {
  const [tick, setTick] = useState(0);
  const rules = useApi(`/api/alerts/rules?t=${tick}`, 600000);
  const feed = useApi(`/api/alerts?t=${tick}`, 30000);
  const [form, setForm] = useState(BLANK_RULE);
  const [formError, setFormError] = useState(null);
  const reload = () => {
    setTick((t) => t + 1);
  };
  const field = (key) => (e) => {
    setForm({...form, [key]: e.target.value});
  };
  const add = async (e) => {
    e.preventDefault();
    const invalid = ruleFormError(form);
    setFormError(invalid);
    if (invalid) return;
    const response = await postJson('/api/alerts/rules', {...form, min_value: Number(form.min_value)});
    if (!response.ok) {
      setFormError((await errorDetail(response)) || 'Could not add alert');
      return;
    }
    setForm(BLANK_RULE);
    reload();
  };
  const remove = async (rule) => {
    await fetch(`/api/alerts/rules/${rule.id}`, {method: 'DELETE'});
    reload();
  };
  let discordNote = null;
  if (feed) {
    discordNote = feed.discord ?
        <> <Term id="discord-webhook">Discord webhook</Term> is on.</> :
        <> Discord is optional: set DISCORD_WEBHOOK_URL to also post alerts there (see <Term id="discord-webhook">Discord webhook</Term>).</>;
  }
  return (
    <>
      <TabIntro tab="Alerts" />
      <p className="mut">
        Rules are checked after each odds fetch that already happens. Alerts never spend extra API
        credits.
        {discordNote}
      </p>
      <form className="bar wrap" onSubmit={add}>
        <select value={form.kind} onChange={field('kind')}>
          <option value="ev">+EV</option><option value="arb">Arbitrage</option>
        </select>
        <Term id="min-percent">Min %</Term> <input type="number" step="0.5" value={form.min_value} onChange={field('min_value')} />
        <select value={form.book} onChange={field('book')}>
          {ANY_BOOKS.map((b) => <option key={b} value={b}>{b || 'Any book'}</option>)}
        </select>
        <select value={form.market} onChange={field('market')}>
          <option value="">Any market</option>
          {Object.entries(MARKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={form.sport} onChange={field('sport')}>
          {SPORTS.map((s) => <option key={s} value={s}>{s || 'Any sport'}</option>)}
        </select>
        <input placeholder="Name (optional)" value={form.name} onChange={field('name')} />
        <button className="primary">Add alert</button>
        {formError && <span className="bad" role="alert">{formError}</span>}
      </form>
      <table>
        <thead>
          <tr>
            <th>Rule</th><th>Type</th><th>Min</th><th>Book</th><th>Market</th><th>Sport</th><th></th>
          </tr>
        </thead>
        <tbody>
          {(rules || []).map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.kind === 'ev' ? '+EV' : 'Arb'}</td>
              <td>{r.min_value}%</td>
              <td>{r.book || 'Any'}</td>
              <td>{MARKETS[r.market] || 'Any'}</td>
              <td>{r.sport || 'Any'}</td>
              <td><button className="x" onClick={() => {
                remove(r);
              }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Recent alerts</h3>
      <EmptyState text={alertsEmptyText(feed)} />
      <table>
        <thead>
          <tr><th>When</th><th>Alert</th><th>Rule</th></tr>
        </thead>
        <tbody>
          {(feed?.items || []).map((o) => (
            <tr key={o.id}>
              <td>{eventTime(o.created_at)}</td>
              <td>{o.title}</td>
              <td className="mut">{o.rule_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** A positive number from an input, else `fallback` (the API rejects zero windows and multipliers). */
function positiveInput(value, fallback) {
  const n = parseNumberInput(value, fallback);
  return n > 0 ? n : fallback;
}

/**
 * Sharp Money: exchange markets where matched volume just spiked, with the
 * sportsbooks still paying more than the price that volume traded at.
 */
function SharpMoney() {
  const [windowMin, setWindowMin] = useStored('smWindow', 10);
  const [baselineMin, setBaselineMin] = useStored('smBaseline', 120);
  const [k, setK] = useStored('smK', 3);
  const [minVolume, setMinVolume] = useStored('smMinVolume', 500);
  const data = useApi(`/api/sharp-money?window_minutes=${windowMin}&baseline_minutes=${baselineMin}` +
      `&k=${k}&min_volume=${minVolume}`);
  const status = useApi('/api/sharp-money/status');
  return (
    <>
      <TabIntro tab="Sharp Money" />
      <div className="bar">
        Show spikes in the last <input type="number" step="1" min="1" value={windowMin} onChange={(e) => {
          setWindowMin(positiveInput(e.target.value, windowMin));
        }} /> min
        compared with the prior <input type="number" step="10" min="1" value={baselineMin} onChange={(e) => {
          setBaselineMin(positiveInput(e.target.value, baselineMin));
        }} /> min
        where volume is at least <input type="number" step="0.5" min="0.5" value={k} onChange={(e) => {
          setK(positiveInput(e.target.value, k));
        }} /> times the usual rate, with at least <input type="number" step="100" min="0" value={minVolume} onChange={(e) => {
          setMinVolume(parseNumberInput(e.target.value, minVolume));
        }} /> contracts traded. A contract is one share of a yes/no market; it pays $1 if the bet wins.
      </div>
      <div className="mut small">
        Exchange trades are public. A burst of matched volume well above the usual rate points at
        informed money; EV is against the burst&apos;s volume-weighted price.
        {status && status.configured === false && (
          <> <button type="button" onClick={() => {
            window.dispatchEvent(new CustomEvent(GOTO_EVENT, {detail: HELP_TAB}));
          }}>Set up an exchange in Help</button></>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <Th tab="Sharp Money" label="Event" /><Th tab="Sharp Money" label="Side" />
            <Th tab="Sharp Money" label="Exchange" /><Th tab="Sharp Money" label="Volume" num />
            <Th tab="Sharp Money" label="× usual" num /><Th tab="Sharp Money" label="Spike price" num />
            <Th tab="Sharp Money" label="Books paying more" />
          </tr>
        </thead>
        <tbody>
          {(Array.isArray(data) ? data : []).map((r, i) => (
            <tr key={i}>
              <td>{r.event} <span className="mut">{r.sport}</span></td>
              <td>{r.outcome}</td>
              <td>{r.exchange}</td>
              <td className="num">{Math.round(r.volume)} <span className="mut">({r.trades} trades)</span></td>
              <td className="num">{r.ratio === null ? 'new' : `${r.ratio.toFixed(1)}×`}</td>
              <td className="num">{formatOdds(r.price)} <span className="mut">{r.vwap_cents.toFixed(1)}¢</span></td>
              <td>
                {r.books.length ? r.books.map((b) => (
                  <div key={b.book}>
                    {b.book} {formatOdds(b.price)} <span className="best">+{b.ev_pct.toFixed(1)}%</span>
                  </div>
                )) : <span className="mut">none</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <EmptyState text={sharpEmptyText(data, k, windowMin, status)} />
      <RowExample tab="Sharp Money" row={Array.isArray(data) ? data[0] : null} fmt={ROW_FMT} />
    </>
  );
}

const TABS = {
  'Odds Screen': OddsScreen,
  '+EV': PositiveEv,
  'Parlay': Parlay,
  'Arbitrage': Arbs,
  'Low Hold': LowHold,
  'Middles': Middles,
  'Sharp Money': SharpMoney,
  'Promos': Promos,
  'Pick\'em': Pickem,
  'Calculator': Calculators,
  'Tracker': Tracker,
  'Glossary': Glossary,
  'Alerts': Alerts,
  'Help': Help,
};

const DEFAULT_TAB = 'Odds Screen';

function loadTab() {
  try {
    const tab = localStorage.getItem('tab');
    return isOption(TABS, tab) ? tab : DEFAULT_TAB;
  } catch {
    // Storage can be unavailable; use the default tab.
    return DEFAULT_TAB;
  }
}

/** First-visit banner: what Odderjam is, where to start, and jump buttons. */
function Welcome({onJump, onClose}) {
  return (
    <section className="welcome" aria-label="Welcome">
      <p>
        <strong>Welcome to Odderjam.</strong> It compares sportsbook prices and finds bets with a built-in edge.
      </p>
      <ol>
        <li>Look at prices on the Odds Screen.</li>
        <li>Find an edge on +EV or Arbitrage.</li>
        <li>Log the bet in Tracker.</li>
      </ol>
      <div className="welcome-actions">
        <button onClick={() => {
          onJump('Odds Screen');
        }}>Go to Odds Screen</button>
        <button onClick={() => {
          onJump('+EV');
        }}>Go to +EV</button>
        <button onClick={() => {
          onJump('Help');
        }}>Read the Help page</button>
        <button className="link" onClick={onClose}>Dismiss</button>
      </div>
      <p className="mut small">This is not betting advice, and results are not guaranteed.</p>
    </section>
  );
}

function App() {
  const [tab, setTab] = useState(() => loadTab());
  const [welcomeTab, setWelcomeTab] = useState(() => initialWelcome(tab));
  const go = (next) => {
    setTab(next);
    setWelcomeTab((w) => {
      const kept = afterNavigate(w, next);
      if (w != null && kept == null) dismissWelcome();
      return kept;
    });
    try {
      localStorage.setItem('tab', next);
    } catch {
      // Storage can be unavailable; the choice just is not remembered.
    }
  };
  useEffect(() => {
    const onGoto = (e) => {
      if (isOption(TABS, e.detail)) go(e.detail);
    };
    window.addEventListener(GOTO_EVENT, onGoto);
    return () => window.removeEventListener(GOTO_EVENT, onGoto);
  }, []);
  const welcome = welcomeTab != null;
  const closeWelcome = () => {
    setWelcomeTab(null);
    dismissWelcome();
  };
  const navSlip = useSlip();
  const Page = TABS[tab];
  return (
    <div className="app">
      <nav>
        <h1>Odderjam</h1>
        {NAV_GROUPS.map((g) => (
          <div className="nav-group" key={g.title} role="group" aria-label={g.title}>
            <h2>{g.title}</h2>
            {g.tabs.map((t) => (
              <button key={t} className={t === tab ? 'on' : ''} title={NAV_SUBTITLES[t]}
                aria-current={t === tab ? 'page' : undefined} onClick={() => {
                  go(t);
                }}>
                {navLabel(t, navSlip.slip.length)}
                <span className="sub">{NAV_SUBTITLES[t]}</span>
              </button>
            ))}
          </div>
        ))}
        <button className="link" onClick={() => {
          setWelcomeTab(tab);
        }}>Show welcome</button>
      </nav>
      <div className="content">
        {showsStrip(tab) && <FreshnessStrip />}
        <main>{welcome && <Welcome onJump={go} onClose={closeWelcome} />}<WelcomeContext.Provider value={welcomeTab}><Page welcome={welcome} /></WelcomeContext.Provider></main>
      </div>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
