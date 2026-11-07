import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import Calculators from "./Calculators.jsx";

const fmt = (o) => (o > 0 ? `+${Math.round(o)}` : `${Math.round(o)}`);

function useStored(key, init) {
  const [v, setV] = useState(() => { try { const x = localStorage.getItem(key); return x == null ? init : JSON.parse(x); } catch { return init; } });
  return [v, (n) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch {} }];
}

function useApi(url, every = 60000) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch(url).then((r) => r.json()).then((d) => live && setData(d));
    load();
    const t = setInterval(load, every);
    window.addEventListener("data-changed", load);
    return () => { live = false; clearInterval(t); window.removeEventListener("data-changed", load); };
  }, [url]);
  return data;
}

const age = (s) => s == null ? "never" : s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${(s / 3600).toFixed(1)}h ago`;

function RefreshBox() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/cache").then((r) => r.json()).then(setInfo);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try { setInfo(await (await fetch("/api/refresh", { method: "POST" })).json()); window.dispatchEvent(new Event("data-changed")); }
    finally { setBusy(false); }
  };
  if (!info) return null;
  return (
    <div className="refresh">
      <div className="mut">{info.live ? `Live odds · updated ${age(info.age_seconds)}` : "Mock data"}</div>
      {info.remaining != null && <div className="mut">API credits left: {info.remaining}</div>}
      {info.live && <button onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh odds"}</button>}
      {info.live && <div className="mut small">Each refresh spends API credits</div>}
      {info.live && info.prop_markets?.length > 0 && (
        <div className="bad small">Player props on ({info.prop_markets.length} markets): each refresh costs about {info.prop_markets.length * 2} more credits per game</div>)}
    </div>
  );
}

const MARKETS = { moneyline: "Moneyline", spreads: "Spread", totals: "Total" };
const isProp = (k) => /^(player|batter|pitcher)_/.test(k);
// "player_points" -> "Points", "batter_total_bases" -> "Total Bases"
const propName = (k) => k.replace(/^(player|batter|pitcher)_/, "").split("_")
  .filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(" ");
const marketName = (k) => MARKETS[k] || (isProp(k) ? propName(k) : k);
const PROP_FILTER = { include: "Include props", mainlines: "Mainlines only" };
const propsParam = (f) => (f === "mainlines" ? "&props=false" : "");
const pt = (p, total) => (p == null ? "" : total ? `${p}` : p > 0 ? `+${p}` : `${p}`);
const outcomeLabel = (o) => `${o.name}${o.point == null ? "" : ` ${pt(o.point, o.name === "Over" || o.name === "Under")}`}`;

function OddsScreen() {
  const [sport, setSport] = useStored("oddsSport", "");
  const [market, setMarket] = useStored("oddsMarket", "moneyline");
  const data = useApi(`/api/odds${sport ? `?sport=${sport}` : ""}`);
  const [open, setOpen] = useState(null);
  return (
    <>
      <div className="bar">
        <select value={sport} onChange={(e) => setSport(e.target.value)}>
          {["", "NBA", "NFL", "MLB", "NHL"].map((s) => <option key={s} value={s}>{s || "All sports"}</option>)}
        </select>
        <select value={market} onChange={(e) => setMarket(e.target.value)}>
          {Object.entries({ ...MARKETS, props: "Player props" }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {market === "props" && (data || []).map((e) => <PropsCard key={e.id} event={e} open={open === e.id} toggle={() => setOpen(open === e.id ? null : e.id)} />)}
      {market !== "props" && (data || []).filter((e) => e.markets[market]).map((e) => {
        const outs = e.markets[market];
        const books = [...new Set(outs.flatMap((o) => Object.keys(o.prices)))];
        const best = (o) => Math.max(...Object.values(o.prices));
        const bestBy = (name) => outs.filter((o) => o.name === name).reduce((a, o) => (!a || best(o) > best(a) ? o : a), null);
        const names = [...new Set(outs.map((o) => o.name))];
        return (
          <div className="card" key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
            <b>{event.away} @ {event.home}</b> <span className="mut">{event.sport} · {new Date(event.start).toLocaleString()}</span>
            <div className="mut">Best: {names.map((n) => { const o = bestBy(n); return `${outcomeLabel(o)} ${fmt(best(o))}`; }).join(" · ")}</div>
            {open === e.id && (
              <table><thead><tr><th>Book</th>{outs.map((o) => <th key={`${o.name}${o.point}`}>{outcomeLabel(o)}</th>)}</tr></thead><tbody>
                {books.map((b) => (
                  <tr key={b}><td>{b}</td>
                    {outs.map((o) => <td key={`${o.name}${o.point}`} className={o.prices[b] === best(o) ? "best" : ""}>{o.prices[b] == null ? "" : fmt(o.prices[b])}</td>)}</tr>
                ))}
              </tbody></table>
            )}
          </div>
        );
      })}
    </>
  );
}

function PropsCard({ event, open, toggle }) {
  const keys = Object.keys(event.markets).filter(isProp);
  if (!keys.length) return null;
  // One row per (prop, player, side, line); outcomes sorted so Over/Under at a line sit together.
  const rows = keys.flatMap((k) => [...event.markets[k]]
    .sort((a, b) => (a.player || "").localeCompare(b.player || "") || a.point - b.point || a.name.localeCompare(b.name))
    .map((o) => ({ k, o })));
  const books = [...new Set(rows.flatMap(({ o }) => Object.keys(o.prices)))];
  const players = new Set(rows.map(({ o }) => o.player));
  return (
    <div className="card" onClick={toggle}>
      <b>{event.away} @ {event.home}</b> <span className="mut">{event.sport} · {new Date(event.start).toLocaleString()}</span>
      <div className="mut">{players.size} players · {keys.map(propName).join(", ")}</div>
      {open && (
        <table><thead><tr><th>Player</th><th>Prop</th><th>Pick</th>{books.map((b) => <th key={b}>{b}</th>)}</tr></thead><tbody>
          {rows.map(({ k, o }) => {
            const best = Math.max(...Object.values(o.prices));
            return (
              <tr key={`${k}${o.player}${o.name}${o.point}`}><td>{o.player}</td><td>{propName(k)}</td><td>{outcomeLabel(o)}</td>
                {books.map((b) => <td key={b} className={o.prices[b] === best ? "best" : ""}>{o.prices[b] == null ? "" : fmt(o.prices[b])}</td>)}</tr>
            );
          })}
        </tbody></table>
      )}
    </div>
  );
}

const money = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const pct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`);
const blank = { event: "", sport: "", pick: "", book: "", odds: "", stake: "", closing_odds: "", status: "pending" };

