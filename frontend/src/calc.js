/**
 * @fileoverview Pure betting formulas for the Calculator tab. The ones that
 * exist in backend/engine mirror those implementations exactly; keep them in
 * sync.
 */

// ---- odds formats (backend/engine/odds.py) ----

/**
 * Converts American odds to decimal odds.
 * @param {number} american
 * @return {number}
 */
export function americanToDecimal(american) {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

/**
 * Converts decimal odds to American odds.
 * @param {number} decimal
 * @return {number}
 */
export function decimalToAmerican(decimal) {
  return decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
}

/**
 * Returns the implied probability (0-1) of American odds.
 * @param {number} american
 * @return {number}
 */
export function americanToProb(american) {
  return 1 / americanToDecimal(american);
}

/**
 * Returns the fair American odds for a probability (0-1).
 * @param {number} prob
 * @return {number}
 */
export function probToAmerican(prob) {
  return decimalToAmerican(1 / prob);
}

/**
 * Returns the fair decimal odds for a probability (0-1).
 * @param {number} prob
 * @return {number}
 */
export function probToDecimal(prob) {
  return 1 / prob;
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/**
 * Converts decimal odds to the best fraction with a denominator of at most
 * `maxDen`.
 * @param {number} decimal
 * @param {number=} maxDen
 * @return {!Array<number>} The fraction as `[numerator, denominator]`.
 */
export function decimalToFractional(decimal, maxDen = 100) {
  const x = decimal - 1;
  let best = [Math.round(x), 1];
  let err = Math.abs(x - best[0]);
  for (let den = 2; den <= maxDen && err > 1e-9; den++) {
    const num = Math.round(x * den);
    const candidateErr = Math.abs(x - num / den);
    if (candidateErr < err - 1e-12) {
      best = [num, den];
      err = candidateErr;
    }
  }
  const divisor = gcd(best[0], best[1]) || 1;
  return [best[0] / divisor, best[1] / divisor];
}

/**
 * Converts fractional odds `num/den` to decimal odds.
 * @param {number} num
 * @param {number} den
 * @return {number}
 */
export function fractionalToDecimal(num, den) {
  return 1 + num / den;
}

/**
 * Parses "5/2", "5-2" or "2.5" (as fractional profit) into decimal odds.
 * @param {string|number} text
 * @return {number} Decimal odds, or NaN if the input is invalid.
 */
export function parseFractional(text) {
  const trimmed = String(text).trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/);
  if (match) {
    const num = Number(match[1]);
    const den = Number(match[2]);
    return den > 0 ? fractionalToDecimal(num, den) : NaN;
  }
  // Number('') is 0, so reject blank input explicitly.
  const profit = trimmed === '' ? NaN : Number(trimmed);
  return Number.isFinite(profit) && profit > 0 ? 1 + profit : NaN;
}

/**
 * Converts odds in any supported format to decimal odds.
 * @param {string|number} value
 * @param {string} format One of 'american', 'decimal', 'fractional', 'prob'.
 * @return {number} Decimal odds, or NaN if the input is invalid.
 */
export function toDecimal(value, format) {
  const num = Number(value);
  switch (format) {
    case 'american':
      return Number.isFinite(num) && Math.abs(num) >= 100 ?
          americanToDecimal(num) :
          NaN;
    case 'decimal':
      return num > 1 ? num : NaN;
    case 'fractional':
      return parseFractional(value);
    case 'prob':
      return num > 0 && num < 100 ? 100 / num : NaN;
    default:
      return NaN;
  }
}

// ---- EV / Kelly (backend/engine/ev.py) ----

/**
 * Returns the expected value, in percent of stake, of a bet at `american`
 * odds that wins with probability `fairProb`.
 * @param {number} fairProb
 * @param {number} american
 * @return {number}
 */
export function evPct(fairProb, american) {
  return (fairProb * americanToDecimal(american) - 1) * 100;
}

/**
 * Returns the Kelly stake as a fraction of bankroll, scaled by `multiplier`.
 * @param {number} fairProb
 * @param {number} american
 * @param {number=} multiplier
 * @return {number}
 */
export function kellyFraction(fairProb, american, multiplier = 0.25) {
  const b = americanToDecimal(american) - 1;
  const fraction = (b * fairProb - (1 - fairProb)) / b;
  return Math.max(0, fraction) * multiplier;
}

// ---- devig (backend/engine/devig.py) ----

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Devigs by scaling every implied probability by the same factor.
 * @param {!Array<number>} probs
 * @return {!Array<number>}
 */
export function multiplicative(probs) {
  const total = sum(probs);
  return probs.map((p) => p / total);
}

/**
 * Devigs by raising every implied probability to the same power.
 * @param {!Array<number>} probs
 * @return {!Array<number>}
 */
export function power(probs) {
  let lo = 0.5;
  let hi = 5.0;
  let k = 1;
  for (let i = 0; i < 60; i++) {
    k = (lo + hi) / 2;
    if (probs.reduce((s, p) => s + p ** k, 0) > 1) {
      lo = k;
    } else {
      hi = k;
    }
  }
  return probs.map((p) => p ** k);
}

/**
 * Returns, per outcome, the larger of the multiplicative and power results.
 * @param {!Array<number>} probs
 * @return {!Array<number>}
 */
export function worstCase(probs) {
  const mult = multiplicative(probs);
  const pow = power(probs);
  return mult.map((value, i) => Math.max(value, pow[i]));
}

/**
 * Devigs by subtracting an equal share of the overround from every outcome.
 * @param {!Array<number>} probs
 * @return {!Array<number>}
 */
export function additive(probs) {
  const over = sum(probs) - 1;
  return probs.map((p) => p - over / probs.length);
}

/**
 * Devig methods by name. Keys match the backend method names.
 * @const {!Object<string, function(!Array<number>): !Array<number>>}
 */
export const DEVIG = {
  'multiplicative': multiplicative,
  'power': power,
  'additive': additive,
  'worst_case': worstCase,
};

// ---- hold (backend/engine/lowhold.py, generalised to n outcomes) ----

/**
 * Returns the bookmaker margin of a market.
 * @param {!Array<number>} american Odds for every outcome of the market.
 * @return {{overroundPct: number, holdPct: number, totalImplied: number}}
 */
export function hold(american) {
  const total = american.reduce((s, a) => s + americanToProb(a), 0);
  return {
    overroundPct: (total - 1) * 100,
    holdPct: (1 - 1 / total) * 100,
    totalImplied: total,
  };
}

// ---- arbitrage (backend/engine/arb.py) ----

/**
 * Splits `bankroll` across every outcome so each returns the same payout.
 * @param {!Array<number>} american
 * @param {number=} bankroll
 * @return {{profitPct: number, stakes: !Array<number>, payout: number}}
 */
export function arb(american, bankroll = 100) {
  const decimals = american.map((a) => americanToDecimal(a));
  const inv = decimals.reduce((s, d) => s + 1 / d, 0);
  return {
    profitPct: (1 / inv - 1) * 100,
    stakes: decimals.map((d) => bankroll / d / inv),
    payout: bankroll / inv,
  };
}

// ---- parlay (backend/engine/parlay.py) ----

/**
 * Returns the combined odds of a parlay, plus EV when fair probabilities are
 * given for every leg.
 * @param {!Array<number>} american
 * @param {?Array<number>=} fairProbs
 * @return {{decimal: number, american: number, fairProb: (number|undefined),
 *     evPct: (number|undefined)}}
 */
export function parlay(american, fairProbs = null) {
  const decimal = american.reduce((p, a) => p * americanToDecimal(a), 1);
  const out = {decimal, american: decimalToAmerican(decimal)};
  if (fairProbs && fairProbs.length) {
    const prob = fairProbs.reduce((a, b) => a * b, 1);
    out.fairProb = prob;
    out.evPct = (prob * decimal - 1) * 100;
  }
  return out;
}

// ---- round robin ----

/**
 * Returns every `k`-sized combination of the indices `0..n-1`.
 * @param {number} n
 * @param {number} k
 * @return {!Array<!Array<number>>}
 */
export function combinations(n, k) {
  const out = [];
  const cur = [];
  const rec = (start) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  };
  if (k >= 1 && k <= n) rec(0);
  return out;
}

