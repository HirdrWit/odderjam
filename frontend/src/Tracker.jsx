import React, { useState } from "react";
import { postJson, toast, useApi, useStored } from "./hooks.jsx";
import { calendarWeeks, filterQuery, plColor, scaleSeries, PROFIT } from "./tracker.js";

const money = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const signed = (n) => `${n > 0 ? "+" : ""}${money(n)}`;
const pct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`);
const STRATEGIES = { ev: "+EV", arb: "Arb", promo: "Promo", middle: "Middle", manual: "Manual" };
const MARKETS = { moneyline: "Moneyline", spreads: "Spread", totals: "Total" };
const STATUSES = ["pending", "won", "lost", "push", "void"];
const blank = { event: "", sport: "", market: "moneyline", strategy: "", pick: "", book: "", odds: "", stake: "", closing_odds: "", status: "pending" };
const noFilters = { date_from: "", date_to: "", status: "", sport: "", book: "", strategy: "" };

function ProfitChart({ daily }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 170;
  if (!daily.length) return null;
  const { points, zeroY } = scaleSeries(daily, W, H, 8);
  const last = daily[daily.length - 1];
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach(([px], i) => { if (Math.abs(px - x) < Math.abs(points[best][0] - x)) best = i; });
    setHover(best);
  };
  const h = hover != null && daily[hover];
  return (
    <div className="card chart">
      <div className="mut">Cumulative profit · {signed(last.cumulative)} over {daily.length} day{daily.length > 1 ? "s" : ""}</div>
      <div className="plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={move} onMouseLeave={() => setHover(null)}
          role="img" aria-label={`Cumulative profit from ${daily[0].date} to ${last.date}, ending at ${signed(last.cumulative)}`}>
          <line x1="0" x2={W} y1={zeroY} y2={zeroY} className="zero" />
          <polyline points={points.map((p) => p.join(",")).join(" ")} fill="none" stroke={PROFIT} strokeWidth="2"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {h && <line x1={points[hover][0]} x2={points[hover][0]} y1="0" y2={H} className="cross" />}
        </svg>
        {h && <span className="dot" style={{ left: `${(points[hover][0] / W) * 100}%`, top: `${(points[hover][1] / H) * 100}%` }} />}
        {h && <div className="tip" style={{ left: `${Math.min(80, (points[hover][0] / W) * 100)}%` }}>
          <b>{h.date}</b><div>Day {signed(h.profit)} · {h.bets} bet{h.bets > 1 ? "s" : ""}</div><div>Total {signed(h.cumulative)}</div></div>}
      </div>
      <div className="axis mut"><span>{daily[0].date}</span><span>{last.date}</span></div>
    </div>
  );
}

function Calendar({ daily }) {
  const latest = daily.length ? daily[daily.length - 1].date : new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(null);
  const [y, m] = ym || [+latest.slice(0, 4), +latest.slice(5, 7) - 1];
  const [hover, setHover] = useState(null);
  const byDay = Object.fromEntries(daily.map((d) => [d.date, d]));
  const prefix = `${y}-${String(m + 1).padStart(2, "0")}`;
  const month = daily.filter((d) => d.date.startsWith(prefix));
  const maxAbs = Math.max(0, ...month.map((d) => Math.abs(d.profit)));
  const total = month.reduce((s, d) => s + d.profit, 0);
  const shift = (k) => { const d = new Date(Date.UTC(y, m + k, 1)); setYm([d.getUTCFullYear(), d.getUTCMonth()]); };
  const h = hover && byDay[hover];
  return (
    <div className="card chart cal">
      <div className="bar">
        <button className="x" onClick={() => shift(-1)} aria-label="Previous month">◀</button>
        <b>{new Date(Date.UTC(y, m, 1)).toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</b>
        <button className="x" onClick={() => shift(1)} aria-label="Next month">▶</button>
        <span className="mut">{month.length ? `${signed(total)} · ${month.length} active day${month.length > 1 ? "s" : ""}` : "No settled bets"}</span>
      </div>
      <div className="grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="dow mut">{d}</div>)}
        {calendarWeeks(y, m).flat().map((c, i) => {
          if (!c) return <div key={i} />;
          const d = byDay[c.date];
          return (
            <div key={i} className={`day${d ? " on" : ""}`} style={d ? { background: plColor(d.profit, maxAbs) } : undefined}
              onMouseEnter={() => setHover(c.date)} onMouseLeave={() => setHover(null)}
              aria-label={d ? `${c.date}: ${signed(d.profit)}` : c.date}>
              {c.day}{d && d.profit < 0 && <i>−</i>}
            </div>
          );
        })}
      </div>
      <div className="mut readout">{h ? `${hover}: ${signed(h.profit)} on ${h.bets} bet${h.bets > 1 ? "s" : ""}` : hover ? `${hover}: no settled bets` : "Blue = profit, red = loss (−). Hover a day."}</div>
    </div>
  );
}

function GroupTable({ title, rows, label = (n) => n }) {
  if (!rows.length) return null;
  return (
    <table className="group"><thead><tr><th>{title}</th><th>Bets</th><th>Staked</th><th>Profit</th><th>ROI</th></tr></thead><tbody>
      {rows.map((g) => <tr key={g.name}><td>{label(g.name)}</td><td>{g.bets}</td><td>{money(g.staked)}</td>
        <td className={g.profit >= 0 ? "best" : "bad"}>{money(g.profit)}</td><td>{pct(g.roi_pct)}</td></tr>)}
    </tbody></table>
  );
}

export default function Tracker() {
  const [filters, setFilters] = useStored("trackerFilters", noFilters);
  const q = filterQuery(filters);
  const all = useApi("/api/bets", 600000);
  const bets = useApi(`/api/bets?${q}`, 600000);
  const stats = useApi(`/api/bets/stats?${q}`, 600000);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const reload = () => window.dispatchEvent(new Event("data-changed"));
  const body = (b) => ({ ...b, odds: +b.odds, stake: +b.stake, strategy: b.strategy || null,
    closing_odds: b.closing_odds === "" || b.closing_odds == null ? null : +b.closing_odds });
  const add = async (e) => {
    e.preventDefault();
    const r = await postJson("/api/bets", body(f));
    if (!r.ok) return toast("Could not add bet", "err");
    toast(`Added ${f.pick}`); setF(blank); reload();
  };
  const patch = async (b, change) => {
    const r = await postJson(`/api/bets/${b.id}`, body({ ...b, ...change }), "PUT");
    if (!r.ok) toast("Could not update bet", "err");
    reload();
  };
  const del = async (b) => { if (confirm(`Delete ${b.pick}?`)) { await fetch(`/api/bets/${b.id}`, { method: "DELETE" }); reload(); } };
  const settle = async () => {
    if (!confirm("Fetch final scores from The Odds API to settle pending moneyline, spread and total bets?\n"
      + "This costs 2 API credits per sport with pending bets. Props stay manual.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/bets/settle", { method: "POST" });
      const d = await r.json();
      if (!r.ok) return toast(d.detail || "Auto-settle failed", "err");
      toast(d.settled.length ? `Settled ${d.settled.length} of ${d.checked} pending bets` : `No finished games for ${d.checked} pending bets`);
      reload();
    } finally { setBusy(false); }
  };
  const importCsv = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const r = await postJson("/api/bets/import", { csv: await file.text() });
    if (!r.ok) return toast("Import failed", "err");
    const d = await r.json();
    toast(`Imported ${d.imported} bet${d.imported === 1 ? "" : "s"}${d.errors.length ? `, skipped ${d.errors.length} (first: line ${d.errors[0].line})` : ""}`,
      d.errors.length && !d.imported ? "err" : "ok");
    reload();
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setFilter = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const opts = (k) => [...new Set([...(all || []).map((b) => b[k]).filter(Boolean), filters[k]].filter(Boolean))].sort();
  const tiles = stats && [
    ["Profit", money(stats.profit), stats.profit >= 0 ? "best" : "bad"], ["ROI", pct(stats.roi_pct)],
    ["Win rate", pct(stats.win_rate_pct)], ["Staked", money(stats.staked)],
    ["Avg CLV", pct(stats.avg_clv_pct)], ["Pending", stats.pending],
  ];
  return (
    <>
      <div className="bar wrap filters">
        From <input type="date" value={filters.date_from} onChange={setFilter("date_from")} />
        To <input type="date" value={filters.date_to} onChange={setFilter("date_to")} />
        <select value={filters.status} onChange={setFilter("status")}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={filters.sport} onChange={setFilter("sport")}>
          <option value="">All sports</option>{opts("sport").map((s) => <option key={s}>{s}</option>)}</select>
        <select value={filters.book} onChange={setFilter("book")}>
          <option value="">All books</option>{opts("book").map((s) => <option key={s}>{s}</option>)}</select>
        <select value={filters.strategy} onChange={setFilter("strategy")}>
          <option value="">All strategies</option>{Object.entries(STRATEGIES).filter(([k]) => k !== "manual").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {q && <button className="x" onClick={() => setFilters(noFilters)}>Clear</button>}
        <span className="spacer" />
        <button onClick={settle} disabled={busy}>{busy ? "Settling…" : "Auto-settle"}</button>
        <a className="btn" href={`/api/bets/export.csv${q ? `?${q}` : ""}`} download>Export CSV</a>
        <label className="btn">Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={importCsv} /></label>
      </div>
      <div className="tiles">{(tiles || []).map(([k, v, c]) => <div className="card tile" key={k}><div className="mut">{k}</div><b className={c}>{v}</b></div>)}</div>
      {stats && stats.daily.length > 0 && <div className="charts"><ProfitChart daily={stats.daily} /><Calendar daily={stats.daily} /></div>}
      <form className="bar wrap" onSubmit={add}>
        <input placeholder="Pick *" required value={f.pick} onChange={set("pick")} />
        <input placeholder="Event (Away @ Home)" value={f.event} onChange={set("event")} />
        <input placeholder="Sport" value={f.sport} onChange={set("sport")} />
        <select value={f.market} onChange={set("market")}>
          {Object.entries(MARKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="prop">Prop / other</option></select>
        <select value={f.strategy} onChange={set("strategy")}>
          <option value="">Manual</option>{Object.entries(STRATEGIES).filter(([k]) => k !== "manual").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input placeholder="Book" value={f.book} onChange={set("book")} />
        <input placeholder="Odds *" required type="number" value={f.odds} onChange={set("odds")} />
        <input placeholder="Stake *" required type="number" step="0.01" value={f.stake} onChange={set("stake")} />
        <button className="primary">Add bet</button>
      </form>
      <table><thead><tr><th>Date</th><th>Pick</th><th>Event</th><th>Book</th><th>Type</th><th>Odds</th><th>Stake</th><th>Close</th><th>CLV</th><th>Status</th><th>P/L</th><th></th></tr></thead><tbody>
        {(bets || []).map((b) => (
          <tr key={`${b.id}-${b.odds}-${b.stake}-${b.closing_odds}`}><td>{new Date(b.placed_at).toLocaleDateString()}</td><td>{b.pick}</td><td>{b.event}</td><td>{b.book}</td>
            <td className="mut">{MARKETS[b.market] || b.market}{b.strategy ? ` · ${STRATEGIES[b.strategy]}` : ""}</td>
            <td><input className="mini" type="number" defaultValue={b.odds}
              onBlur={(e) => e.target.value !== "" && +e.target.value !== b.odds && patch(b, { odds: e.target.value })} /></td>
            <td><input className="mini" type="number" step="0.01" defaultValue={b.stake}
              onBlur={(e) => e.target.value !== "" && +e.target.value !== b.stake && patch(b, { stake: e.target.value })} /></td>
            <td><input className="mini" type="number" defaultValue={b.closing_odds ?? ""} placeholder="—"
              onBlur={(e) => e.target.value !== String(b.closing_odds ?? "") && patch(b, { closing_odds: e.target.value })} /></td>
            <td className={b.clv_pct > 0 ? "best" : b.clv_pct < 0 ? "bad" : ""}>{pct(b.clv_pct)}</td>
            <td><select value={b.status} onChange={(e) => patch(b, { status: e.target.value })}>
              {STATUSES.map((x) => <option key={x}>{x}</option>)}</select></td>
            <td className={b.profit > 0 ? "best" : b.profit < 0 ? "bad" : ""}>{money(b.profit)}</td>
            <td><button className="x" onClick={() => del(b)}>✕</button></td></tr>
        ))}
      </tbody></table>
      {stats && <div className="groups">
        <GroupTable title="Strategy" rows={stats.by_strategy} label={(n) => STRATEGIES[n] || n} />
        <GroupTable title="Bet type" rows={stats.by_market} label={(n) => MARKETS[n] || n} />
        <GroupTable title="Sport" rows={stats.by_sport} />
        <GroupTable title="Book" rows={stats.by_book} />
      </div>}
    </>
  );
}
