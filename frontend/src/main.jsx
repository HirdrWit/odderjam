import {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';

import './style.css';
import {Calculators} from './Calculators.jsx';
import {RowExample, Th} from './ColumnHelp.jsx';
import {SortTh, useSort} from './SortTable.jsx';
import {oddsKey} from './sorttable.js';
import {zeroStakeReason, stakeCellText, zeroStakeNote} from './columns.js';
import {ErrorBoundary} from './ErrorBoundary.jsx';
import {legStake, parseStakeInput, rowActionAria, slipButtonLabel, trackButtonLabel, trackKey, trackLegs, trackStake, trackToast} from './track.js';
import {Help} from './Help.jsx';
import {GOTO_EVENT, HELP_TAB} from './help.js';
import {loadStored} from './hooks.js';
import {ALERTS_EVENT, PANEL_EVENT, SETTINGS_LABEL, SETTINGS_LINKS, requestPanel, takePanel} from './settings.js';
import {OddsScreen} from './OddsScreen.jsx';
import {Pickem} from './Pickem.jsx';
import {SizingBar, sizingQuery, useSizing} from './Sizing.jsx';
import {filterCount, filtersLabel} from './cards.js';
import {
  ARB_COLUMNS, ARB_DEFAULTS, ARB_SORT, arbChips, arbReset, arbStakingNote, arbTotalPlaceholder,
} from './arbfilters.js';
import {SHARP_DEFAULTS, SHARP_FIELDS, sharpChips, sharpHint, sharpReset} from './sharpfilters.js';
import {DEFAULT_FILTERS, activeChips, clearFilter, resetFilters, sportsParam} from './evfilters.js';
import {stakingSummary} from './staking.js';
import {TabIntro, WelcomeContext} from './TabIntro.jsx';
import {afterNavigate, initialWelcome} from './onboarding.js';
import {Term} from './Term.jsx';
import {NAV_GROUPS, NAV_SUBTITLES, MOBILE_TABS, moreTabs, navLabel} from './navgroups.js';
import {buildHash, evFiltersToParams, evParamsToFilters, parseHash} from './routes.js';
import {Tracker} from './Tracker.jsx';
import {alertFlagBadges, BETTABLE_HELP, BLANK_RULE_FIELDS, ruleFormError} from './alerts.js';
import {windowText} from './middles.js';
import {PROMO_COLUMNS, PROMO_DEFAULT_SORT, PROMO_NUM, PROMO_SORT, promoLegs} from './promos.js';
import {
  alertsEmptyText, alertsRulesEmptyText, arbMinWarning, ARB_TOTAL_NOTE, arbsEmptyText, evEmptyText, LOW_HOLD_DEFAULT_MAX,
  lowHoldEmptyText, middlesEmptyText, sharpEmptyText,
} from './empty.js';
import {legKey, useSlip} from './hooks.js';
import {
  INDEPENDENT_NOTE, MISSING_LEG_TEXT, devigLabel, legFairProbs, restoredNote, slipLegPriceText, tinyStakeNote,
} from './slip.js';
import {FILTER_HELP, ROW_ACTION_TIPS, methodLabel, pendingStartText} from './evbar.js';
import {slipToast} from './oddsrow.js';
import {Toaster, errorDetail, postJson, toast, useApi, useApiStatus, useBettable, useStored} from './hooks.jsx';
import {BETTABLE_DEFAULTS, BETTABLE_FIELDS, bettableQuery, bettableReset, validateBettable} from './thresholds.js';
import {badgesFor, bettableChip, filterBettable, hiddenSummary, legWarning, parlayFlagState, showAnyway} from './bettable.js';
import {failedText} from './tablestate.js';
import {EmptyState, TableShell} from './TableShell.jsx';
import {eventTime, money, percent, signClass} from './fmt.js';
import {FORMATS, ageText, isProp} from './odds.js';
import {providerErrorText, rowFreshness, showsStrip, stripState} from './freshness.js';
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
  const load = () => fetch('/api/live').then((r) => {
    if (!r.ok) throw new Error('bad status');
    return r.json();
  }).then(setStatus).catch(() => {
    // Keep the last known settings; the next poll tries again.
  });
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
    let response = null;
    try {
      response = await fetch('/api/live', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(change),
      });
    } catch {
      response = null;
    }
    if (response?.ok) {
      setStatus(await response.json());
    } else {
      const detail = response ? await errorDetail(response) : null;
      toast(`Live settings were not saved${typeof detail === 'string' ? `: ${detail}` : '. Check your connection and try again.'}`, 'err');
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

/**
 * Applies the global "Bettable only" toggle to a tab's rows.
 * @param {*} data The tab's API result (non-arrays count as no rows).
 * @return {{rows: !Array, hidden: !Array, on: boolean, setOn: function(boolean)}}
 */
function useBettableRows(data) {
  const [on, setOn] = useBettable();
  const {shown, hidden} = filterBettable(Array.isArray(data) ? data : [], on);
  return {rows: shown, hidden, on, setOn};
}

/** Hidden-count summary with "Show anyway", and the "Bettable only: off" chip, for a tab. */
function BettableNote({hidden, on, setOn}) {
  const text = hiddenSummary(hidden);
  const chip = bettableChip(on);
  return (
    <>
      {chip && (
        <div className="chips">
          <button type="button" className="chip" aria-label="Turn Bettable only back on" onClick={() => {
            setOn(true);
          }}>{chip.label} ✕</button>
        </div>
      )}
      {text && (
        <p className="mut small bettable-note" role="status">{text}. <button type="button" className="secondary" onClick={() => {
          setOn(showAnyway());
        }}>Show anyway</button></p>
      )}
    </>
  );
}

/** Risk badges for one row's flags. */
function RiskBadges({row}) {
  return badgesFor(row).map((b) => (
    <span key={b.flag} className="chip risk-badge" title={b.tip} tabIndex={0}>{b.label}</span>
  ));
}

/** Global "Bettable only" checkbox, shown in the freshness strip. */
function BettableToggle() {
  const [on, setOn] = useBettable();
  return (
    <label className="chk" title="Hide bets with a risk flag: in-play, longshot, too good to be true and more">
      <input type="checkbox" checked={on} onChange={(e) => {
        setOn(e.target.checked);
      }} /> <Term id="bettable-only">Bettable only</Term>
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

/** Settings dialog, opened from the sidebar on every tab. */
function SettingsDialog({live, onClose, onFormat}) {
  const [info, setInfo] = useState(null);
  const [format, setFormat] = useStored('oddsFormat', 'american');
  useEffect(() => {
    fetch('/api/cache').then((r) => {
      if (!r.ok) throw new Error('bad status');
      return r.json();
    }).then(setInfo).catch(() => {
      setInfo({failed: true});
    });
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const propCount = info?.prop_markets?.length ?? 0;
  const open = (panel) => {
    onClose();
    requestPanel(panel);
    window.dispatchEvent(new CustomEvent(GOTO_EVENT, {detail: '+EV'}));
    window.dispatchEvent(new Event(PANEL_EVENT));
  };
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}>
        <h2 id="settings-title">Settings</h2>
        <div className="settings-body">
          {info?.failed && <div className="bad">Could not load API credit info. Try again later.</div>}
          {info?.remaining != null && <div>API credits left: {info.remaining}</div>}
          {info?.live && <div className="mut">Each refresh spends API credits</div>}
          {info?.live && propCount > 0 && (
            <div className="bad">
              Player props on ({propCount} markets): each refresh costs about {propCount * 2} more
              credits per game
            </div>
          )}
          <LiveSettings live={live} />
          <AlertWatcher role="control" />
          <label className="fld">Odds format
            <select value={format} onChange={(e) => {
              setFormat(e.target.value);
              onFormat();
            }}>
              {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="settings-links">
            {SETTINGS_LINKS.map((l) => (
              <button key={l.panel} type="button" className="secondary" onClick={() => {
                open(l.panel);
              }}>{l.label}</button>
            ))}
          </div>
        </div>
        <button type="button" autoFocus onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** Freshness strip above every price tab: data age, Refresh and the Live toggle. */
function FreshnessStrip({live}) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => {
      fetch('/api/cache').then((r) => {
        if (!r.ok) throw new Error('bad status');
        return r.json();
      }).then((d) => {
        setInfo(d);
      }).catch(() => {
        // Keep the last reading; the strip is informational.
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
      if (!response.ok) throw new Error('refresh failed');
      setInfo(await response.json());
      notifyDataChanged();
    } catch {
      toast('Could not refresh the odds. Try again in a moment.', 'err');
    } finally {
      setBusy(false);
    }
  };
  if (!info) return null;
  const state = stripState(info, !!live.status?.enabled);
  return (
    <div className={`fresh-strip${state.stale ? ' stale' : ''}`} role="status">
      <div className="fresh-main">
        <span className="fresh-text">
          {state.stale && <b>Stale · </b>}{state.text}
        </span>
        {providerErrorText(info.provider_error) && (
          <span className="bad fresh-error" role="alert">{providerErrorText(info.provider_error)}</span>
        )}
        {info.live && (
          <button onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        )}
        <LiveToggle live={live} />
        <BettableToggle />
      </div>
    </div>
  );
}

/**
 * "Bet" button: opens the sportsbook (deep link to the bet when the feed has
 * one) in a new tab.
 */
function BetLink({href, title, label}) {
  if (!href) return null;
  return <a className="bet" href={href} title={title} aria-label={label} target="_blank" rel="noopener noreferrer">Bet</a>;
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

/** "Bettable mode" section of the Model settings panel. */
function BettableSettings({values, onChange}) {
  const errors = validateBettable(values);
  return (
    <fieldset className="bar wrap bettable-settings">
      <legend>Bettable mode</legend>
      {BETTABLE_FIELDS.map((f) => (
        <div key={f.key}>
          <label>
            {f.label}{' '}
            {f.key === 'requireConservative' ? (
              <input type="checkbox" checked={values.requireConservative !== false} onChange={(e) => {
                onChange({...values, requireConservative: e.target.checked});
              }} />
            ) : (
              <input className="mini" type="number" step={f.step} value={values[f.key]} aria-invalid={Boolean(errors[f.key])}
                onChange={(e) => {
                  onChange({...values, [f.key]: e.target.value});
                }} />
            )}
          </label>
          {errors[f.key] && <span className="bad small" role="alert"> {errors[f.key]}</span>}
          <div className="mut small">{f.help}</div>
        </div>
      ))}
      <button type="button" onClick={() => {
        onChange(bettableReset());
      }}>Reset to defaults</button>
    </fieldset>
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
  const [minEv, setMinEv, setMinEvLocal] = useStored('evMin', 1);
  const [method, setMethod] = useStored('evMethod', 'multiplicative');
  const [kelly, setKelly] = useStored('evKelly', 0.25);
  const [props, setProps] = useStored('evProps', 'include');
  const [sport, setSport] = useStored('evSport', '');
  const [panel, setPanel] = useState(() => takePanel());
  useEffect(() => {
    const onPanel = () => {
      const next = takePanel();
      if (next) setPanel(next);
    };
    window.addEventListener(PANEL_EVENT, onPanel);
    return () => window.removeEventListener(PANEL_EVENT, onPanel);
  }, []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [book, setBook] = useState(() => loadEvBook());
  const [sort, onSort, sorted] = useSort('+EV', {key: 'ev', dir: 'desc'});
  const {data: bank, error: bankError, retry: bankRetry} = useApiStatus('/api/bankroll', 30000);
  const bankFailed = failedText({data: bank, error: bankError, what: 'bankroll'});
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
  // Filters in the URL win over stored ones on load; later changes are written back to it.
  useEffect(() => {
    const url = parseHash(window.location.hash);
    if (url.tab === '+EV') {
      const f = evParamsToFilters(url.params, {book, minEv});
      // Shared-link values apply to this view only; they are not saved over the visitor's own settings.
      if (f.book !== book && EV_BOOKS.includes(f.book)) setBook(f.book);
      if (f.minEv !== minEv) setMinEvLocal(f.minEv);
    }
  }, []);
  useEffect(() => {
    const next = buildHash('+EV', evFiltersToParams({book, minEv}));
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }, [book, minEv]);
  const chips = activeChips({book, minEv, sport, props});
  const [bettable, setBettable] = useBettable();
  const {shown: bettableRows, hidden: hiddenRows} = filterBettable(Array.isArray(data) ? data : [], bettable);
  const hiddenText = hiddenSummary(hiddenRows);
  const modeChip = bettableChip(bettable);
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
  const {data: cfg, error: cfgError, retry: cfgRetry} = useApiStatus('/api/sharps', 600000);
  const [weights, setWeights] = useStored('evSharpWeights', null);
  const [maxHold, setMaxHold] = useStored('evMaxHold', null);
  const sharpWeights = weights ?? cfg?.weights;
  const sharpMaxHold = maxHold ?? cfg?.max_hold;
  const setWeight = (sharpBook, value) => {
    setWeights({...sharpWeights, [sharpBook]: value});
  };
  const [thresholds, setThresholds] = useStored('evBettableThresholds', BETTABLE_DEFAULTS);
  const lastValid = useRef(BETTABLE_DEFAULTS);
  if (Object.keys(validateBettable(thresholds)).length === 0) lastValid.current = thresholds;
  const sharpSpec = sharpWeights ?
      Object.entries(sharpWeights).filter(([, v]) => v > 0).map(([b, v]) => `${b}:${v}`).join(',') :
      null;
  const query = `book=${encodeURIComponent(book)}&min_ev=${minEv}&method=${method}&kelly=${kelly}` +
      `&sharps=${encodeURIComponent(sharpSpec)}&max_hold=${sharpMaxHold}` +
      `${sizingQuery(sizing)}${propsParam(props)}${sportsParam(sport)}${bettableQuery(thresholds, lastValid.current)}`;
  const {data, refreshing, error: evError, retry: evRetry} = useApiStatus(cfg && `/api/ev?${query}`);
  const error = evError || cfgError;
  const retry = () => {
    cfgRetry();
    evRetry();
  };
  return (
    <>
      <TabIntro tab="+EV" />
      <div className="bar filter-bar">
        <button type="button" className="filters-toggle" aria-expanded={filtersOpen} onClick={() => {
          setFiltersOpen((open) => !open);
        }}>{filtersLabel(filterCount({book, minEv, sport, props}, DEFAULT_FILTERS))}</button>
        <span className={`collapsible${filtersOpen ? ' open' : ''}`}>
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
        </span>
        <button type="button" aria-expanded={panel === 'model'} onClick={() => {
          setPanel(panel === 'model' ? null : 'model');
        }}>Model settings</button>
        <button type="button" aria-expanded={panel === 'staking'} onClick={() => {
          setPanel(panel === 'staking' ? null : 'staking');
        }}>Bankroll &amp; staking</button>
      </div>
      {(chips.length > 0 || modeChip) && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c.key} type="button" className="chip" aria-label={`Remove filter ${c.label}`} onClick={() => {
              setters[c.key](clearFilter({book, minEv, sport, props}, c.key)[c.key]);
            }}>{c.label} ✕</button>
          ))}
          {modeChip && (
            <button type="button" className="chip" aria-label="Turn Bettable only back on" onClick={() => {
              setBettable(true);
            }}>{modeChip.label} ✕</button>
          )}
        </div>
      )}
      {hiddenText && (
        <p className="mut small bettable-note" role="status">{hiddenText}. <button type="button" className="secondary" onClick={() => {
          setBettable(showAnyway());
        }}>Show anyway</button></p>
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
          <BettableSettings values={thresholds} onChange={setThresholds} />
        </div>
      )}
      {panel === 'staking' && (
        <div className="panel bar wrap">
          {bankFailed && <span role="alert"><span className="bad">{bankFailed}</span> <button type="button" onClick={bankRetry}>Retry</button></span>}
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
      {zeroStakeNote(data) && (
        <p className="mut small stake-note">{zeroStakeNote(data)} <button type="button" className="secondary" onClick={() => {
          setPanel('staking');
        }}>Open Bankroll &amp; staking</button></p>
      )}
      <TableShell data={data} rows={Array.isArray(data) ? bettableRows : undefined} refreshing={refreshing} error={error} onRetry={retry} what="odds"
        emptyText={hiddenRows.length ? 'Every bet is hidden by Bettable only. Use Show anyway above to see them.' : evEmptyText(data, minEv)} columns={9}>
      <table className="cards">
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
          {sorted(bettableRows, EV_SORT).map((r, i) => (
            <tr key={i}>
              <td className={`num c-ev ${signClass(r.ev_pct)}`}>{percent(r.ev_pct, {signed: true})}</td>
              <td className="c-pick">{r.pick}{badgesFor(r).map((b) => (
                <span key={b.flag} className="chip risk-badge" title={b.tip} tabIndex={0}>{b.label}</span>
              ))}</td>
              <td className="c-market">{marketName(r.market)}</td>
              <td className="c-event">{r.event} <LiveTag row={r} />{r.start && <span className="c-time mut small"> · {eventTime(r.start)}</span>}</td>
              <td className="c-book">{r.book}</td>
              <td className="num c-odds">{formatOdds(r.odds)}</td>
              <td className="num c-fair">{formatOdds(r.fair_odds)}</td>
              <td className="mut small c-sharps">
                {r.sharps.map((s) => `${s.book} ${s.hold_pct.toFixed(1)}%`).join(' · ')}
              </td>
              <td className="num c-stake" title={`${zeroStakeReason(r) ? `${zeroStakeReason(r)}. ` : ''}Raw Kelly $${r.kelly_stake.toFixed(2)}`}>
                {stakeCellText(r) || formatMoney(r.stake)}
              </td>
              <td className="row-actions">
                <div className="row-actions-inner c-actions">
                  <BetLink href={r.link} title={ROW_ACTION_TIPS.bet} label={rowActionAria('bet', false, r)} />
                  <button className={tracked.has(trackKey(r)) ? 'secondary on' : 'secondary'} title={ROW_ACTION_TIPS.track}
                    aria-label={rowActionAria('track', tracked.has(trackKey(r)), r)} onClick={() => {
                    track(r);
                  }}>{trackButtonLabel(tracked.has(trackKey(r)))}</button>
                  {!r.player && (
                    <button className={has(r) ? 'secondary on' : 'secondary'} title={ROW_ACTION_TIPS.slip}
                      aria-label={rowActionAria('slip', has(r), r)}
                      onClick={() => {
                        const added = !has(r);
                        toggle(r);
                        const t = slipToast(added, slip.length + (added ? 1 : -1));
                        toast(t.text, t.kind, t.action);
                      }}>{slipButtonLabel(has(r))}</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableShell>
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

function ArbRow({arb, onTrack}) {
  return (
    <tr>
      <td className="num c-ev"><b className="best">{percent(arb.profit_pct, {digits: 2, signed: true})}</b></td>
      <td className="c-event">
        {arb.event} <LiveTag row={arb} />{' '}<RiskBadges row={arb} />{' '}
        <span className="mut">{arb.sport} · {marketName(arb.market)}</span>
        {arb.warning && <div className="bad">⚠ {arb.warning}</div>}
      </td>
      <td className="c-pick">
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
      </td>
      <td className="num c-stake">
        {formatMoney(arb.total_stake)}
        <div className="mut small">
          profit {formatMoney(arb.min_profit)} to {formatMoney(arb.max_profit)}{arb.capped ? ' · scaled down to max per side' : ''}
        </div>
      </td>
      <td className="row-actions">
        <div className="row-actions-inner c-actions">
          <button className="secondary" title="Log all legs of this arbitrage in the Tracker" onClick={onTrack}>Track legs</button>
        </div>
      </td>
    </tr>
  );
}

function Arbs() {
  const [min, setMin] = useStored('arbMin', 0);
  const [props, setProps] = useStored('arbProps', 'include');
  const [sort, onSort, sorted] = useSort('Arbitrage', {key: 'profit', dir: 'desc'});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sizing = useSizing();
  // No error state: it only sets the placeholder of the total-stake box, which the user can still type into.
  const bank = useApi('/api/bankroll', 30000);
  const {data, refreshing, error, retry} = useApiStatus(`/api/arbs?min_profit=${min}${sizingQuery(sizing, true)}${propsParam(props)}`);
  const bt = useBettableRows(data);
  const filters = {min, props, total: sizing.total > 0 ? sizing.total : ''};
  const setters = {min: setMin, props: setProps, total: sizing.setTotal};
  const chips = arbChips(filters);
  const track = async (row) => {
    const result = await trackLegs(row.legs, (leg) => postJson('/api/bets', {
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
    }));
    if (result.ok) {
      toast(`Tracked ${row.legs.length} legs of ${row.event} (${formatMoney(row.total_stake)} total)`);
    } else {
      toast(result.message, 'err');
    }
    notifyDataChanged();
  };
  return (
    <>
      <TabIntro tab="Arbitrage" />
      <div className="bar filter-bar">
        <button type="button" className="filters-toggle" aria-expanded={filtersOpen} onClick={() => {
          setFiltersOpen((open) => !open);
        }}>{filtersLabel(filterCount(filters, ARB_DEFAULTS))}</button>
        <span className={`collapsible${filtersOpen ? ' open' : ''}`}>
          <label>Min <Term id="arb">arb</Term> profit % <input type="number" step="0.5" value={min} onChange={(e) => {
            setMin(Number(e.target.value));
          }} /></label>
          <label>Market <PropsFilter value={props} onChange={setProps} /></label>
          <label>Total $ (override) <input className="mini" type="number" min="0"
            placeholder={arbTotalPlaceholder(bank)} value={sizing.total} onChange={(e) => {
              sizing.setTotal(e.target.value === '' ? '' : Number(e.target.value));
            }} /></label>
          <button type="button" className="link" onClick={() => {
            const d = arbReset();
            Object.keys(d).forEach((key) => setters[key](d[key]));
          }}>Reset</button>
        </span>
        <span className="mut small">{arbStakingNote({round: sizing.round, max: sizing.max})} (set in Bankroll &amp; staking on +EV)</span>
        {sizing.bad && <span className="bad">max is below the rounding step — ignored</span>}
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c.key} type="button" className="chip" aria-label={`Remove filter ${c.label}`} onClick={() => {
              setters[c.key](ARB_DEFAULTS[c.key]);
            }}>{c.label} ✕</button>
          ))}
        </div>
      )}
      <div className="mut small">{ARB_TOTAL_NOTE}</div>
      {arbMinWarning(min) && <div className="bad">⚠ {arbMinWarning(min)}</div>}
      <ApiError data={data} />
      <RowExample tab="Arbitrage" row={Array.isArray(data) ? data[0] : null} fmt={ROW_FMT} />
      <BettableNote hidden={bt.hidden} on={bt.on} setOn={bt.setOn} />
      <TableShell data={data} rows={Array.isArray(data) ? bt.rows : undefined} refreshing={refreshing} error={error} onRetry={retry} what="arbitrage" emptyText={bt.hidden.length ? 'Every arb is hidden by Bettable only. Use Show anyway above to see them.' : arbsEmptyText(data, min)} columns={5}>
        <table className="cards">
          <thead>
            <tr>
              {ARB_COLUMNS.slice(0, 2).map(([id, label, defaultDir]) => (
                <SortTh key={id} tab="Arbitrage" id={id} label={label} sort={sort} onSort={onSort} defaultDir={defaultDir}
                  num={id === 'profit'} />
              ))}
              <th>Legs</th>
              {ARB_COLUMNS.slice(2).map(([id, label, defaultDir]) => (
                <SortTh key={id} tab="Arbitrage" id={id} label={label} sort={sort} onSort={onSort} defaultDir={defaultDir}
                  num />
              ))}
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {sorted(bt.rows, ARB_SORT).map((r, i) => (
              <ArbRow key={i} arb={r} onTrack={() => {
                track(r);
              }} />
            ))}
          </tbody>
        </table>
      </TableShell>
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

function PromoLeg({leg, boostedOdds}) {
  if (!leg) return null;
  return (
    <>
      <div>{leg.pick} {formatOdds(leg.odds)}
        {leg.promo && boostedOdds != null && <span className="mut"> → {formatOdds(boostedOdds)}</span>} @ {leg.book}</div>
      <div className="mut small">stake {formatMoney(leg.stake)}</div>
    </>
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
  const [sort, onSort, sorted] = useSort('Promos', PROMO_DEFAULT_SORT);
  const {data, error: loadError, retry} = useApiStatus(amount > 0 ? `/api/promo/${kind}?${params}` : null);
  const [promoName] = PROMOS[kind];
  const track = async (row) => {
    const result = await trackLegs(row.legs, (leg) => {
      const boosted = leg.promo && row.boosted_odds != null;
      const promoNote = boosted ? ` (posted ${formatOdds(leg.odds)}, +${boost}%)` : '';
      return fetch('/api/bets', {
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
    });
    notifyDataChanged();
    if (result.ok) toast(`Tracked both legs of ${row.event}`, 'ok', {label: 'Open Tracker', tab: 'Tracker'});
    else toast(result.message, 'err');
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
      {loadError && data == null && amount > 0 && (
        <div role="alert">
          <div className="bad">Couldn't load promos. {loadError}</div>
          <button type="button" onClick={retry}>Retry</button>
        </div>
      )}
      {!(amount > 0) && <p className="mut">Enter an amount above $0 to see promo conversions.</p>}
      {Array.isArray(data) && data.length > 0 && (
        <table className="cards">
          <thead>
            <tr>
              {PROMO_COLUMNS.map(([id, label, defaultDir]) => (
                <SortTh key={id} tab="Promos" id={id} label={label} sort={sort} onSort={onSort}
                  defaultDir={defaultDir} num={PROMO_NUM.has(id)} />
              ))}
              <th aria-label="Track"></th>
            </tr>
          </thead>
          <tbody>
            {sorted(data, PROMO_SORT).map((r, i) => {
              const {bonus, hedge} = promoLegs(r);
              return (
                <tr key={i}>
                  <td className={`num c-ev ${r.profit >= 0 ? 'best' : 'bad'}`}>{r.conversion_pct.toFixed(1)}%</td>
                  <td className="num" data-label="Locked">{formatMoney(r.profit)}</td>
                  <td className="c-event">{r.event} <span className="mut">{r.sport} · {marketName(r.market)}</span></td>
                  <td data-label="Bonus leg"><PromoLeg leg={bonus} boostedOdds={r.boosted_odds} /></td>
                  <td data-label="Hedge leg"><PromoLeg leg={hedge} boostedOdds={r.boosted_odds} /></td>
                  <td className="row-actions">
                    <div className="row-actions-inner c-actions">
                      <button className="secondary" title="Log this promo conversion in the Tracker" onClick={() => {
                        track(r);
                      }}>Track</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {Array.isArray(data) && data.length === 0 && (
        <p className="mut">No two-sided markets with a <Term id="hedge">hedge</Term> at another book.</p>
      )}
    </>
  );
}

function ParlayBookRow({book, onTrack, showStake = true}) {
  return (
    <tr className={book.blocked ? 'blocked' : ''}>
      <td>{book.book}</td>
      <td className="num">{formatOdds(book.odds)}</td>
      <td className={`num ${signClass(book.ev_pct)}`}>{percent(book.ev_pct, {signed: true})}</td>
      <td className="num">{!showStake ? '—' : book.stake == null ? '—' : formatMoney(book.stake)}{showStake && tinyStakeNote(book.stake) && <div className="mut small">{tinyStakeNote(book.stake)}</div>}</td>
      <td className="mut">{book.leg_odds.map((o) => formatOdds(o)).join(' × ')}</td>
      <td>
        {book.blocked ?
          <span className="mut">No SGP</span> :
          <button className="secondary" title="Log this parlay in the Tracker" onClick={onTrack}>Track</button>}
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
  const [bettable] = useBettable();
  const flagState = parlayFlagState(slip, bettable);
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
        if (r.ok) {
          const d = await r.json();
          if (!live) return;
          setResult(d);
          setError(null);
        } else {
          const detail = await errorDetail(r);
          if (!live) return;
          setResult(null);
          setError(typeof detail === 'string' && r.status < 500 ? detail : 'Could not price this parlay. Try again in a moment.');
        }
      }).catch(() => {
        if (!live) return;
        setResult(null);
        setError('Could not reach the server to price this parlay.');
      });
    };
    load();
    window.addEventListener('data-changed', load);
    return () => {
      live = false;
      window.removeEventListener('data-changed', load);
    };
  }, [body]);
  const legStates = legFairProbs(slip.length, result?.missing, result?.legs);
  const priceable = result ? result.legs.length : slip.length;
  const track = async (book) => {
    const picks = result.legs.map((l) => l.pick);
    const stake = flagState.showStake ? legStake({stake: book.stake}) : null;
    if (!flagState.showStake) {
      toast(`${flagState.summary}: no stake is suggested, so nothing was logged. Remove the flagged legs or turn off Bettable only.`, 'err');
      return;
    }
    if (stake == null) {
      toast(`No stake worked out for the parlay at ${book.book}, so nothing was logged. Set a bankroll in +EV first.`, 'err');
      return;
    }
    let response;
    try {
      response = await fetch('/api/bets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        event: [...new Set(result.legs.map((l) => l.event))].join(' / '),
        sport: [...new Set(result.legs.map((l) => l.sport))].join('/'),
        market: 'parlay',
        pick: `${picks.length}-leg parlay: ${picks.join(' + ')}`,
        book: book.book,
        odds: Math.round(book.odds),
        stake,
        ev_pct: book.ev_pct,
        notes: result.legs.map((l, i) => `${l.pick} (${l.event}) ${formatOdds(book.leg_odds[i])}`)
            .join('; '),
      }),
      });
    } catch {
      response = null;
    }
    if (response?.ok) {
      notifyDataChanged();
      toast(`Tracked parlay @ ${book.book}`, 'ok', {label: 'Open Tracker', tab: 'Tracker'});
    } else {
      toast(`Could not log the parlay @ ${book.book}. Nothing was saved.`, 'err');
    }
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
        const {missing, fair} = legStates[i];
        return (
          <div className="card calc" key={legKey(l)}>
            <button className="x" onClick={() => {
              toggle(l);
            }}>✕</button> <b>{l.pick}</b>{' '}
            <span className={l.odds == null || !l.book ? 'bad' : ''}>{slipLegPriceText(l)}</span>{' '}
            <span className="mut">{marketName(l.market)} · {l.event}</span>
            {missing && <span className="bad">{MISSING_LEG_TEXT}</span>}
            {legWarning(l, bettable) && <span className="bad">{legWarning(l, bettable)}</span>}
            {fair != null && <span className="mut">fair {(fair * 100).toFixed(1)}%</span>}
            {result && !missing && fair == null && (
              <span className="mut">no sharp price for this line — EV unknown</span>
            )}
          </div>
        );
      })}
      {slip.length === 1 && <div className="mut">Add at least one more leg.</div>}
      {result && result.missing.length > 0 && priceable < 2 && (
        <div className="mut">Remove the unavailable legs and add more to compare books.</div>
      )}
      {error && (
        <div className="bad">{typeof error === 'string' ? error : 'Could not price this parlay'}</div>
      )}
      {result && priceable >= 2 && (
        <>
          <div className="bar">
            Fair <b>{result.fair_odds == null ? '—' : formatOdds(result.fair_odds)}</b>
            {result.fair_prob != null && (
              <span className="mut">
                {(result.fair_prob * 100).toFixed(2)}% · legs treated as independent. {INDEPENDENT_NOTE}
              </span>
            )}
          </div>
          {flagState.flagged > 0 && (
            <div className="bad" role="status">
              {flagState.summary}. No stake is suggested while a leg is flagged.
            </div>
          )}
          {result.same_game && (
            <div className="bad">
              Same-game legs: correlation is not modelled, and books without same-game parlays are
              blocked.
            </div>
          )}
          <TableShell rows={result.books} data={result.books} columns={6}
            emptyText={`No book offers ${result.legs ? 'all ' + result.legs.length + ' legs' : 'every leg'} at these lines. Remove a leg or try another book.`}>
          <table>
            <thead>
              <tr><th>Book</th><th className="num">Odds</th><th className="num">EV%</th><th className="num">Stake</th><th>Legs</th><th></th></tr>
            </thead>
            <tbody>
              {result.books.map((b) => (
                <ParlayBookRow key={b.book} book={b} showStake={flagState.showStake} onTrack={() => {
                  track(b);
                }} />
              ))}
            </tbody>
          </table>
          </TableShell>
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
  const {data, refreshing, error, retry} = useApiStatus(
      `/api/lowhold?max_hold=${maxHold}&book=${encodeURIComponent(book)}&stake=${stake}${marketParam}`);
  const bt = useBettableRows(data);
  // Nearest miss: only fetched once the filtered list comes back empty.
  const empty = Array.isArray(data) && data.length === 0;
  // No error state: it only adds a "lowest hold is X%" hint to the empty message; the main table has its own error.
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
      <>
      <BettableNote hidden={bt.hidden} on={bt.on} setOn={bt.setOn} />
      <TableShell data={data} rows={Array.isArray(data) ? bt.rows : undefined} refreshing={refreshing} error={error} onRetry={retry} what="low-hold" emptyText={bt.hidden.length ? 'Every row is hidden by Bettable only. Use Show anyway above to see them.' : lowHoldEmptyText(data, maxHold, lowest)} columns={8}>
      <table className="cards">
        <thead>
          <tr>
            {LOW_HOLD_COLUMNS.map(([id, label]) => (
              <SortTh key={id} tab="Low Hold" id={id} label={label} sort={sort} onSort={onSort}
                num={id === 'hold' || id === 'loss'} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted(bt.rows, LOW_HOLD_SORT).map((r, i) => (
            <tr key={i}>
              <td className={`num c-ev ${signClass(-r.hold_pct)}`}>{percent(r.hold_pct, {digits: 2, signed: true})}</td>
              <td className="c-event">{r.event} <LiveTag row={r} /> <span className="mut">{r.sport}</span>{badgesFor(r).length > 0 && ' '}<RiskBadges row={r} /></td>
              <td data-label="Market">{marketName(r.market)}</td>
              <td data-label="Legs">
                {r.legs.map((l, j) => (
                  <div key={j}>{l.pick} {formatOdds(l.odds)} @ {l.book} — ${l.stake.toFixed(2)}</div>
                ))}
              </td>
              <td className={`num ${signClass(-r.expected_loss)}`} data-label="Expected loss">{money(r.expected_loss, {signed: true})}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableShell>
      </>
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
  const {data, refreshing, error, retry} = useApiStatus(`/api/middles?${params}`);
  const bt = useBettableRows(data);
  const track = async (row) => {
    const result = await trackLegs(row.legs, (leg) => fetch('/api/bets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        event: row.event,
        sport: row.sport,
        market: row.market,
        pick: leg.pick,
        book: leg.book,
        odds: leg.odds,
        stake: legStake(leg),
        ev_pct: row.ev_pct,
        notes: `middle ${row.legs.map((x) => x.pick).join(' / ')}`,
      }),
    }));
    notifyDataChanged();
    if (result.ok) {
      toast(`Tracked both legs: ${row.legs.map((l) => `${l.pick} @ ${l.book}`).join(', ')}`, 'ok',
          {label: 'Open Tracker', tab: 'Tracker'});
    } else {
      toast(result.message, 'err');
    }
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
      <>
      <BettableNote hidden={bt.hidden} on={bt.on} setOn={bt.setOn} />
      <TableShell data={data} rows={Array.isArray(data) ? bt.rows : undefined} refreshing={refreshing} error={error} onRetry={retry} what="middles" emptyText={bt.hidden.length ? 'Every middle is hidden by Bettable only. Use Show anyway above to see them.' : middlesEmptyText(data, minWindow, maxCost, minEv)} columns={8}>
      <table className="cards">
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
          {sorted(bt.rows, MIDDLES_SORT).map((r, i) => (
            <tr key={i}>
              <td className={`num c-ev ${signClass(r.ev_pct)}`}>{percent(r.ev_pct, {signed: true})}</td>
              <td className="num" data-label="Hit chance">{percent(r.hit_prob * 100)}</td>
              <td className="c-event">{r.event} <LiveTag row={r} /> <span className="mut">{r.sport}</span>{badgesFor(r).length > 0 && ' '}<RiskBadges row={r} /></td>
              <td data-label="Market">{marketName(r.market)}</td>
              <td data-label="Window">{windowText(r)}</td>
              <td data-label="Legs">
                {r.legs.map((l, j) => (
                  <div key={j}>{l.pick} {formatOdds(l.odds)} @ {l.book} — ${l.stake.toFixed(2)}</div>
                ))}
              </td>
              <td className={`num ${signClass(r.worst_case)}`} data-label="Worst case">{money(r.worst_case, {signed: true})}</td>
              <td className={`num ${signClass(r.win_both)}`} data-label="Win both">{money(r.win_both, {signed: true})}</td>
              <td className="row-actions">
                <div className="row-actions-inner c-actions">
                  <button className="secondary" title="Log this middle in the Tracker" onClick={() => {
                    track(r);
                  }}>Track</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableShell>
      </>
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
function AlertWatcher({role = 'poller'}) {
  const [on, setOn] = useStored('alertsNotify', false);
  const [permission, setPermission] = useState(() => initialPermission());
  // The checkbox (in Settings) and the always-mounted poller are separate instances; keep them in step.
  useEffect(() => {
    const resync = () => {
      setOn(loadStored('alertsNotify', false));
      setPermission(initialPermission());
    };
    window.addEventListener(ALERTS_EVENT, resync);
    return () => window.removeEventListener(ALERTS_EVENT, resync);
  }, []);
  useEffect(() => {
    if (role === 'control' || !on || permission !== 'granted') return undefined;
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
  if (role === 'poller' || permission === 'unsupported') return null;
  const toggle = async () => {
    if (on) {
      setOn(false);
      window.dispatchEvent(new Event(ALERTS_EVENT));
      return;
    }
    const next = permission === 'granted' ?
        permission :
        await Notification.requestPermission();
    setPermission(next);
    setOn(next === 'granted');
    window.dispatchEvent(new Event(ALERTS_EVENT));
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

const BLANK_RULE = {name: '', kind: 'ev', min_value: 2, book: '', market: '', sport: '', ...BLANK_RULE_FIELDS};
const ANY_BOOKS = ['', ...BOOKS];

function Alerts() {
  const [tick, setTick] = useState(0);
  const {data: rules, error: rulesError, retry: rulesRetry} = useApiStatus(`/api/alerts/rules?t=${tick}`, 600000);
  const {data: feed, error: feedError, retry: feedRetry} = useApiStatus(`/api/alerts?t=${tick}`, 30000);
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
    try {
      const response = await fetch(`/api/alerts/rules/${rule.id}`, {method: 'DELETE'});
      if (!response.ok) throw new Error('delete failed');
    } catch {
      toast(`Could not delete the alert rule "${rule.name}". It is still active.`, 'err');
      return;
    }
    reload();
  };
  let discordNote = null;
  if (feed) {
    discordNote = feed.discord ?
        <> <Term id="discord-webhook">Discord webhook</Term> is on.</> :
        <> Discord is optional and set up by whoever runs the server (see <Term id="discord-webhook">Discord webhook</Term>).</>;
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
        <label>
          <input type="checkbox" checked={form.bettable} onChange={(e) => {
            setForm({...form, bettable: e.target.checked});
          }} /> Bettable only
        </label>
        <span className="mut">{BETTABLE_HELP}</span>
        <button className="primary">Add alert</button>
        {formError && <span className="bad" role="alert">{formError}</span>}
      </form>
      <TableShell data={rules} emptyText={alertsRulesEmptyText(rules)} error={rulesError} onRetry={rulesRetry} what="alert rules" columns={8}>
      <table>
        <thead>
          <tr>
            <th>Rule</th><th>Type</th><th>Min</th><th>Book</th><th>Market</th><th>Sport</th><th>Bettable only</th><th></th>
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
              <td>{r.bettable ? 'On' : 'Off'}</td>
              <td><button className="x" onClick={() => {
                remove(r);
              }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableShell>
      <h3>Recent alerts</h3>
      <TableShell data={feed && feed.items} emptyText={alertsEmptyText(feed)} error={feedError} onRetry={feedRetry} what="the alert feed" columns={3}>
      <table>
        <thead>
          <tr><th>When</th><th>Alert</th><th>Rule</th></tr>
        </thead>
        <tbody>
          {(feed?.items || []).map((o) => (
            <tr key={o.id}>
              <td>{eventTime(o.created_at)}</td>
              <td>{o.title}{alertFlagBadges(o).map((label) => <span key={label} className="mut"> [{label}]</span>)}</td>
              <td className="mut">{o.rule_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableShell>
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
  const {data, refreshing, error, retry} = useApiStatus(`/api/sharp-money?window_minutes=${windowMin}&baseline_minutes=${baselineMin}` +
      `&k=${k}&min_volume=${minVolume}`);
  // No error state: it only decides whether to show the optional "set up exchange" hint.
  const status = useApi('/api/sharp-money/status');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filters = {windowMin, baselineMin, k, minVolume};
  const setters = {windowMin: setWindowMin, baselineMin: setBaselineMin, k: setK, minVolume: setMinVolume};
  const chips = sharpChips(filters);
  return (
    <>
      <TabIntro tab="Sharp Money" />
      <div className="bar filter-bar">
        <button type="button" className="filters-toggle" aria-expanded={filtersOpen} onClick={() => {
          setFiltersOpen((open) => !open);
        }}>{filtersLabel(filterCount(filters, SHARP_DEFAULTS))}</button>
        <span className={`collapsible${filtersOpen ? ' open' : ''}`}>
          {SHARP_FIELDS.map((f) => (
            <label key={f.key}>{f.label} <input type="number" step={f.step} min={f.min} value={filters[f.key]}
              onChange={(e) => {
                setters[f.key](f.key === 'minVolume' ?
                    parseNumberInput(e.target.value, filters[f.key]) : positiveInput(e.target.value, filters[f.key]));
              }} /></label>
          ))}
          <button type="button" className="link" onClick={() => {
            const d = sharpReset();
            Object.keys(d).forEach((key) => setters[key](d[key]));
          }}>Reset</button>
        </span>
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c.key} type="button" className="chip" aria-label={`Remove filter ${c.label}`} onClick={() => {
              setters[c.key](SHARP_DEFAULTS[c.key]);
            }}>{c.label} ✕</button>
          ))}
        </div>
      )}
      <div className="mut small sharp-hint" title={sharpHint(filters)}>{sharpHint(filters)}</div>
      <div className="mut small">
        A contract is one share of a yes/no market; it pays $1 if the bet wins.
        Exchange trades are public. A burst of matched volume well above the usual rate points at
        informed money; EV is against the burst&apos;s volume-weighted price.
        {status && status.configured === false && (
          <> <button type="button" onClick={() => {
            window.dispatchEvent(new CustomEvent(GOTO_EVENT, {detail: HELP_TAB}));
          }}>Set up an exchange in Help</button></>
        )}
      </div>
      <TableShell data={data} refreshing={refreshing} error={error} onRetry={retry} what="sharp money" emptyText={sharpEmptyText(data, k, windowMin, status)} columns={8}>
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
      </TableShell>
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
  'Alerts': Alerts,
  'Help': Help,
};

const DEFAULT_TAB = 'Odds Screen';

function loadTab() {
  const fromUrl = parseHash(window.location.hash).tab;
  if (fromUrl) return fromUrl;
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
  const go = (next, push = true) => {
    setTab(next);
    if (push && parseHash(window.location.hash).tab !== next) window.history.pushState(null, '', buildHash(next, {}));
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
    if (!parseHash(window.location.hash).tab) window.history.replaceState(null, '', buildHash(tab, {}));
    const onHash = () => {
      const next = parseHash(window.location.hash).tab;
      if (next) {
        setMoreOpen(false);
        go(next, false);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const live = useLive();
  const [pageKey, setPageKey] = useState(0);
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
        <button className="settings-nav" aria-haspopup="dialog" onClick={() => {
          setSettingsOpen(true);
        }}>{SETTINGS_LABEL}</button>
      </nav>
      <div className="content">
        {showsStrip(tab) && <FreshnessStrip live={live} />}
        <main>{welcome && <Welcome onJump={go} onClose={closeWelcome} />}<WelcomeContext.Provider key={pageKey} value={welcomeTab}><ErrorBoundary key={tab} tab={tab}><Page welcome={welcome} /></ErrorBoundary></WelcomeContext.Provider></main>
      </div>
      <div className="bottom-bar" role="navigation" aria-label="Main">
        {MOBILE_TABS.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} aria-current={t === tab ? 'page' : undefined}
            onClick={() => {
              setMoreOpen(false);
              go(t);
            }}>{t}</button>
        ))}
        <button className={moreOpen || moreTabs().includes(tab) ? 'on' : ''} aria-expanded={moreOpen}
          onClick={() => {
            setMoreOpen((o) => !o);
          }}>More</button>
        {moreOpen && (
          <div className="more-menu" role="menu">
            <button role="menuitem" onClick={() => {
              setMoreOpen(false);
              setWelcomeTab(tab);
            }}>Show welcome</button>
            <button role="menuitem" onClick={() => {
              setMoreOpen(false);
              setSettingsOpen(true);
            }}>{SETTINGS_LABEL}</button>
            {moreTabs().map((t) => (
              <button key={t} role="menuitem" className={t === tab ? 'on' : ''} onClick={() => {
                setMoreOpen(false);
                go(t);
              }}>{navLabel(t, navSlip.slip.length)}</button>
            ))}
          </div>
        )}
      </div>
      <Toaster />
      <AlertWatcher />
      {settingsOpen && <SettingsDialog live={live} onClose={() => {
        setSettingsOpen(false);
      }} onFormat={() => {
        setPageKey((k) => k + 1);
      }} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
