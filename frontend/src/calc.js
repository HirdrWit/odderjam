// Pure betting formulas for the Calculator tab. The ones that exist in
// backend/engine mirror those implementations exactly; keep them in sync.

// ---- odds formats (backend/engine/odds.py) ----
export const americanToDecimal = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
export const decimalToAmerican = (d) => (d >= 2 ? (d - 1) * 100 : -100 / (d - 1));
export const americanToProb = (a) => 1 / americanToDecimal(a);
export const probToAmerican = (p) => decimalToAmerican(1 / p);
export const probToDecimal = (p) => 1 / p;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Decimal odds -> [numerator, denominator], best fraction with denominator <= maxDen. */
export function decimalToFractional(d, maxDen = 100) {
  const x = d - 1;
  let best = [Math.round(x), 1], err = Math.abs(x - best[0]);
  for (let den = 2; den <= maxDen && err > 1e-9; den++) {
    const num = Math.round(x * den), e = Math.abs(x - num / den);
    if (e < err - 1e-12) { best = [num, den]; err = e; }
  }
  const g = gcd(best[0], best[1]) || 1;
  return [best[0] / g, best[1] / g];
}

export const fractionalToDecimal = (num, den) => 1 + num / den;

/** Parse "5/2", "5-2" or "2.5" (as fractional profit) into decimal odds. */
export function parseFractional(s) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/);
  if (m) return +m[2] > 0 ? fractionalToDecimal(+m[1], +m[2]) : NaN;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? 1 + n : NaN;
}

/** Any supported format -> decimal odds (NaN if invalid). */
export function toDecimal(value, format) {
  const v = +value;
  switch (format) {
    case "american": return Number.isFinite(v) && Math.abs(v) >= 100 ? americanToDecimal(v) : NaN;
    case "decimal": return v > 1 ? v : NaN;
    case "fractional": return parseFractional(value);
    case "prob": return v > 0 && v < 100 ? 100 / v : NaN;
    default: return NaN;
  }
}

// ---- EV / Kelly (backend/engine/ev.py) ----
export const evPct = (fairProb, american) => (fairProb * americanToDecimal(american) - 1) * 100;

export function kellyFraction(fairProb, american, multiplier = 0.25) {
  const b = americanToDecimal(american) - 1;
  const f = (b * fairProb - (1 - fairProb)) / b;
  return Math.max(0, f) * multiplier;
}

// ---- devig (backend/engine/devig.py) ----
export const multiplicative = (probs) => {
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
};

export function power(probs) {
  let lo = 0.5, hi = 5.0, k = 1;
  for (let i = 0; i < 60; i++) {
    k = (lo + hi) / 2;
    if (probs.reduce((s, p) => s + p ** k, 0) > 1) lo = k; else hi = k;
  }
  return probs.map((p) => p ** k);
}

export const worstCase = (probs) => {
  const m = multiplicative(probs), p = power(probs);
  return m.map((a, i) => Math.max(a, p[i]));
};

/** Additive: subtract an equal share of the overround from every outcome. */
export const additive = (probs) => {
  const over = probs.reduce((a, b) => a + b, 0) - 1;
  return probs.map((p) => p - over / probs.length);
};

export const DEVIG = { multiplicative, power, additive, worst_case: worstCase };

// ---- hold (backend/engine/lowhold.py, generalised to n outcomes) ----
export function hold(american) {
  const total = american.reduce((s, a) => s + americanToProb(a), 0);
  return { overround_pct: (total - 1) * 100, hold_pct: (1 - 1 / total) * 100, total_implied: total };
}

// ---- arbitrage (backend/engine/arb.py) ----
export function arb(american, bankroll = 100) {
  const dec = american.map(americanToDecimal);
  const inv = dec.reduce((s, d) => s + 1 / d, 0);
  return { profit_pct: (1 / inv - 1) * 100, stakes: dec.map((d) => bankroll / d / inv), payout: bankroll / inv };
}

// ---- parlay (backend/engine/parlay.py) ----
export function parlay(american, fairProbs = null) {
  const dec = american.reduce((p, a) => p * americanToDecimal(a), 1);
  const out = { decimal: dec, american: decimalToAmerican(dec) };
  if (fairProbs && fairProbs.length) {
    const p = fairProbs.reduce((a, b) => a * b, 1);
    out.fair_prob = p;
    out.ev_pct = (p * dec - 1) * 100;
  }
  return out;
}

