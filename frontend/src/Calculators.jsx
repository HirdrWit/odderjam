import React, { useState } from "react";
import * as c from "./calc.js";
import { SizingBar, useSizing } from "./Sizing.jsx";

const am = (o) => (Number.isFinite(o) ? (o > 0 ? `+${o.toFixed(0)}` : o.toFixed(0)) : "—");
const usd = (n) => (Number.isFinite(n) ? `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}` : "—");
const pc = (n, d = 2) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : "—");
const sign = (n) => (n > 0 ? "best" : n < 0 ? "bad" : "");
const okAm = (a) => Number.isFinite(a) && Math.abs(a) >= 100;

function Num({ label, value, set, step = 1, ...rest }) {
  return <label className="fld">{label}<input type="number" step={step} value={value} onChange={(e) => set(e.target.value === "" ? "" : +e.target.value)} {...rest} /></label>;
}

function Out({ rows }) {
  return <table className="out"><tbody>{rows.map(([k, v, cls]) => <tr key={k}><td className="mut">{k}</td><td className={cls}>{v}</td></tr>)}</tbody></table>;
}

/** Editable list of American odds (n legs / outcomes). */
function OddsList({ odds, setOdds, min = 2, max = 12, label = "Leg", extra, onRemove }) {
  const upd = (i, v) => setOdds(odds.map((o, j) => (j === i ? v : o)));
  return (
    <div className="legs">
      {odds.map((o, i) => (
        <div className="bar" key={i}>
          <Num label={`${label} ${i + 1} odds`} value={o} set={(v) => upd(i, v)} />
          {extra && extra(i)}
          {odds.length > min && <button className="x" onClick={() => { setOdds(odds.filter((_, j) => j !== i)); onRemove?.(i); }}>✕</button>}
        </div>
      ))}
      {odds.length < max && <button className="track" onClick={() => setOdds([...odds, -110])}>+ Add {label.toLowerCase()}</button>}
    </div>
  );
}

function EV() {
  const [stake, setStake] = useState(100), [odds, setOdds] = useState(110), [win, setWin] = useState(50);
  const p = win / 100, valid = okAm(odds) && p > 0 && p < 1;
  const e = valid ? c.evPct(p, odds) : NaN;
  const profit = valid ? stake * (c.americanToDecimal(odds) - 1) : NaN;
  return (
    <>
      <div className="bar"><Num label="Stake $" value={stake} set={setStake} /><Num label="Odds" value={odds} set={setOdds} /><Num label="Win %" value={win} set={setWin} step={0.5} /></div>
      <Out rows={[["Expected value", usd(stake * e / 100), sign(e)], ["EV %", pc(e), sign(e)], ["Profit if win", usd(profit)],
        ["Implied win %", pc(okAm(odds) ? c.americanToProb(odds) * 100 : NaN)], ["Fair odds", am(valid ? c.probToAmerican(p) : NaN)]]} />
    </>
  );
}

