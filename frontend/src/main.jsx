import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import Calculators from "./Calculators.jsx";
import OddsScreen from "./OddsScreen.jsx";
import { useStored, useApi } from "./hooks.js";

const fmt = (o) => (o > 0 ? `+${Math.round(o)}` : `${Math.round(o)}`);

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
    </div>
  );
}

const MARKETS = { moneyline: "Moneyline", spreads: "Spread", totals: "Total" };
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
  const data = useApi(`/api/ev?book=${encodeURIComponent(book)}&min_ev=${minEv}&method=${method}&kelly=${kelly}`);
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
      </div>
      <table><thead><tr><th>EV%</th><th>Pick</th><th>Market</th><th>Event</th><th>Book</th><th>Odds</th><th>Fair</th><th>Stake</th><th></th></tr></thead><tbody>
        {(data || []).map((r, i) => (
          <tr key={i}><td className="best">{r.ev_pct.toFixed(1)}%</td><td>{r.pick}</td><td>{MARKETS[r.market] || r.market}</td><td>{r.event}</td>
            <td>{r.book}</td><td>{fmt(r.odds)}</td><td>{fmt(r.fair_odds)}</td><td>${r.stake.toFixed(2)}</td>
            <td><button className="track" onClick={() => track(r)}>Track</button></td></tr>
        ))}
      </tbody></table>
    </>
  );
}

function Arbs() {
  const [min, setMin] = useStored("arbMin", 0);
  const data = useApi(`/api/arbs?min_profit=${min}`);
  return (
    <>
      <div className="bar">Min profit % <input type="number" step="0.5" value={min} onChange={(e) => setMin(+e.target.value)} /></div>
      {(data || []).map((r, i) => (
        <div className="card" key={i}>
          <b className="best">{r.profit_pct.toFixed(2)}%</b> {r.event} <span className="mut">{r.sport} · {MARKETS[r.market] || r.market}</span>
          {r.legs.map((l, j) => <div key={j}>{l.pick} {fmt(l.odds)} @ {l.book} — stake ${l.stake.toFixed(2)} of $100</div>)}
        </div>
      ))}
    </>
  );
}

function Middles() {
  const [minWindow, setMinWindow] = useStored("midWindow", 0.5);
  const [maxCost, setMaxCost] = useStored("midCost", 5);
  const [market, setMarket] = useStored("midMarket", "");
  const params = new URLSearchParams({ min_window: minWindow });
  if (maxCost !== "") params.set("max_cost", maxCost);
  if (market) params.set("market", market);
  const data = useApi(`/api/middles?${params}`);
  const track = async (r) => {
    for (const l of r.legs) {
      await fetch("/api/bets", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: r.event, sport: r.sport, market: r.market, pick: l.pick, book: l.book, odds: l.odds,
          stake: Math.round(l.stake * 100) / 100, ev_pct: r.ev_pct, notes: `middle ${r.legs.map((x) => x.pick).join(" / ")}` }) });
    }
    alert(`Tracked both legs: ${r.legs.map((l) => `${l.pick} @ ${l.book}`).join(", ")}`);
  };
  return (
    <>
      <div className="bar">
        Market <select value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">All</option><option value="spreads">Spread</option><option value="totals">Total</option></select>
        Min window <input type="number" step="0.5" min="0" value={minWindow} onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setMinWindow(v); }} />
        Max cost % <input type="number" step="0.5" min="0" placeholder="any" value={maxCost}
          onChange={(e) => {
            const v = e.target.value === "" ? "" : Number(e.target.value);
            if (v === "" || !Number.isNaN(v)) setMaxCost(v);
          }} />
      </div>
      <div className="mut small">Per $100 total stake, split so both misses cost the same. EV uses a normal model of the result (NFL margins weighted to key numbers).</div>
      <table><thead><tr><th>EV%</th><th>Event</th><th>Market</th><th>Window</th><th>Legs</th><th>Worst case</th><th>Win both</th><th>Hit %</th><th></th></tr></thead><tbody>
        {(data || []).map((r, i) => (
          <tr key={i}><td className={r.ev_pct >= 0 ? "best" : "bad"}>{r.ev_pct.toFixed(1)}%</td>
            <td>{r.event} <span className="mut">{r.sport}</span></td><td>{MARKETS[r.market] || r.market}</td><td>{r.window}</td>
            <td>{r.legs.map((l, j) => <div key={j}>{l.pick} {fmt(l.odds)} @ {l.book} — ${l.stake.toFixed(2)}</div>)}</td>
            <td className={r.worst_case >= 0 ? "best" : "bad"}>{money(r.worst_case)}</td>
            <td className="best">{money(r.win_both)}</td><td>{(r.hit_prob * 100).toFixed(1)}%</td>
            <td><button className="track" onClick={() => track(r)}>Track</button></td></tr>
        ))}
      </tbody></table>
    </>
  );
}

const TABS = { "Odds Screen": OddsScreen, "+EV": PositiveEV, Arbitrage: Arbs, Middles, Calculator: Calculators, Tracker };
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
