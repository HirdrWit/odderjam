import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';

import './style.css';
import {Calculators} from './Calculators.jsx';

// Field names such as `age_seconds` and `closing_odds` come straight from the
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

/** Reads a JSON value from localStorage, or `fallback` if absent. */
function loadStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored == null ? fallback : JSON.parse(stored);
  } catch {
    // Storage can be unavailable or hold invalid JSON; use the fallback.
    return fallback;
  }
}

/** Writes a value to localStorage as JSON. */
function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the value just is not remembered.
  }
}

/** Like useState, but the value is persisted to localStorage under `key`. */
function useStored(key, initial) {
  const [value, setValue] = useState(() => loadStored(key, initial));
  const update = (next) => {
    setValue(next);
    saveStored(key, next);
  };
  return [value, update];
}

/**
 * Fetches JSON from `url`, refetching every `every` ms and whenever a
 * 'data-changed' event fires.
 */
function useApi(url, every = 60000) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      fetch(url).then((r) => r.json()).then((d) => {
        if (live) setData(d);
      });
    };
    load();
    const timer = setInterval(load, every);
    window.addEventListener('data-changed', load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('data-changed', load);
    };
  }, [url]);
  return data;
}

/** Formats a number of seconds as a short "time ago" string. */
function formatAge(seconds) {
  if (seconds == null) return 'never';
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${(seconds / 3600).toFixed(1)}h ago`;
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
      window.dispatchEvent(new Event('data-changed'));
    } finally {
      setBusy(false);
    }
  };
  if (!info) return null;
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
    </div>
  );
}

const MARKETS = {moneyline: 'Moneyline', spreads: 'Spread', totals: 'Total'};

/** Formats a spread or total line; spreads get a leading sign. */
function formatPoint(point, isTotal) {
  if (point == null) return '';
  if (isTotal || point <= 0) return `${point}`;
  return `+${point}`;
}

function outcomeLabel(outcome) {
  if (outcome.point == null) return outcome.name;
  const isTotal = outcome.name === 'Over' || outcome.name === 'Under';
  return `${outcome.name} ${formatPoint(outcome.point, isTotal)}`;
}

function bestPrice(outcome) {
  return Math.max(...Object.values(outcome.prices));
}

function EventCard({event, market, open, onToggle}) {
  const outcomes = event.markets[market];
  const books = [...new Set(outcomes.flatMap((o) => Object.keys(o.prices)))];
  const bestFor = (name) => outcomes.filter((o) => o.name === name).reduce(
      (best, o) => (!best || bestPrice(o) > bestPrice(best) ? o : best), null);
  const names = [...new Set(outcomes.map((o) => o.name))];
  const bestSummary = names.map((name) => {
    const outcome = bestFor(name);
    return `${outcomeLabel(outcome)} ${formatOdds(bestPrice(outcome))}`;
  }).join(' · ');
  const outcomeKey = (o) => `${o.name}${o.point}`;
  return (
    <div className="card" onClick={onToggle}>
      <b>{event.away} @ {event.home}</b>{' '}
      <span className="mut">{event.sport} · {new Date(event.start).toLocaleString()}</span>
      <div className="mut">Best: {bestSummary}</div>
      {open && (
        <table>
          <thead>
            <tr>
              <th>Book</th>
              {outcomes.map((o) => <th key={outcomeKey(o)}>{outcomeLabel(o)}</th>)}
            </tr>
          </thead>
          <tbody>
            {books.map((book) => (
              <tr key={book}>
                <td>{book}</td>
                {outcomes.map((o) => (
                  <td key={outcomeKey(o)} className={o.prices[book] === bestPrice(o) ? 'best' : ''}>
                    {o.prices[book] == null ? '' : formatOdds(o.prices[book])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OddsScreen() {
  const [sport, setSport] = useStored('oddsSport', '');
  const [market, setMarket] = useStored('oddsMarket', 'moneyline');
  const data = useApi(`/api/odds${sport ? `?sport=${sport}` : ''}`);
  const [open, setOpen] = useState(null);
  return (
    <>
      <div className="bar">
        <select value={sport} onChange={(e) => {
          setSport(e.target.value);
        }}>
          {['', 'NBA', 'NFL', 'MLB', 'NHL'].map((s) => (
            <option key={s} value={s}>{s || 'All sports'}</option>
          ))}
        </select>
        <select value={market} onChange={(e) => {
          setMarket(e.target.value);
        }}>
          {Object.entries(MARKETS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
      {(data || []).filter((e) => e.markets[market]).map((e) => (
        <EventCard key={e.id} event={e} market={market} open={open === e.id} onToggle={() => {
          setOpen(open === e.id ? null : e.id);
        }} />
      ))}
    </>
  );
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

const BLANK_BET = {
  event: '',
  sport: '',
  pick: '',
  book: '',
  odds: '',
  stake: '',
  closing_odds: '',
  status: 'pending',
};

/** Serialises a bet form for the API, converting numeric fields. */
function betBody(bet) {
  const closing = bet.closing_odds === '' || bet.closing_odds == null ?
      null :
      Number(bet.closing_odds);
  return JSON.stringify({
    ...bet,
    odds: Number(bet.odds),
    stake: Number(bet.stake),
    closing_odds: closing,
  });
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
  return (
    <tr>
      <td>{new Date(bet.placed_at).toLocaleDateString()}</td>
      <td>{bet.pick}</td>
      <td>{bet.event}</td>
      <td>{bet.book}</td>
      <td>
        <input className="mini" type="number" defaultValue={bet.odds}
          onBlur={patchNumber('odds', bet.odds)} />
      </td>
      <td>
        <input className="mini" type="number" step="0.01" defaultValue={bet.stake}
          onBlur={patchNumber('stake', bet.stake)} />
      </td>
      <td>
        <input className="mini" type="number" defaultValue={bet.closing_odds ?? ''}
          placeholder="—" onBlur={patchClosing} />
      </td>
      <td className={signClass(bet.clv_pct)}>{formatPct(bet.clv_pct)}</td>
      <td>
        <select value={bet.status} onChange={(e) => {
          onPatch({status: e.target.value});
        }}>
          {['pending', 'won', 'lost', 'push', 'void'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </td>
      <td className={signClass(bet.profit)}>{formatMoney(bet.profit)}</td>
      <td><button className="x" onClick={onDelete}>✕</button></td>
    </tr>
  );
}

function GroupTable({title, groups}) {
  return (
    <table>
      <thead>
        <tr><th>{title}</th><th>Bets</th><th>Staked</th><th>Profit</th><th>ROI</th></tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.name}>
            <td>{g.name}</td>
            <td>{g.bets}</td>
            <td>{formatMoney(g.staked)}</td>
            <td className={g.profit >= 0 ? 'best' : 'bad'}>{formatMoney(g.profit)}</td>
            <td>{formatPct(g.roi_pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const GROUPS = {by_sport: 'Sport', by_book: 'Book'};

function Tracker() {
  const [tick, setTick] = useState(0);
  const bets = useApi(`/api/bets?t=${tick}`, 600000);
  const stats = useApi(`/api/bets/stats?t=${tick}`, 600000);
  const [form, setForm] = useState(BLANK_BET);
  const reload = () => {
    setTick((t) => t + 1);
  };
  const add = async (e) => {
    e.preventDefault();
    await fetch('/api/bets', {method: 'POST', headers: JSON_HEADERS, body: betBody(form)});
    setForm(BLANK_BET);
    reload();
  };
  const patch = async (bet, change) => {
    await fetch(`/api/bets/${bet.id}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: betBody({...bet, ...change}),
    });
    reload();
  };
  const remove = async (bet) => {
    if (!confirm(`Delete ${bet.pick}?`)) return;
    await fetch(`/api/bets/${bet.id}`, {method: 'DELETE'});
    reload();
  };
  const field = (key) => (e) => {
    setForm({...form, [key]: e.target.value});
  };
  const tiles = stats && [
    ['Profit', formatMoney(stats.profit), stats.profit >= 0 ? 'best' : 'bad'],
    ['ROI', formatPct(stats.roi_pct)],
    ['Win rate', formatPct(stats.win_rate_pct)],
    ['Staked', formatMoney(stats.staked)],
    ['Avg CLV', formatPct(stats.avg_clv_pct)],
    ['Pending', stats.pending],
  ];
  return (
    <>
      <div className="tiles">
        {(tiles || []).map(([label, value, cls]) => (
          <div className="card tile" key={label}>
            <div className="mut">{label}</div>
            <b className={cls}>{value}</b>
          </div>
        ))}
      </div>
      <form className="bar wrap" onSubmit={add}>
        <input placeholder="Pick *" required value={form.pick} onChange={field('pick')} />
        <input placeholder="Event" value={form.event} onChange={field('event')} />
        <input placeholder="Sport" value={form.sport} onChange={field('sport')} />
        <input placeholder="Book" value={form.book} onChange={field('book')} />
        <input placeholder="Odds *" required type="number" value={form.odds}
          onChange={field('odds')} />
        <input placeholder="Stake *" required type="number" step="0.01" value={form.stake}
          onChange={field('stake')} />
        <button className="primary">Add bet</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Pick</th><th>Event</th><th>Book</th><th>Odds</th><th>Stake</th>
            <th>Close</th><th>CLV</th><th>Status</th><th>P/L</th><th></th>
          </tr>
        </thead>
        <tbody>
          {(bets || []).map((b) => (
            <BetRow key={`${b.id}-${b.odds}-${b.stake}-${b.closing_odds}`} bet={b}
              onPatch={(change) => {
                patch(b, change);
              }}
              onDelete={() => {
                remove(b);
              }} />
          ))}
        </tbody>
      </table>
      {stats && Object.entries(GROUPS).map(([key, title]) => stats[key].length > 0 && (
        <GroupTable key={key} title={title} groups={stats[key]} />
      ))}
    </>
  );
}