function Kelly() {
  const [bank, setBank] = useState(1000), [odds, setOdds] = useState(110), [win, setWin] = useState(52), [mult, setMult] = useState(0.25);
  const p = win / 100, valid = okAm(odds) && p > 0 && p < 1;
  const full = valid ? c.kellyFraction(p, odds, 1) : NaN, f = full * mult;
  return (
    <>
      <div className="bar"><Num label="Bankroll $" value={bank} set={setBank} /><Num label="Odds" value={odds} set={setOdds} />
        <Num label="Win %" value={win} set={setWin} step={0.5} /><Num label="Kelly multiplier" value={mult} set={setMult} step={0.05} /></div>
      <Out rows={[["Recommended stake", usd(bank * f), "best"], ["% of bankroll", pc(f * 100)], ["Full Kelly", `${pc(full * 100)} (${usd(bank * full)})`],
        ["EV %", pc(valid ? c.evPct(p, odds) : NaN), sign(valid ? c.evPct(p, odds) : 0)]]} />
      {full === 0 && <p className="mut">No edge at these odds — Kelly says don't bet.</p>}
    </>
  );
}

function NoVig() {
  const [odds, setOdds] = useState([-120, 100]), [method, setMethod] = useState("multiplicative");
  const valid = odds.every(okAm);
  const implied = valid ? odds.map(c.americanToProb) : [];
  const fair = valid ? c.DEVIG[method](implied) : [];
  return (
    <>
      <div className="bar">Method <select value={method} onChange={(e) => setMethod(e.target.value)}>{Object.keys(c.DEVIG).map((m) => <option key={m}>{m}</option>)}</select>
        <span className="mut">Add a third outcome for 3-way (e.g. soccer draw).</span></div>
      <OddsList odds={odds} setOdds={setOdds} max={3} label="Outcome" />
      {valid && <table><thead><tr><th>Outcome</th><th>Odds</th><th>Implied</th><th>Fair prob</th><th>Fair odds</th></tr></thead><tbody>
        {odds.map((o, i) => <tr key={i}><td>{i + 1}</td><td>{am(o)}</td><td>{pc(implied[i] * 100)}</td><td>{pc(fair[i] * 100)}</td><td className="best">{am(c.probToAmerican(fair[i]))}</td></tr>)}
      </tbody></table>}
      {valid && <p className="mut">Hold {pc(c.hold(odds).hold_pct)}</p>}
    </>
  );
}

const FORMATS = { american: "American", decimal: "Decimal", fractional: "Fractional", prob: "Implied %" };

function Converter() {
  const [fmt, setFmt] = useState("american"), [val, setVal] = useState("-110");
  const d = c.toDecimal(val, fmt), ok = Number.isFinite(d) && d > 1;
  const [n, den] = ok ? c.decimalToFractional(d) : [];
  const shown = { american: am(ok ? c.decimalToAmerican(d) : NaN), decimal: ok ? d.toFixed(3) : "—", fractional: ok ? `${n}/${den}` : "—", prob: pc(ok ? 100 / d : NaN) };
  return (
    <>
      <div className="bar">Enter as <select value={fmt} onChange={(e) => setFmt(e.target.value)}>{Object.entries(FORMATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input value={val} onChange={(e) => setVal(e.target.value)} /></div>
      <Out rows={Object.entries(FORMATS).map(([k, l]) => [l, shown[k], k === fmt ? "" : "best"])} />
      {!ok && <p className="bad">Enter valid odds (American ≥ 100 or ≤ -100, decimal &gt; 1, fraction like 5/2, % between 0 and 100).</p>}
    </>
  );
}

function Implied() {
  const [odds, setOdds] = useState([-150, 130]);
  const valid = odds.every(okAm);
  const h = valid ? c.hold(odds) : null;
  return (
    <>
      <OddsList odds={odds} setOdds={setOdds} min={1} label="Outcome" />
      {valid && <table><thead><tr><th>Outcome</th><th>Odds</th><th>Implied probability</th></tr></thead><tbody>
        {odds.map((o, i) => <tr key={i}><td>{i + 1}</td><td>{am(o)}</td><td className="best">{pc(c.americanToProb(o) * 100)}</td></tr>)}
      </tbody></table>}
      {h && odds.length > 1 && <p className="mut">Total {pc(h.total_implied * 100)} — overround {pc(h.overround_pct)}</p>}
    </>
  );
}

/** Rounded stakes for covering every outcome, with the profit if each one wins. */
function SizedStakes({ odds, total, sz }) {
  if (!(total > 0)) return null;
  const r = c.sizeArb(odds, total, sz.round, sz.maxSide);
  return (
    <>
      <table><thead><tr><th>Outcome</th><th>Odds</th><th>Exact stake</th><th>Rounded stake</th><th>Profit if wins</th></tr></thead><tbody>
        {odds.map((o, i) => <tr key={i}><td>{i + 1}</td><td>{am(o)}</td><td className="mut">{usd(r.ideal_stakes[i])}</td><td>{usd(r.stakes[i])}</td>
          <td className={sign(r.profits[i])}>{usd(r.profits[i])}</td></tr>)}</tbody></table>
      <p className="mut">Rounded total {usd(r.total_stake)} · profit {usd(r.min_profit)} to {usd(r.max_profit)}{r.capped ? " · scaled down to max per side" : ""}</p>
      {r.warning && <p className="bad">⚠ {r.warning}</p>}
    </>
  );
}

function Hold() {
  const [odds, setOdds] = useState([-110, -110]), [total, setTotal] = useState(200);
  const sz = useSizing();
  const valid = odds.every(okAm), h = valid ? c.hold(odds) : null;
  return (
    <>
      <div className="bar"><Num label="Total stake $ (low-hold rollover)" value={total} set={setTotal} /><SizingBar s={sz} /></div>
      <OddsList odds={odds} setOdds={setOdds} label="Outcome" />
      {h && <Out rows={[["Hold (book margin)", pc(h.hold_pct), h.hold_pct <= 0 ? "best" : ""], ["Overround (vig)", pc(h.overround_pct)],
        ["Total implied", pc(h.total_implied * 100)]]} />}
      {h && h.hold_pct < 0 && <p className="best">Negative hold — this is an arbitrage.</p>}
      {h && <SizedStakes odds={odds} total={total} sz={sz} />}
    </>
  );
}

function Parlay() {
  const [odds, setOdds] = useState([-110, -110]), [fair, setFair] = useState(["", ""]), [stake, setStake] = useState(10);
  const set = (v) => { setOdds(v); if (v.length > fair.length) setFair([...fair, ""]); };
  const valid = odds.every(okAm);
  const fp = fair.every((f) => f !== "" && f > 0 && f < 100) ? fair.map((f) => f / 100) : null;
  const r = valid ? c.parlay(odds, fp) : null;
  return (
    <>
      <Num label="Stake $" value={stake} set={setStake} />
      <OddsList odds={odds} setOdds={set} label="Leg" onRemove={(i) => setFair(fair.filter((_, j) => j !== i))} extra={(i) => <Num label="Fair win % (optional)" value={fair[i] ?? ""} step={0.5}
        set={(v) => setFair(fair.map((f, j) => (j === i ? v : f)))} />} />
      {r && <Out rows={[["Parlay odds", `${am(r.american)} (${r.decimal.toFixed(3)})`], ["Payout", usd(stake * r.decimal)], ["Profit", usd(stake * (r.decimal - 1)), "best"],
        ["Implied prob", pc(100 / r.decimal)], ...(fp ? [["Fair prob", pc(r.fair_prob * 100)], ["EV", `${pc(r.ev_pct)} (${usd(stake * r.ev_pct / 100)})`, sign(r.ev_pct)]] : [])]} />}
    </>
  );
}

function RoundRobin() {
  const [odds, setOdds] = useState([-110, -110, -110]), [stake, setStake] = useState(10), [sizes, setSizes] = useState([2]);
  const valid = odds.every(okAm);
  const avail = sizes.filter((k) => k <= odds.length);
  const r = valid && avail.length ? c.roundRobin(odds, avail, stake) : null;
  const toggle = (k) => setSizes(sizes.includes(k) ? sizes.filter((x) => x !== k) : [...sizes, k].sort((x, y) => x - y));
  return (
    <>
      <div className="bar"><Num label="Stake per parlay $" value={stake} set={setStake} />
        By {Array.from({ length: odds.length - 1 }, (_, i) => i + 2).map((k) => (
          <label key={k} className="chk"><input type="checkbox" checked={sizes.includes(k)} onChange={() => toggle(k)} />{k}s</label>))}</div>
      <OddsList odds={odds} setOdds={setOdds} min={3} max={8} label="Leg" />
      {r && <Out rows={[["Parlays", r.count], ["Total stake", usd(r.total_stake)], ["Max payout (all win)", usd(r.max_payout)], ["Max profit", usd(r.max_profit), "best"]]} />}
      {r && <table><thead><tr><th>Legs</th><th>Odds</th><th>Payout</th></tr></thead><tbody>
        {r.parlays.map((p) => <tr key={p.legs.join()}><td>{p.legs.map((i) => i + 1).join(" + ")}</td><td>{am(c.decimalToAmerican(p.decimal))}</td><td>{usd(stake * p.decimal)}</td></tr>)}
      </tbody></table>}
    </>
  );
}

function Bonus() {
  const [bonus, setBonus] = useState(100), [a, setA] = useState(250), [b, setB] = useState(-300);
  const sz = useSizing();
  const ok = okAm(a) && okAm(b) && bonus > 0;
  const r = ok ? c.bonusBetHedge(bonus, a, b) : null;
  const s = ok ? c.sizeBonusHedge(bonus, a, b, sz.round, sz.maxSide) : null;
  return (
    <>
      <div className="bar"><Num label="Bonus bet $" value={bonus} set={setBonus} /><Num label="Bonus side odds" value={a} set={setA} /><Num label="Hedge side odds (cash)" value={b} set={setB} /></div>
      <div className="bar"><SizingBar s={sz} /></div>
      {r && <Out rows={[["Exact hedge stake", `${usd(r.hedge_stake)} (profit ${usd(r.profit)}, ${pc(r.conversion_pct, 1)})`],
        ["Rounded hedge stake", `${usd(s.hedge_stake)}${s.capped ? " (capped at max per side)" : ""}`, "best"],
        ["Profit if bonus side wins", usd(s.profit_if_bonus_wins), sign(s.profit_if_bonus_wins)],
        ["Profit if hedge side wins", usd(s.profit_if_hedge_wins), sign(s.profit_if_hedge_wins)],
        ["Conversion (worst case)", pc(s.conversion_pct, 1), sign(s.conversion_pct)]]} />}
      <p className="mut">Bonus bet stake is not returned on a win. Longer odds on the bonus side usually convert better.</p>
    </>
  );
}

function Arb() {
  const [odds, setOdds] = useState([110, -105]), [total, setTotal] = useState(100);
  const sz = useSizing();
  const valid = odds.every(okAm), r = valid ? c.arb(odds, total) : null;
  return (
    <>
      <div className="bar"><Num label="Total stake $" value={total} set={setTotal} /><SizingBar s={sz} /></div>
      <OddsList odds={odds} setOdds={setOdds} max={3} label="Outcome" />
      {r && <>
        <Out rows={[["Profit (exact stakes)", `${pc(r.profit_pct)} (${usd(r.payout - total)})`, sign(r.profit_pct)], ["Payout (any outcome)", usd(r.payout)]]} />
        <SizedStakes odds={odds} total={total} sz={sz} />
      </>}
    </>
  );
}

function Hedge() {
  const [stake, setStake] = useState(100), [a, setA] = useState(300), [b, setB] = useState(-150);
  const r = okAm(a) && okAm(b) ? c.hedge(stake, a, b) : null;
  return (
    <>
      <div className="bar"><Num label="Original stake $" value={stake} set={setStake} /><Num label="Original odds" value={a} set={setA} /><Num label="Hedge odds" value={b} set={setB} /></div>
      {r && <Out rows={[["Hedge stake", usd(r.hedge_stake)], ["Locked profit (either outcome)", usd(r.profit), sign(r.profit)],
        ["Unhedged: win / lose", `${usd(r.unhedged_win)} / ${usd(r.unhedged_loss)}`]]} />}
    </>
  );
}

function Prediction() {
  const [cents, setCents] = useState(40), [fee, setFee] = useState(0);
  const r = c.predictionMarket(+cents, +fee || 0);
  return (
    <>
      <div className="bar"><Num label="Price (¢)" value={cents} set={setCents} /><Num label="Fee per contract (¢)" value={fee} set={setFee} step={0.1} /></div>
      {r ? <Out rows={[["Implied probability", pc(r.prob * 100)], ["American (after fee)", am(r.american), "best"], ["Decimal (after fee)", r.decimal.toFixed(3)],
        ["Break-even win %", pc(r.breakeven * 100)]]} /> : <p className="bad">Price plus fee must be between 0¢ and 100¢.</p>}
      <p className="mut">Kalshi / Polymarket contracts pay 100¢ if they resolve Yes.</p>
    </>
  );
}

function Poisson() {
  const [mean, setMean] = useState(2.3), [line, setLine] = useState(1.5);
  const ok = mean > 0 && line >= 0;
  const r = ok ? c.poissonOverUnder(mean, line) : null;
  const top = ok ? Math.max(Math.ceil(mean * 2.5), Math.ceil(line) + 2) : 0;
  return (
    <>
      <div className="bar"><Num label="Mean (λ)" value={mean} set={setMean} step={0.1} /><Num label="Line" value={line} set={setLine} step={0.5} /></div>
      {r && <Out rows={[["Over", `${pc(r.over * 100)} (${am(c.probToAmerican(r.over))})`], ["Under", `${pc(r.under * 100)} (${am(c.probToAmerican(r.under))})`],
        ...(r.push > 0 ? [["Push", pc(r.push * 100)]] : [])]} />}
      {r && <table><thead><tr><th>Exactly</th><th>Probability</th></tr></thead><tbody>
        {Array.from({ length: top + 1 }, (_, k) => <tr key={k}><td>{k}</td><td>{pc(c.poissonPmf(mean, k) * 100)}</td></tr>)}</tbody></table>}
    </>
  );
}

function HalfPoint() {
  const [sport, setSport] = useState("NFL"), [num, setNum] = useState(3);
  const [whole, setWhole] = useState(-110), [half, setHalf] = useState(-130), [winNp, setWinNp] = useState(50);
  const [push, setPush] = useState(c.PUSH_RATES.NFL[3]);
  const pick = (s, n) => {
    const rates = c.PUSH_RATES[s], k = n in rates ? n : +Object.keys(rates)[0];
    setSport(s); setNum(k); setPush(rates[k]);
  };
  const r = okAm(whole) && okAm(half) ? c.halfPoint(whole, half, +push, winNp / 100) : null;
  return (
    <>
      <div className="bar">Sport <select value={sport} onChange={(e) => pick(e.target.value, num)}>{Object.keys(c.PUSH_RATES).map((s) => <option key={s}>{s}</option>)}</select>
        Key number <select value={num} onChange={(e) => pick(sport, +e.target.value)}>{Object.keys(c.PUSH_RATES[sport]).map((n) => <option key={n}>{n}</option>)}</select>
        <Num label="Push rate %" value={push} set={setPush} step={0.1} /></div>
      <div className="bar"><Num label="Odds at whole number" value={whole} set={setWhole} /><Num label="Odds after buying ½" value={half} set={setHalf} />
        <Num label="Win % if no push" value={winNp} set={setWinNp} step={0.5} /></div>
      {r && <Out rows={[["EV at whole number", pc(r.ev_whole_pct), sign(r.ev_whole_pct)], ["EV after buying ½ point", pc(r.ev_half_pct), sign(r.ev_half_pct)],
        ["Verdict", r.worth_it ? "Buy the half point" : "Don't buy", r.worth_it ? "best" : "bad"]]} />}
      <p className="mut">Push rates are rough historical estimates — edit them to match your own data.</p>
    </>
  );
}

function SpreadML() {
  const [sport, setSport] = useState("NFL"), [spread, setSpread] = useState(-3), [sd, setSd] = useState(c.MARGIN_SD.NFL);
  const r = sd > 0 ? c.spreadToMoneyline(+spread, sd) : null;
  return (
    <>
      <div className="bar">Sport <select value={sport} onChange={(e) => { setSport(e.target.value); setSd(c.MARGIN_SD[e.target.value]); }}>
        {Object.keys(c.MARGIN_SD).map((s) => <option key={s}>{s}</option>)}</select>
        <Num label="Favourite spread" value={spread} set={setSpread} step={0.5} /><Num label="Margin std dev" value={sd} set={setSd} step={0.5} /></div>
      {r && <Out rows={[["Favourite fair ML", `${am(r.fav_american)} (${pc(r.fav_prob * 100)})`, "best"], ["Underdog fair ML", `${am(r.dog_american)} (${pc(r.dog_prob * 100)})`]]} />}
      <p className="mut">Assumes the final margin is normally distributed around the spread; fair (no-vig) prices. Ignores key numbers.</p>
    </>
  );
}

const CALCS = {
  "Expected value": EV, Kelly, "No-vig fair odds": NoVig, "Odds converter": Converter, "Implied probability": Implied,
  "Vig / hold": Hold, Parlay, "Round robin": RoundRobin, "Bonus bet": Bonus, Arbitrage: Arb, Hedge,
  "Prediction market": Prediction, Poisson, "Half point": HalfPoint, "Spread → moneyline": SpreadML,
};

export default function Calculators() {
  const [name, setName] = useState(() => { try { const n = localStorage.getItem("calc"); return n in CALCS ? n : "Expected value"; } catch { return "Expected value"; } });
  const go = (n) => { setName(n); try { localStorage.setItem("calc", n); } catch {} };
  const Page = CALCS[name];
  return (
    <>
      <div className="subnav">{Object.keys(CALCS).map((n) => <button key={n} className={n === name ? "on" : ""} onClick={() => go(n)}>{n}</button>)}</div>
      <div className="card calc"><h2>{name}</h2><Page /></div>
    </>
  );
}