/**
 * Builds every parlay of each size in `sizes`, with `stake` on each. Payouts
 * include the stake returned.
 * @param {!Array<number>} american
 * @param {!Array<number>} sizes
 * @param {number} stake
 * @return {{count: number, totalStake: number, maxPayout: number,
 *     maxProfit: number, parlays: !Array<{legs: !Array<number>,
 *     decimal: number}>}}
 */
export function roundRobin(american, sizes, stake) {
  const decimals = american.map((a) => americanToDecimal(a));
  const parlays = sizes.flatMap(
      (k) => combinations(decimals.length, k).map((legs) => ({
        legs,
        decimal: legs.reduce((p, i) => p * decimals[i], 1),
      })));
  const totalStake = parlays.length * stake;
  const maxPayout = parlays.reduce((s, p) => s + stake * p.decimal, 0);
  return {
    count: parlays.length,
    totalStake,
    maxPayout,
    maxProfit: maxPayout - totalStake,
    parlays,
  };
}

// ---- bonus bets (backend/engine/promo.py) ----

/**
 * Returns the cash hedge that locks in profit from a bonus bet.
 * @param {number} bonus Bonus bet amount (stake not returned on a win).
 * @param {number} oddsBonus American odds of the bonus side.
 * @param {number} oddsHedge American odds of the cash hedge side.
 * @return {{hedgeStake: number, profit: number, conversionPct: number}}
 */
