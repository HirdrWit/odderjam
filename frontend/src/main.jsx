import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';

import './style.css';
import {Calculators} from './Calculators.jsx';
import {OddsScreen} from './OddsScreen.jsx';
import {Pickem} from './Pickem.jsx';
import {SizingBar, sizingQuery, useSizing} from './Sizing.jsx';
import {Tracker} from './Tracker.jsx';
import {legKey, useSlip} from './hooks.js';
import {Toaster, postJson, toast, useApi, useStored} from './hooks.jsx';
import {ageText, isProp} from './odds.js';

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

/** Formats a number of seconds as a short "time ago" string. */
function formatAge(seconds) {
  if (seconds == null) return 'never';
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${(seconds / 3600).toFixed(1)}h ago`;
}

/** Formats a number to `digits` decimals; "—" when missing. */
function formatNumber(value, digits = 0) {
  return value == null ? '—' : value.toFixed(digits);
}

/**
 * Live-mode toggle and credit budget (GET/POST /api/live). While live mode is
 * on, refetches the tables every refresh interval.
 */
function LiveBox() {
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
  if (!status) return null;
  return (
    <div className="livebox">
      <label className="chk">
        <input type="checkbox" checked={status.enabled} onChange={(e) => {
          save({enabled: e.target.checked});
        }} /> Live mode
        {status.live_events > 0 && <span className="mut small">({status.live_events} live)</span>}
      </label>
      {status.enabled && (
        <>
          {field('credits_per_hour', 'Credits/hour cap', 0)}
          {field('interval_seconds', 'Refresh every (s)', 5)}
          {field('max_price_age', 'Max price age (s)', 1)}
          <div className="mut small">
            burn {formatNumber(status.planned_rate)}/h · used {formatNumber(status.used_last_hour)} last hour
            {status.projected_hours != null && ` · ~${formatNumber(status.projected_hours, 1)}h left`}
          </div>
        </>
      )}
    </div>
  );
}

/** Live badge and price age shown next to the event name in the tool tables. */
function LiveTag({row}) {
  return (
    <>
      {row.live && <span className="badge live">LIVE</span>}{' '}
      <span className="mut small">{ageText(row.price_age_seconds)}</span>
    </>
  );
}

function RefreshBox() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
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
  return (
    <div className="refresh">
      <div className="mut">
        {info.live ? `Live odds · updated ${formatAge(info.age_seconds)}` : 'Mock data'}
      </div>
      {info.remaining != null && <div className="mut">API credits left: {info.remaining}</div>}
      {info.live && (
        <button onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh odds'}</button>
      )}
      {info.live && <div className="mut small">Each refresh spends API credits</div>}
      {info.live && propCount > 0 && (
        <div className="bad small">
          Player props on ({propCount} markets): each refresh costs about {propCount * 2} more
          credits per game
        </div>
      )}
      <LiveBox />
    </div>
  );
}

/**
 * "Bet" button: opens the sportsbook (deep link to the bet when the feed has
 * one) in a new tab.
 */
function BetLink({href}) {
  if (!href) return null;
  return <a className="bet" href={href} target="_blank" rel="noopener noreferrer">Bet</a>;
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
  return `${amount < 0 ? '-' : ''}$${Math.abs(amount).toFixed(2)}`;
}

function formatPct(value) {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}

/** Returns the CSS class for a positive, negative or zero value. */
function signClass(value) {
  if (value > 0) return 'best';
  if (value < 0) return 'bad';
  return '';
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

function Bankroll({bank, onSetStart}) {
  const onBlur = (e) => {
    const value = Number(e.target.value);
    if (value !== bank.starting) onSetStart(value);
  };
  return (
    <span>
      Bankroll <b className={bank.profit >= 0 ? 'best' : 'bad'}>${bank.current.toFixed(2)}</b>
      <span className="mut">
        start $<input className="mini" type="number" defaultValue={bank.starting}
          onBlur={onBlur} />{' '}
        {bank.profit >= 0 ? '+' : '-'}${Math.abs(bank.profit).toFixed(2)} P/L
      </span>
    </span>
  );
}

function SharpWeights({cfg, weights, maxHold, canReset, onWeight, onMaxHold, onReset}) {
  return (
    <div className="bar wrap">
      Sharp weights {cfg.books.map((b) => (
        <span key={b}>
          {b} <input className="mini" type="number" step="0.25" min="0" value={weights[b] ?? 0}
            onChange={(e) => {
              onWeight(b, Number(e.target.value));
            }} />
        </span>
      ))}
      Max sharp hold % <input className="mini" type="number" step="0.5" value={maxHold}
        onChange={(e) => {
          onMaxHold(Number(e.target.value));
        }} />
      {canReset && <button onClick={onReset}>Reset</button>}
    </div>
  );
}

function PositiveEv() {
  const [minEv, setMinEv] = useStored('evMin', 1);
  const [method, setMethod] = useStored('evMethod', 'multiplicative');
  const [kelly, setKelly] = useStored('evKelly', 0.25);
  const [props, setProps] = useStored('evProps', 'include');
  const [book, setBook] = useState(() => loadEvBook());
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
  const track = async (row) => {
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
      stake: Number(row.stake.toFixed(2)) || 1,
      ev_pct: row.ev_pct,
      strategy: 'ev',
      event_start: row.start,
    });
    if (response.ok) {
      toast(`Tracked ${row.pick} @ ${row.book}`);
    } else {
      toast('Could not track bet', 'err');
    }
    notifyDataChanged();
  };
  const {has, toggle} = useSlip();
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
      `${sizingQuery(sizing)}${propsParam(props)}`;
  const data = useApi(cfg && `/api/ev?${query}`);
  return (
    <>
      <div className="bar">
        Book <select value={book} onChange={(e) => {
          pickBook(e.target.value);
        }}>
          {EV_BOOKS.map((b) => <option key={b} value={b}>{b || 'All books'}</option>)}
        </select>
        Min EV % <input type="number" step="0.5" value={minEv} onChange={(e) => {
          setMinEv(Number(e.target.value));
        }} />
        Devig <select value={method} onChange={(e) => {
          setMethod(e.target.value);
        }}>
          {(cfg?.methods || [method]).map((m) => <option key={m}>{m}</option>)}
        </select>
        {bank && <Bankroll key={`${bank.starting}-${startRejected}`} bank={bank} onSetStart={(v) => {
          setStart(v);
        }} />}
        Kelly <input type="number" step="0.05" value={kelly} onChange={(e) => {
          setKelly(Number(e.target.value));
        }} />
        <SizingBar s={sizing} />
        <PropsFilter value={props} onChange={setProps} />
      </div>
      {cfg && sharpWeights && (
        <SharpWeights cfg={cfg} weights={sharpWeights} maxHold={sharpMaxHold}
          canReset={Boolean(weights) || maxHold != null} onWeight={setWeight} onMaxHold={setMaxHold}
          onReset={() => {
            setWeights(null);
            setMaxHold(null);
          }} />
      )}
      <table>
        <thead>
          <tr>
            <th>EV%</th><th>Pick</th><th>Market</th><th>Event</th><th>Book</th><th>Odds</th>
            <th>Fair</th><th>Sharps (hold)</th><th>Stake</th><th></th>
          </tr>
        </thead>
        <tbody>
          {(data || []).map((r, i) => (
            <tr key={i}>
              <td className="best">{r.ev_pct.toFixed(1)}%</td>
              <td>{r.pick}</td>
              <td>{marketName(r.market)}</td>
              <td>{r.event} <LiveTag row={r} /></td>
              <td>{r.book}</td>
              <td>{formatOdds(r.odds)}</td>
              <td>{formatOdds(r.fair_odds)}</td>
              <td className="mut small">
                {r.sharps.map((s) => `${s.book} ${s.hold_pct.toFixed(1)}%`).join(' · ')}
              </td>
              <td title={`Raw Kelly $${r.kelly_stake.toFixed(2)}`}>{formatMoney(r.stake)}</td>
              <td>
                <BetLink href={r.link} /> <button className="track" onClick={() => {
                  track(r);
                }}>Track</button>{' '}
                {!r.player && (
                  <button className={has(r) ? 'track on' : 'track'} title="Add to parlay slip"
                    onClick={() => {
                      toggle(r);
                    }}>{has(r) ? '✓ Slip' : '+ Slip'}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <b className="best">{arb.profit_pct.toFixed(2)}%</b> {arb.event} <LiveTag row={arb} />{' '}
      <span className="mut">{arb.sport} · {marketName(arb.market)}</span>
      <button className="track right" onClick={onTrack}>Track legs</button>
      {arb.legs.map((leg, j) => (
        <div key={j}>
          {leg.pick} {formatOdds(leg.odds)} @ {leg.book} — stake <b>{formatMoney(leg.stake)}</b>{' '}
          <BetLink href={leg.link} />{' '}
          <span className="mut">
            · profit if wins{' '}
            <span className={leg.profit_if_wins >= 0 ? 'best' : 'bad'}>
              {formatMoney(leg.profit_if_wins)}
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

function Arbs() {
  const [min, setMin] = useStored('arbMin', 0);
  const [props, setProps] = useStored('arbProps', 'include');
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
      <div className="bar">
        Min profit % <input type="number" step="0.5" value={min} onChange={(e) => {
          setMin(Number(e.target.value));
        }} />
        <SizingBar s={sizing} showTotal totalHint={bank ? bank.current.toFixed(0) : 'bankroll'} />
        <PropsFilter value={props} onChange={setProps} />
      </div>
      {(data || []).map((r, i) => (
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
    'Stake is not returned. Bonus goes on the long side; hedge the other side with cash.',
  ],
  'profit-boost': [
    'Profit boost',
    'Cash bet with winnings boosted. Max caps the extra winnings ($).',
  ],
  'second-chance': [
    'Second chance / no-sweat',
    'Cash bet; a loss is refunded as a bonus bet worth the assumed conversion rate.',
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
      <p className="mut">{PROMOS[kind][1]}</p>
      {(Array.isArray(data) ? data : []).map((r, i) => (
        <PromoCard key={i} promo={r} onTrack={() => {
          track(r);
        }} />
      ))}
      {Array.isArray(data) && data.length === 0 && (
        <p className="mut">No two-sided markets with a hedge at another book.</p>
      )}
    </>
  );
}

function ParlayBookRow({book, onTrack}) {
  return (
    <tr className={book.blocked ? 'blocked' : ''}>
      <td>{book.book}</td>
      <td>{formatOdds(book.odds)}</td>
      <td className={signClass(book.ev_pct)}>{formatPct(book.ev_pct)}</td>
      <td>{book.stake == null ? '—' : formatMoney(book.stake)}</td>
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
  const [method] = useStored('evMethod', 'multiplicative');
  const [kelly, setKelly] = useStored('evKelly', 0.25);
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
      <div className="bar">
        Kelly <input type="number" step="0.05" value={kelly} onChange={(e) => {
          setKelly(Number(e.target.value));
        }} />
        <span className="mut">Devig: {method} (set on +EV tab)</span>
        {slip.length > 0 && <button className="x" onClick={() => {
          clear();
        }}>Clear slip</button>}
      </div>
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
                {(result.fair_prob * 100).toFixed(2)}% · legs treated as independent
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
              <tr><th>Book</th><th>Odds</th><th>EV%</th><th>Stake</th><th>Legs</th><th></th></tr>
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

function LowHold() {
  const [maxHold, setMaxHold] = useStored('lhMax', 1);
  const [book, setBook] = useStored('lhBook', '');
  const [stake, setStake] = useStored('lhStake', 100);
  const [market, setMarket] = useStored('lhMarket', '');
  const marketParam = market ? `&market=${market}` : '';
  const data = useApi(
      `/api/lowhold?max_hold=${maxHold}&book=${encodeURIComponent(book)}&stake=${stake}${marketParam}`);
  return (
    <>
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
      <table>
        <thead>
          <tr><th>Hold</th><th>Event</th><th>Market</th><th>Legs</th><th>Exp. loss</th></tr>
        </thead>
        <tbody>
          {(data || []).map((r, i) => (
            <tr key={i}>
              <td className={r.hold_pct <= 0 ? 'best' : ''}>{r.hold_pct.toFixed(2)}%</td>
              <td>{r.event} <LiveTag row={r} /> <span className="mut">{r.sport}</span></td>
              <td>{marketName(r.market)}</td>
              <td>
                {r.legs.map((l, j) => (
                  <div key={j}>{l.pick} {formatOdds(l.odds)} @ {l.book} — ${l.stake.toFixed(2)}</div>
                ))}
              </td>
              <td className={r.expected_loss <= 0 ? 'best' : 'bad'}>{formatMoney(r.expected_loss)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Middles() {
  const [minWindow, setMinWindow] = useStored('midWindow', 0.5);
  const [maxCost, setMaxCost] = useStored('midCost', 5);
  const [market, setMarket] = useStored('midMarket', '');
  const params = new URLSearchParams({min_window: minWindow});
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
  return (
    <>
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
      </div>
      <div className="mut small">
        Per $100 total stake, split so both misses cost the same. EV uses a normal model of the
        result (NFL margins weighted to key numbers).
      </div>
      <table>
        <thead>
          <tr>
            <th>EV%</th><th>Event</th><th>Market</th><th>Window</th><th>Legs</th><th>Worst case</th>
            <th>Win both</th><th>Hit %</th><th></th>
          </tr>
        </thead>
        <tbody>
          {(data || []).map((r, i) => (
            <tr key={i}>
              <td className={r.ev_pct >= 0 ? 'best' : 'bad'}>{r.ev_pct.toFixed(1)}%</td>
              <td>{r.event} <LiveTag row={r} /> <span className="mut">{r.sport}</span></td>
              <td>{marketName(r.market)}</td>
              <td>{r.window}</td>
              <td>
                {r.legs.map((l, j) => (
                  <div key={j}>{l.pick} {formatOdds(l.odds)} @ {l.book} — ${l.stake.toFixed(2)}</div>
                ))}
              </td>
              <td className={r.worst_case >= 0 ? 'best' : 'bad'}>{formatMoney(r.worst_case)}</td>
              <td className="best">{formatMoney(r.win_both)}</td>
              <td>{(r.hit_prob * 100).toFixed(1)}%</td>
              <td><button className="track" onClick={() => {
                track(r);
              }}>Track</button></td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const reload = () => {
    setTick((t) => t + 1);
  };
  const field = (key) => (e) => {
    setForm({...form, [key]: e.target.value});
  };
  const add = async (e) => {
    e.preventDefault();
    await fetch('/api/alerts/rules', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({...form, min_value: Number(form.min_value)}),
    });
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
        ' Discord webhook is on.' :
        ' Set DISCORD_WEBHOOK_URL to also post to Discord.';
  }
  return (
    <>
      <p className="mut">
        Rules are checked after each odds fetch that already happens. Alerts never spend extra API
        credits.
        {discordNote}
      </p>
      <form className="bar wrap" onSubmit={add}>
        <select value={form.kind} onChange={field('kind')}>
          <option value="ev">+EV</option><option value="arb">Arbitrage</option>
        </select>
        Min % <input type="number" step="0.5" value={form.min_value} onChange={field('min_value')} />
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
      <table>
        <thead>
          <tr><th>When</th><th>Alert</th><th>Rule</th></tr>
        </thead>
        <tbody>
          {(feed?.items || []).map((o) => (
            <tr key={o.id}>
              <td>{new Date(o.created_at).toLocaleString()}</td>
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
  return (
    <>
      <div className="bar">
        Last <input type="number" step="1" min="1" value={windowMin} onChange={(e) => {
          setWindowMin(positiveInput(e.target.value, windowMin));
        }} /> min
        vs prior <input type="number" step="10" min="1" value={baselineMin} onChange={(e) => {
          setBaselineMin(positiveInput(e.target.value, baselineMin));
        }} /> min
        Spike × <input type="number" step="0.5" min="0.5" value={k} onChange={(e) => {
          setK(positiveInput(e.target.value, k));
        }} />
        Min contracts <input type="number" step="100" min="0" value={minVolume} onChange={(e) => {
          setMinVolume(parseNumberInput(e.target.value, minVolume));
        }} />
      </div>
      <div className="mut small">
        Exchange trades are public. A burst of matched volume well above the usual rate points at
        informed money; EV is against the burst&apos;s volume-weighted price. Needs EXCHANGES=Kalshi.
      </div>
      <table>
        <thead>
          <tr>
            <th>Event</th><th>Side</th><th>Exchange</th><th>Volume</th><th>× usual</th>
            <th>Spike price</th><th>Books paying more</th>
          </tr>
        </thead>
        <tbody>
          {(Array.isArray(data) ? data : []).map((r, i) => (
            <tr key={i}>
              <td>{r.event} <span className="mut">{r.sport}</span></td>
              <td>{r.outcome}</td>
              <td>{r.exchange}</td>
              <td>{Math.round(r.volume)} <span className="mut">({r.trades} trades)</span></td>
              <td>{r.ratio === null ? 'new' : `${r.ratio.toFixed(1)}×`}</td>
              <td>{formatOdds(r.price)} <span className="mut">{r.vwap_cents.toFixed(1)}¢</span></td>
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

function App() {
  const [tab, setTab] = useState(() => loadTab());
  const go = (next) => {
    setTab(next);
    try {
      localStorage.setItem('tab', next);
    } catch {
      // Storage can be unavailable; the choice just is not remembered.
    }
  };
  const Page = TABS[tab];
  return (
    <div className="app">
      <nav>
        <h1>Odderjam</h1>
        {Object.keys(TABS).map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => {
            go(t);
          }}>{t}</button>
        ))}
        <RefreshBox />
        <AlertWatcher />
      </nav>
      <main><Page /></main>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
