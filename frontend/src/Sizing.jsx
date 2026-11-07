import React, { useState } from "react";

export function useStored(key, init) {
  const [v, setV] = useState(() => { try { const x = localStorage.getItem(key); return x == null ? init : JSON.parse(x); } catch { return init; } });
  return [v, (n) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch {} }];
}

export const INCREMENTS = [0, 1, 5, 10];

/** Stake-sizing settings shared by +EV, Arbitrage and the calculators (stored in localStorage). */
export function useSizing() {
  const [total, setTotal] = useStored("sizeArbTotal", "");
  const [round, setRound] = useStored("sizeRound", 1);
  const [max, setMax] = useStored("sizeMaxSide", "");
  const maxSide = max > 0 ? +max : null;
  // A cap below one increment is impossible to honour; fall back to no cap and say so.
  const bad = maxSide != null && maxSide < (round || 0.01);
  return { total, setTotal, round, setRound, max, setMax, maxSide: bad ? null : maxSide, bad };
}

const opt = (n) => <option key={n} value={n}>{n ? `$${n}` : "cents"}</option>;

export function SizingBar({ s, showTotal = false, totalHint = "bankroll" }) {
  return (
    <span className="sizing">
      {showTotal && <>Arb total $<input className="mini" type="number" min="0" placeholder={totalHint} value={s.total}
        onChange={(e) => s.setTotal(e.target.value === "" ? "" : +e.target.value)} /></>}
      Round to <select value={s.round} onChange={(e) => s.setRound(+e.target.value)}>{INCREMENTS.map(opt)}</select>
      Max per side $<input className="mini" type="number" min="0" placeholder="none" value={s.max}
        onChange={(e) => s.setMax(e.target.value === "" ? "" : +e.target.value)} />
      {s.bad && <span className="bad">max is below the rounding step — ignored</span>}
    </span>
  );
}

/** Query string for /api/ev and /api/arbs. */
export const sizingQuery = (s, withTotal = false) =>
  `&round_to=${s.round}${s.maxSide ? `&max_side=${s.maxSide}` : ""}${withTotal && s.total > 0 ? `&total=${s.total}` : ""}`;
