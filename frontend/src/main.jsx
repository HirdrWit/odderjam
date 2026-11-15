import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import Calculators from "./Calculators.jsx";
import OddsScreen from "./OddsScreen.jsx";
import Tracker from "./Tracker.jsx";
import { Toaster, postJson, toast, useApi, useStored } from "./hooks.jsx";
import { useSlip, legKey } from "./hooks.js";

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

// "Bet" button: opens the sportsbook (deep link to the bet when the feed has one) in a new tab.
const BetLink = ({ href }) => (href ? <a className="bet" href={href} target="_blank" rel="noopener noreferrer">Bet</a> : null);

const MARKETS = { moneyline: "Moneyline", spreads: "Spread", totals: "Total" };
const money = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const pct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`);

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
  const { has, toggle } = useSlip();
  const cfg = useApi("/api/sharps", 600000);
  const [weights, setWeights] = useStored("evSharpWeights", null);
  const [maxHold, setMaxHold] = useStored("evMaxHold", null);
  const w = weights ?? cfg?.weights;
  const hold = maxHold ?? cfg?.max_hold;
  const setWeight = (b, v) => setWeights({ ...w, [b]: v });
  const sharpSpec = w ? Object.entries(w).filter(([, v]) => v > 0).map(([b, v]) => `${b}:${v}`).join(",") : null;
  const data = useApi(cfg && `/api/ev?book=${encodeURIComponent(book)}&min_ev=${minEv}&method=${method}&kelly=${kelly}`
    + `&sharps=${encodeURIComponent(sharpSpec)}&max_hold=${hold}`);
  return (
    <>
      <div className="bar">
        Book <select value={book} onChange={(e) => pickBook(e.target.value)}>
          {["DraftKings", "FanDuel", "BetMGM", "Caesars", "bet365", "BetRivers", "Fanatics", "ESPN BET", "Hard Rock Bet", ""].map((b) => <option key={b} value={b}>{b || "All books"}</option>)}</select>
        Min EV % <input type="number" step="0.5" value={minEv} onChange={(e) => setMinEv(+e.target.value)} />
        Devig <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {(cfg?.methods || [method]).map((m) => <option key={m}>{m}</option>)}</select>
        {bank && <span>Bankroll <b className={bank.profit >= 0 ? "best" : "bad"}>${bank.current.toFixed(2)}</b>
          <span className="mut">start $<input className="mini" type="number" defaultValue={bank.starting}
            onBlur={(e) => +e.target.value !== bank.starting && setStart(+e.target.value)} /> {bank.profit >= 0 ? "+" : "-"}${Math.abs(bank.profit).toFixed(2)} P/L</span></span>}
        Kelly <input type="number" step="0.05" value={kelly} onChange={(e) => setKelly(+e.target.value)} />
      </div>
      {cfg && w && (
        <div className="bar wrap">
          Sharp weights {cfg.books.map((b) => (
            <span key={b}>{b} <input className="mini" type="number" step="0.25" min="0" value={w[b] ?? 0}
              onChange={(e) => setWeight(b, +e.target.value)} /></span>))}
          Max sharp hold % <input className="mini" type="number" step="0.5" value={hold} onChange={(e) => setMaxHold(+e.target.value)} />
          {(weights || maxHold != null) && <button onClick={() => { setWeights(null); setMaxHold(null); }}>Reset</button>}
        </div>
      )}
      <table><thead><tr><th>EV%</th><th>Pick</th><th>Market</th><th>Event</th><th>Book</th><th>Odds</th><th>Fair</th><th>Sharps (hold)</th><th>Stake</th><th></th></tr></thead><tbody>
        {(data || []).map((r, i) => (
          <tr key={i}><td className="best">{r.ev_pct.toFixed(1)}%</td><td>{r.pick}</td><td>{MARKETS[r.market] || r.market}</td><td>{r.event}</td>
            <td>{r.book}</td><td>{fmt(r.odds)}</td><td>{fmt(r.fair_odds)}</td>
            <td className="mut small">{r.sharps.map((s) => `${s.book} ${s.hold_pct.toFixed(1)}%`).join(" · ")}</td>
            <td>${r.stake.toFixed(2)}</td>
            <td><BetLink href={r.link} /> <button className="track" onClick={() => track(r)}>Track</button>{" "}
              <button className={has(r) ? "track on" : "track"} title="Add to parlay slip" onClick={() => toggle(r)}>{has(r) ? "✓ Slip" : "+ Slip"}</button></td></tr>
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
          {r.legs.map((l, j) => <div key={j}>{l.pick} {fmt(l.odds)} @ {l.book} — stake ${l.stake.toFixed(2)} of $100 <BetLink href={l.link} /></div>)}
        </div>
      ))}
    </>
  );
}

function Parlay() {
  const { slip, toggle, clear } = useSlip();
  const [method] = useStored("evMethod", "multiplicative");
  const [kelly, setKelly] = useStored("evKelly", 0.25);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const legs = slip.map(({ event_id, market, name, point }) => ({ event_id, market, name, point }));
  const body = JSON.stringify({ legs, method, kelly });
  useEffect(() => {
    if (legs.length < 2) { setRes(null); setErr(null); return; }
    let live = true;
    const load = () => fetch("/api/parlay", { method: "POST", headers: { "Content-Type": "application/json" }, body })
      .then(async (r) => { const d = await r.json(); if (!live) return; if (r.ok) { setRes(d); setErr(null); } else { setRes(null); setErr(d.detail); } });
    load();
    window.addEventListener("data-changed", load);
    return () => { live = false; window.removeEventListener("data-changed", load); };
  }, [body]);
  const track = async (b) => {
    const picks = res.legs.map((l) => l.pick);
    await fetch("/api/bets", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: [...new Set(res.legs.map((l) => l.event))].join(" / "),
        sport: [...new Set(res.legs.map((l) => l.sport))].join("/"), market: "parlay",
        pick: `${picks.length}-leg parlay: ${picks.join(" + ")}`, book: b.book, odds: Math.round(b.odds),
        stake: +(b.stake ?? 0).toFixed(2) || 1, ev_pct: b.ev_pct,
        notes: res.legs.map((l, i) => `${l.pick} (${l.event}) ${fmt(b.leg_odds[i])}`).join("; ") }) });
    alert(`Tracked parlay @ ${b.book}`);
  };
  return (
    <>
      <div className="bar">
        Kelly <input type="number" step="0.05" value={kelly} onChange={(e) => setKelly(+e.target.value)} />
        <span className="mut">Devig: {method} (set on +EV tab)</span>
        {slip.length > 0 && <button className="x" onClick={clear}>Clear slip</button>}
      </div>
      {slip.length === 0 && <div className="mut">Add legs with "+ Slip" on the +EV tab, or click a price on the Odds Screen.</div>}
      {slip.map((l, i) => {
        const f = res?.legs[i]?.fair_prob;
        return <div className="card calc" key={legKey(l)}>
          <button className="x" onClick={() => toggle(l)}>✕</button> <b>{l.pick}</b> <span className="mut">{MARKETS[l.market] || l.market} · {l.event}</span>
          {f != null && <span className="mut">fair {(f * 100).toFixed(1)}%</span>}
          {res && f == null && <span className="mut">no sharp price for this line — EV unknown</span>}
        </div>;
      })}
      {slip.length === 1 && <div className="mut">Add at least one more leg.</div>}
      {err && <div className="bad">{typeof err === "string" ? err : "Could not price this parlay"}</div>}
      {res && <>
        <div className="bar">
          Fair <b>{res.fair_odds == null ? "—" : fmt(res.fair_odds)}</b>
          {res.fair_prob != null && <span className="mut">{(res.fair_prob * 100).toFixed(2)}% · legs treated as independent</span>}
        </div>
        {res.same_game && <div className="bad">Same-game legs: correlation is not modelled, and books without same-game parlays are blocked.</div>}
        {res.books.length === 0 && <div className="mut">No book offers every leg at these lines.</div>}
        <table><thead><tr><th>Book</th><th>Odds</th><th>EV%</th><th>Stake</th><th>Legs</th><th></th></tr></thead><tbody>
          {res.books.map((b) => (
            <tr key={b.book} className={b.blocked ? "blocked" : ""}><td>{b.book}</td><td>{fmt(b.odds)}</td>
              <td className={b.ev_pct > 0 ? "best" : b.ev_pct < 0 ? "bad" : ""}>{pct(b.ev_pct)}</td>
              <td>{b.stake == null ? "—" : money(b.stake)}</td><td className="mut">{b.leg_odds.map(fmt).join(" × ")}</td>
              <td>{b.blocked ? <span className="mut">No SGP</span> : <button className="track" onClick={() => track(b)}>Track</button>}</td></tr>
          ))}
        </tbody></table>
      </>}
    </>
  );
}

/** Parses a number input's text, returning `fallback` when it is not a valid number. */
function parseNumberInput(value, fallback) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function LowHold() {
  const [maxHold, setMaxHold] = useStored("lhMax", 1);
  const [book, setBook] = useStored("lhBook", "");
  const [stake, setStake] = useStored("lhStake", 100);
  const [market, setMarket] = useStored("lhMarket", "");
  const data = useApi(`/api/lowhold?max_hold=${maxHold}&book=${encodeURIComponent(book)}&stake=${stake}${market ? `&market=${market}` : ""}`);
  return (
    <>
      <div className="bar">
        Max hold % <input type="number" step="0.25" value={maxHold} onChange={(e) => setMaxHold(parseNumberInput(e.target.value, maxHold))} />
        One leg at <select value={book} onChange={(e) => setBook(e.target.value)}>
          {["", "DraftKings", "FanDuel", "BetMGM", "Caesars", "bet365", "BetRivers", "Fanatics", "ESPN BET", "Hard Rock Bet"].map((b) => <option key={b} value={b}>{b || "Any book"}</option>)}</select>
        Market <select value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">All markets</option>{Object.entries(MARKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        Total stake $<input type="number" step="10" value={stake} onChange={(e) => setStake(parseNumberInput(e.target.value, stake))} />
      </div>
      <table><thead><tr><th>Hold</th><th>Event</th><th>Market</th><th>Legs</th><th>Exp. loss</th></tr></thead><tbody>
        {(data || []).map((r, i) => (
          <tr key={i}><td className={r.hold_pct <= 0 ? "best" : ""}>{r.hold_pct.toFixed(2)}%</td><td>{r.event} <span className="mut">{r.sport}</span></td>
            <td>{MARKETS[r.market] || r.market}</td>
            <td>{r.legs.map((l, j) => <div key={j}>{l.pick} {fmt(l.odds)} @ {l.book} — ${l.stake.toFixed(2)}</div>)}</td>
            <td className={r.expected_loss <= 0 ? "best" : "bad"}>{money(r.expected_loss)}</td></tr>
        ))}
      </tbody></table>
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

const TABS = { "Odds Screen": OddsScreen, "+EV": PositiveEV, Parlay, Arbitrage: Arbs, "Low Hold": LowHold, Middles, Calculator: Calculators, Tracker };
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