export function bonusBetHedge(bonus, oddsBonus, oddsHedge) {
  const decimalBonus = americanToDecimal(oddsBonus);
  const decimalHedge = americanToDecimal(oddsHedge);
  const bonusWin = bonus * (decimalBonus - 1);
  const hedgeStake = bonusWin / decimalHedge;
  const profit = bonusWin - hedgeStake;
  return {hedgeStake, profit, conversionPct: (profit / bonus) * 100};
}

// ---- hedge ----

/**
 * Hedges a cash bet of `stake` at `oddsOrig` with a bet at `oddsHedge`, so
 * both outcomes return the same.
 * @param {number} stake
 * @param {number} oddsOrig
 * @param {number} oddsHedge
 * @return {{hedgeStake: number, profit: number, unhedgedWin: number,
 *     unhedgedLoss: number}}
 */
export function hedge(stake, oddsOrig, oddsHedge) {
  const decimalOrig = americanToDecimal(oddsOrig);
  const decimalHedge = americanToDecimal(oddsHedge);
  const hedgeStake = (stake * decimalOrig) / decimalHedge;
  const profit = stake * decimalOrig - stake - hedgeStake;
  return {
    hedgeStake,
    profit,
    unhedgedWin: stake * (decimalOrig - 1),
    unhedgedLoss: -stake,
  };
}

// ---- prediction markets ----

/**
 * Converts a contract price in cents (pays 100c) plus an optional
 * per-contract fee in cents to odds.
 * @param {number} cents
 * @param {number=} feeCents
 * @return {?{prob: number, decimal: number, american: number,
 *     breakeven: number}} Null if price plus fee is not between 0 and 100.
 */
export function predictionMarket(cents, feeCents = 0) {
  const cost = cents + feeCents;
  if (!(cost > 0 && cost < 100)) return null;
  const decimal = 100 / cost;
  return {
    prob: cents / 100,
    decimal,
    american: decimalToAmerican(decimal),
    breakeven: cost / 100,
  };
}

