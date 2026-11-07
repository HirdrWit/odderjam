import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import Calculators from "./Calculators.jsx";
import Tracker from "./Tracker.jsx";
import { Toaster, postJson, toast, useApi, useStored } from "./hooks.jsx";

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
          {Object.entries(MARKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {(data || []).filter((e) => e.markets[market]).map((e) => {
        const outs = e.markets[market];
        const books = [...new Set(outs.flatMap((o) => Object.keys(o.prices)))];
        const best = (o) => Math.max(...Object.values(o.prices));
        const bestBy = (name) => outs.filter((o) => o.name === name).reduce((a, o) => (!a || best(o) > best(a) ? o : a), null);
        const names = [...new Set(outs.map((o) => o.name))];
        return (
          <div className="card" key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
            <b>{e.away} @ {e.home}</b> <span className="mut">{e.sport} · {new Date(e.start).toLocaleString()}</span>
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
    const res = await postJson("/api/bets", { event: r.event, event_id: r.event_id, sport: r.sport, market: r.market,
      pick: r.pick, selection: r.selection, point: r.point, book: r.book, odds: r.odds,
      stake: +r.stake.toFixed(2) || 1, ev_pct: r.ev_pct, strategy: "ev" });
    res.ok ? toast(`Tracked ${r.pick} @ ${r.book}`) : toast("Could not track bet", "err");
    window.dispatchEvent(new Event("data-changed"));
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
  const track = async (r) => {
    const res = await Promise.all(r.legs.map((l) => postJson("/api/bets", { event: r.event, event_id: r.event_id,
      sport: r.sport, market: r.market, pick: l.pick, selection: l.selection, point: l.point, book: l.book,
      odds: l.odds, stake: +l.stake.toFixed(2), strategy: "arb" })));
    res.every((x) => x.ok) ? toast(`Tracked ${r.legs.length} legs of ${r.event} ($100 total)`) : toast("Could not track every leg", "err");
    window.dispatchEvent(new Event("data-changed"));
  };
  return (
    <>
      <div className="bar">Min profit % <input type="number" step="0.5" value={min} onChange={(e) => setMin(+e.target.value)} /></div>
      {(data || []).map((r, i) => (
        <div className="card" key={i}>
          <b className="best">{r.profit_pct.toFixed(2)}%</b> {r.event} <span className="mut">{r.sport} · {MARKETS[r.market] || r.market}</span>
          <button className="track right" onClick={() => track(r)}>Track legs</button>
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
      <Toaster />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