// ---- round robin ----
export function combinations(n, k) {
  const out = [], cur = [];
  const rec = (start) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < n; i++) { cur.push(i); rec(i + 1); cur.pop(); }
  };
  if (k >= 1 && k <= n) rec(0);
  return out;
}

/** Every parlay of each size in `sizes`, `stake` on each. Payouts include stake returned. */
export function roundRobin(american, sizes, stake) {
  const dec = american.map(americanToDecimal);
  const parlays = sizes.flatMap((k) => combinations(dec.length, k).map((c) => ({
    legs: c, decimal: c.reduce((p, i) => p * dec[i], 1),
  })));
  const total = parlays.length * stake;
  const maxPayout = parlays.reduce((s, p) => s + stake * p.decimal, 0);
  return { count: parlays.length, total_stake: total, max_payout: maxPayout, max_profit: maxPayout - total, parlays };
}

// ---- bonus bets (backend/engine/promo.py) ----
export function bonusBetHedge(bonus, oddsBonus, oddsHedge) {
  const da = americanToDecimal(oddsBonus), db = americanToDecimal(oddsHedge);
  const winA = bonus * (da - 1);
  const hedge = winA / db;
  const profit = winA - hedge;
  return { hedge_stake: hedge, profit, conversion_pct: (profit / bonus) * 100 };
}

// ---- hedge ----
/** Cash bet `stake` @ `oddsOrig`; hedge @ `oddsHedge` so both outcomes return the same. */
export function hedge(stake, oddsOrig, oddsHedge) {
  const da = americanToDecimal(oddsOrig), dh = americanToDecimal(oddsHedge);
  const hedgeStake = (stake * da) / dh;
  const profit = stake * da - stake - hedgeStake;
  return { hedge_stake: hedgeStake, profit, unhedged_win: stake * (da - 1), unhedged_loss: -stake };
}

// ---- prediction markets ----
/** Contract price in cents (pays 100c) plus optional per-contract fee in cents. */
export function predictionMarket(cents, feeCents = 0) {
  const cost = cents + feeCents;
  if (!(cost > 0 && cost < 100)) return null;
  const dec = 100 / cost;
  return { prob: cents / 100, decimal: dec, american: decimalToAmerican(dec), breakeven: cost / 100 };
}

// ---- Poisson ----
export function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/** P(over / under / exactly) a prop line given a Poisson mean. Integer lines can push. */
export function poissonOverUnder(lambda, line) {
  let under = 0;
  for (let k = 0; k < Math.ceil(line); k++) under += poissonPmf(lambda, k);
  const push = Number.isInteger(line) ? poissonPmf(lambda, line) : 0;
  return { over: 1 - under - push, under, push };
}

// ---- half points / key numbers ----
// Rough share of games landing exactly on each margin from one team's side
// (i.e. the push rate for a spread at that number). Editable in the UI.
export const PUSH_RATES = {
  NFL: { 1: 2.5, 2: 2.5, 3: 8.5, 4: 3.0, 5: 2.0, 6: 3.0, 7: 5.0, 8: 2.0, 10: 3.0, 14: 2.5 },
  NBA: { 1: 1.5, 2: 1.8, 3: 2.0, 4: 2.0, 5: 2.3, 6: 2.3, 7: 2.4, 8: 2.2, 9: 2.0, 10: 1.9 },
};

/**
 * Compare a bet at a whole-number spread (can push) with the same bet after
 * buying a half point (push becomes a win).
 * winNoPush: win probability among games that do not land on the number.
 */
export function halfPoint(oddsWhole, oddsHalf, pushPct, winNoPush = 0.5) {
  const push = pushPct / 100;
  const w = (1 - push) * winNoPush, l = 1 - push - w;
  const d1 = americanToDecimal(oddsWhole), d2 = americanToDecimal(oddsHalf);
  const evWhole = w * (d1 - 1) - l;
  const evHalf = (w + push) * (d2 - 1) - l;
  return { ev_whole_pct: evWhole * 100, ev_half_pct: evHalf * 100, worth_it: evHalf > evWhole };
}

// ---- spread -> moneyline ----
const erf = (x) => {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

export const MARGIN_SD = { NFL: 13.5, NBA: 12, NCAAF: 15.5, NCAAB: 10.5 };

/** Favourite laying `spread` points: win prob = P(margin > 0) with margin ~ N(spread, sd). */
export function spreadToMoneyline(spread, sd) {
  const fav = normCdf(Math.abs(spread) / sd);
  return { fav_prob: fav, dog_prob: 1 - fav, fav_american: probToAmerican(fav), dog_american: probToAmerican(1 - fav) };
}