// ---- Poisson ----

/**
 * Returns P(X = k) for X ~ Poisson(lambda).
 * @param {number} lambda
 * @param {number} k
 * @return {number}
 */
export function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    p *= lambda / i;
  }
  return p;
}

/**
 * Returns P(over / under / exactly) a prop line given a Poisson mean. Integer
 * lines can push.
 * @param {number} lambda
 * @param {number} line
 * @return {{over: number, under: number, push: number}}
 */
export function poissonOverUnder(lambda, line) {
  let under = 0;
  for (let k = 0; k < Math.ceil(line); k++) {
    under += poissonPmf(lambda, k);
  }
  const push = Number.isInteger(line) ? poissonPmf(lambda, line) : 0;
  return {over: 1 - under - push, under, push};
}

// ---- half points / key numbers ----

/**
 * Rough share of games (percent) landing exactly on each margin from one
 * team's side, i.e. the push rate for a spread at that number. Editable in
 * the UI.
 * @const {!Object<string, !Object<number, number>>}
 */
export const PUSH_RATES = {
  NFL: {1: 2.5, 2: 2.5, 3: 8.5, 4: 3.0, 5: 2.0, 6: 3.0, 7: 5.0, 8: 2.0, 10: 3.0, 14: 2.5},
  NBA: {1: 1.5, 2: 1.8, 3: 2.0, 4: 2.0, 5: 2.3, 6: 2.3, 7: 2.4, 8: 2.2, 9: 2.0, 10: 1.9},
};

/**
 * Compares a bet at a whole-number spread (can push) with the same bet after
 * buying a half point (push becomes a win).
 * @param {number} oddsWhole American odds at the whole number.
 * @param {number} oddsHalf American odds after buying the half point.
 * @param {number} pushPct Push rate at the number, in percent.
 * @param {number=} winNoPush Win probability among games that do not land on
 *     the number.
 * @return {{evWholePct: number, evHalfPct: number, worthIt: boolean}}
 */
export function halfPoint(oddsWhole, oddsHalf, pushPct, winNoPush = 0.5) {
  const push = pushPct / 100;
  const win = (1 - push) * winNoPush;
  const loss = 1 - push - win;
  const decimalWhole = americanToDecimal(oddsWhole);
  const decimalHalf = americanToDecimal(oddsHalf);
  const evWhole = win * (decimalWhole - 1) - loss;
  const evHalf = (win + push) * (decimalHalf - 1) - loss;
  return {
    evWholePct: evWhole * 100,
    evHalfPct: evHalf * 100,
    worthIt: evHalf > evWhole,
  };
}

// ---- spread -> moneyline ----

/** Abramowitz-Stegun 7.1.26 approximation, |error| < 1.5e-7. */
function erf(x) {
  const sign = Math.sign(x);
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const poly =
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
        0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-absX * absX));
}

/**
 * Returns the standard normal cumulative distribution at `z`.
 * @param {number} z
 * @return {number}
 */
export function normCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Typical standard deviation of the final margin, by sport.
 * @const {!Object<string, number>}
 */
export const MARGIN_SD = {NFL: 13.5, NBA: 12, NCAAF: 15.5, NCAAB: 10.5};

/**
 * Prices a favourite laying `spread` points: win prob = P(margin > 0) with
 * margin ~ N(spread, sd).
 * @param {number} spread
 * @param {number} sd
 * @return {{favProb: number, dogProb: number, favAmerican: number,
 *     dogAmerican: number}}
 */
export function spreadToMoneyline(spread, sd) {
  const fav = normCdf(Math.abs(spread) / sd);
  return {
    favProb: fav,
    dogProb: 1 - fav,
    favAmerican: probToAmerican(fav),
    dogAmerican: probToAmerican(1 - fav),
  };
}