function Tracker() {
  const [tick, setTick] = useState(0);
  const bets = useApi(`/api/bets?t=${tick}`, 600000);
  const stats = useApi(`/api/bets/stats?t=${tick}`, 600000);
  const [f, setF] = useState(blank);
  const reload = () => setTick((t) => t + 1);
  const body = (b) => JSON.stringify({ ...b, odds: +b.odds, stake: +b.stake,
    closing_odds: b.closing_odds === "" || b.closing_odds == null ? null : +b.closing_odds });
  const add = async (e) => {
    e.preventDefault();
    await fetch("/api/bets", { method: "POST", headers: { "Content-Type": "application/json" }, body: body(f) });
    setF(blank); reload();
  };
  const patch = async (b, change) => {
    await fetch(`/api/bets/${b.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: body({ ...b, ...change }) });
    reload();
  };
  const del = async (b) => { if (confirm(`Delete ${b.pick}?`)) { await fetch(`/api/bets/${b.id}`, { method: "DELETE" }); reload(); } };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tiles = stats && [
    ["Profit", money(stats.profit), stats.profit >= 0 ? "best" : "bad"], ["ROI", pct(stats.roi_pct)],
    ["Win rate", pct(stats.win_rate_pct)], ["Staked", money(stats.staked)],
    ["Avg CLV", pct(stats.avg_clv_pct)], ["Pending", stats.pending],
  ];
  return (
    <>
      <div className="tiles">{(tiles || []).map(([k, v, c]) => <div className="card tile" key={k}><div className="mut">{k}</div><b className={c}>{v}</b></div>)}</div>
      <form className="bar wrap" onSubmit={add}>
        <input placeholder="Pick *" required value={f.pick} onChange={set("pick")} />
        <input placeholder="Event" value={f.event} onChange={set("event")} />
        <input placeholder="Sport" value={f.sport} onChange={set("sport")} />
        <input placeholder="Book" value={f.book} onChange={set("book")} />
        <input placeholder="Odds *" required type="number" value={f.odds} onChange={set("odds")} />
        <input placeholder="Stake *" required type="number" step="0.01" value={f.stake} onChange={set("stake")} />
        <button className="primary">Add bet</button>
      </form>
      <table><thead><tr><th>Date</th><th>Pick</th><th>Event</th><th>Book</th><th>Odds</th><th>Stake</th><th>Close</th><th>CLV</th><th>Status</th><th>P/L</th><th></th></tr></thead><tbody>
        {(bets || []).map((b) => (
          <tr key={`${b.id}-${b.odds}-${b.stake}-${b.closing_odds}`}><td>{new Date(b.placed_at).toLocaleDateString()}</td><td>{b.pick}</td><td>{b.event}</td><td>{b.book}</td>
            <td><input className="mini" type="number" defaultValue={b.odds}
              onBlur={(e) => e.target.value !== "" && +e.target.value !== b.odds && patch(b, { odds: e.target.value })} /></td>
            <td><input className="mini" type="number" step="0.01" defaultValue={b.stake}
              onBlur={(e) => e.target.value !== "" && +e.target.value !== b.stake && patch(b, { stake: e.target.value })} /></td>
            <td><input className="mini" type="number" defaultValue={b.closing_odds ?? ""} placeholder="—"
              onBlur={(e) => e.target.value !== String(b.closing_odds ?? "") && patch(b, { closing_odds: e.target.value })} /></td>
            <td className={b.clv_pct > 0 ? "best" : b.clv_pct < 0 ? "bad" : ""}>{pct(b.clv_pct)}</td>
            <td><select value={b.status} onChange={(e) => patch(b, { status: e.target.value })}>
              {["pending", "won", "lost", "push", "void"].map((x) => <option key={x}>{x}</option>)}</select></td>
            <td className={b.profit > 0 ? "best" : b.profit < 0 ? "bad" : ""}>{money(b.profit)}</td>
            <td><button className="x" onClick={() => del(b)}>✕</button></td></tr>
        ))}
      </tbody></table>
      {stats && ["by_sport", "by_book"].map((k) => stats[k].length > 0 && (
        <table key={k}><thead><tr><th>{k === "by_sport" ? "Sport" : "Book"}</th><th>Bets</th><th>Staked</th><th>Profit</th><th>ROI</th></tr></thead><tbody>
          {stats[k].map((g) => <tr key={g.name}><td>{g.name}</td><td>{g.bets}</td><td>{money(g.staked)}</td>
            <td className={g.profit >= 0 ? "best" : "bad"}>{money(g.profit)}</td><td>{pct(g.roi_pct)}</td></tr>)}
        </tbody></table>))}
    </>
  );
}

function PositiveEV() {
  const [minEv, setMinEv] = useStored("evMin", 1);
  const [method, setMethod] = useStored("evMethod", "multiplicative");
  const [kelly, setKelly] = useStored("evKelly", 0.25);
  const [props, setProps] = useStored("evProps", "include");
  const [book, setBook] = useState(() => localStorage.getItem("evBook") ?? "DraftKings");
  const bank = useApi("/api/bankroll", 30000);
  const setStart = async (v) => {
    await fetch("/api/bankroll", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starting: v }) });
    window.dispatchEvent(new Event("data-changed"));
  };
  const pickBook = (b) => { setBook(b); localStorage.setItem("evBook", b); };
  const track = async (r) => {
    await fetch("/api/bets", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: r.event, sport: r.sport, market: r.market, pick: r.pick, book: r.book, odds: r.odds,
        stake: +r.stake.toFixed(2) || 1, ev_pct: r.ev_pct }) });
    alert(`Tracked ${r.pick} @ ${r.book}`);
  };
  const data = useApi(`/api/ev?book=${encodeURIComponent(book)}&min_ev=${minEv}&method=${method}&kelly=${kelly}${propsParam(props)}`);
  return (
    <>
      <div className="bar">
        Book <select value={book} onChange={(e) => pickBook(e.target.value)}>
          {["DraftKings", "FanDuel", "BetMGM", "Caesars", "bet365", "BetRivers", "Fanatics", "ESPN BET", "Hard Rock Bet", ""].map((b) => <option key={b} value={b}>{b || "All books"}</option>)}</select>
        Min EV % <input type="number" step="0.5" value={minEv} onChange={(e) => setMinEv(+e.target.value)} />
        Devig <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option>multiplicative</option><option>power</option><option>worst_case</option></select>
        {bank && <span>Bankroll <b className={bank.profit >= 0 ? "best" : "bad"}>${bank.current.toFixed(2)}</b>
          <span className="mut">start $<input className="mini" type="number" defaultValue={bank.starting}
            onBlur={(e) => +e.target.value !== bank.starting && setStart(+e.target.value)} /> {bank.profit >= 0 ? "+" : "-"}${Math.abs(bank.profit).toFixed(2)} P/L</span></span>}
        Kelly <input type="number" step="0.05" value={kelly} onChange={(e) => setKelly(+e.target.value)} />
        <PropsFilter value={props} onChange={setProps} />
      </div>
      <table><thead><tr><th>EV%</th><th>Pick</th><th>Market</th><th>Event</th><th>Book</th><th>Odds</th><th>Fair</th><th>Stake</th><th></th></tr></thead><tbody>
        {(data || []).map((r, i) => (
          <tr key={i}><td className="best">{r.ev_pct.toFixed(1)}%</td><td>{r.pick}</td><td>{marketName(r.market)}</td><td>{r.event}</td>
            <td>{r.book}</td><td>{fmt(r.odds)}</td><td>{fmt(r.fair_odds)}</td><td>${r.stake.toFixed(2)}</td>
            <td><button className="track" onClick={() => track(r)}>Track</button></td></tr>
        ))}
      </tbody></table>
    </>
  );
}

function PropsFilter({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(PROP_FILTER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

function Arbs() {
  const [min, setMin] = useStored("arbMin", 0);
  const [props, setProps] = useStored("arbProps", "include");
  const data = useApi(`/api/arbs?min_profit=${min}${propsParam(props)}`);
  return (
    <>
      <div className="bar">Min profit % <input type="number" step="0.5" value={min} onChange={(e) => setMin(+e.target.value)} />
        <PropsFilter value={props} onChange={setProps} /></div>
      {(data || []).map((r, i) => (
        <div className="card" key={i}>
          <b className="best">{r.profit_pct.toFixed(2)}%</b> {r.event} <span className="mut">{r.sport} · {marketName(r.market)}</span>
          {r.legs.map((l, j) => <div key={j}>{l.pick} {fmt(l.odds)} @ {l.book} — stake ${l.stake.toFixed(2)} of $100</div>)}
        </div>
      ))}
    </>
  );
}

const TABS = { "Odds Screen": OddsScreen, "+EV": PositiveEV, Arbitrage: Arbs, Calculator: Calculators, Tracker };
function App() {
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem("tab"); return t in TABS ? t : "Odds Screen"; } catch { return "Odds Screen"; } });
  const go = (t) => { setTab(t); try { localStorage.setItem("tab", t); } catch {} };
  const Page = TABS[tab];
  return (
    <div className="app">
      <nav><h1>Odderjam</h1>{Object.keys(TABS).map((t) => (
        <button key={t} className={t === tab ? "on" : ""} onClick={() => go(t)}>{t}</button>))}<RefreshBox /></nav>
      <main><Page /></main>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