const EV_BOOKS = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'bet365', 'BetRivers', 'Fanatics', 'ESPN BET',
  'Hard Rock Bet', '',
];

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

function PositiveEv() {
  const [minEv, setMinEv] = useStored('evMin', 1);
  const [method, setMethod] = useStored('evMethod', 'multiplicative');
  const [kelly, setKelly] = useStored('evKelly', 0.25);
  const [book, setBook] = useState(() => loadEvBook());
  const bank = useApi('/api/bankroll', 30000);
  const setStart = async (starting) => {
    await fetch('/api/bankroll', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({starting}),
    });
    window.dispatchEvent(new Event('data-changed'));
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
    await fetch('/api/bets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        event: row.event,
        sport: row.sport,
        market: row.market,
        pick: row.pick,
        book: row.book,
        odds: row.odds,
        stake: Number(row.stake.toFixed(2)) || 1,
        ev_pct: row.ev_pct,
      }),
    });
    alert(`Tracked ${row.pick} @ ${row.book}`);
  };
  const query = `book=${encodeURIComponent(book)}&min_ev=${minEv}&method=${method}&kelly=${kelly}`;
  const data = useApi(`/api/ev?${query}`);
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
          <option>multiplicative</option><option>power</option><option>worst_case</option>
        </select>
        {bank && <Bankroll bank={bank} onSetStart={(v) => {
          setStart(v);
        }} />}
        Kelly <input type="number" step="0.05" value={kelly} onChange={(e) => {
          setKelly(Number(e.target.value));
        }} />
      </div>
      <table>
        <thead>
          <tr>
            <th>EV%</th><th>Pick</th><th>Market</th><th>Event</th><th>Book</th><th>Odds</th>
            <th>Fair</th><th>Stake</th><th></th>
          </tr>
        </thead>
        <tbody>
          {(data || []).map((r, i) => (
            <tr key={i}>
              <td className="best">{r.ev_pct.toFixed(1)}%</td>
              <td>{r.pick}</td>
              <td>{MARKETS[r.market] || r.market}</td>
              <td>{r.event}</td>
              <td>{r.book}</td>
              <td>{formatOdds(r.odds)}</td>
              <td>{formatOdds(r.fair_odds)}</td>
              <td>${r.stake.toFixed(2)}</td>
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

function Arbs() {
  const [min, setMin] = useStored('arbMin', 0);
  const data = useApi(`/api/arbs?min_profit=${min}`);
  return (
    <>
      <div className="bar">
        Min profit % <input type="number" step="0.5" value={min} onChange={(e) => {
          setMin(Number(e.target.value));
        }} />
      </div>
      {(data || []).map((r, i) => (
        <div className="card" key={i}>
          <b className="best">{r.profit_pct.toFixed(2)}%</b> {r.event}{' '}
          <span className="mut">{r.sport} · {MARKETS[r.market] || r.market}</span>
          {r.legs.map((leg, j) => (
            <div key={j}>
              {leg.pick} {formatOdds(leg.odds)} @ {leg.book} — stake ${leg.stake.toFixed(2)} of $100
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

const TABS = {
  'Odds Screen': OddsScreen,
  '+EV': PositiveEv,
  'Arbitrage': Arbs,
  'Calculator': Calculators,
  'Tracker': Tracker,
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
      </nav>
      <main><Page /></main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
