// Run with: npm test   (also run from pytest via tests/test_calc_js.py)
import test from "node:test";
import assert from "node:assert/strict";
import * as c from "./calc.js";

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test("odds conversions match backend", () => {
  close(c.americanToDecimal(-110), 1.909090909);
  close(c.americanToDecimal(150), 2.5);
  close(c.decimalToAmerican(2.5), 150);
  close(c.probToAmerican(c.americanToProb(-200)), -200);
});

test("fractional odds", () => {
  assert.deepEqual(c.decimalToFractional(2.5), [3, 2]);
  assert.deepEqual(c.decimalToFractional(c.americanToDecimal(-110)), [10, 11]);
  assert.deepEqual(c.decimalToFractional(2), [1, 1]);
  close(c.parseFractional("5/2"), 3.5);
  close(c.parseFractional("10-11"), 1 + 10 / 11);
  assert.ok(Number.isNaN(c.parseFractional("abc")));
});

test("toDecimal validates each format", () => {
  close(c.toDecimal(150, "american"), 2.5);
  assert.ok(Number.isNaN(c.toDecimal(50, "american")));
  close(c.toDecimal(2.5, "decimal"), 2.5);
  close(c.toDecimal(40, "prob"), 2.5);
  close(c.toDecimal("3/2", "fractional"), 2.5);
});

test("ev and kelly match backend", () => {
  close(c.evPct(0.5, 110), 5);
  assert.ok(c.evPct(0.5, -110) < 0);
  assert.equal(c.kellyFraction(0.5, -110), 0);
  close(c.kellyFraction(0.55, 100, 1), 0.1);
});

test("devig methods: even market and sums", () => {
  const even = [c.americanToProb(-110), c.americanToProb(-110)];
  for (const m of Object.values(c.DEVIG)) m(even).forEach((p) => close(p, 0.5));
  const three = [c.americanToProb(150), c.americanToProb(240), c.americanToProb(190)];
  for (const k of ["multiplicative", "power", "additive"]) close(c.DEVIG[k](three).reduce((a, b) => a + b), 1);
  const w = c.worstCase(three), m = c.multiplicative(three), p = c.power(three);
  w.forEach((x, i) => close(x, Math.max(m[i], p[i])));
});

test("hold", () => {
  const h = c.hold([-110, -110]);
  close(h.hold_pct, 4.545454545);
  close(h.overround_pct, 4.761904762);
  close(c.hold([100, 100]).hold_pct, 0);
});

test("arb 2-way and 3-way with custom stake", () => {
  const r = c.arb([110, 110], 100);
  close(r.profit_pct, 5);
  r.stakes.forEach((s) => close(s, 50));
  const r3 = c.arb([300, 300, 300], 300);
  close(r3.profit_pct, 33.333333333);
  r3.stakes.forEach((s) => close(s, 100));
  close(r3.payout, 400);
});

test("parlay matches backend", () => {
  close(c.parlay([100, 100]).decimal, 4);
  close(c.parlay([100, 100], [0.55, 0.55]).ev_pct, 21);
});

test("round robin", () => {
  assert.equal(c.combinations(4, 2).length, 6);
  assert.equal(c.combinations(3, 4).length, 0);
  const r = c.roundRobin([100, 100, 100], [2], 10);
  assert.equal(r.count, 3);
  close(r.total_stake, 30);
  close(r.max_payout, 120);
  const r2 = c.roundRobin([100, 100, 100], [2, 3], 10);
  assert.equal(r2.count, 4);
  close(r2.max_payout, 200);
});

test("bonus bet matches backend", () => {
  const r = c.bonusBetHedge(100, 200, -200);
  assert.ok(r.conversion_pct > 60 && r.conversion_pct < 80);
  close(r.hedge_stake, 200 / 1.5);
});

test("hedge equalises outcomes", () => {
  const r = c.hedge(100, 300, -150);
  // original wins: 100*4 - 100 - hedge; hedge wins: hedge*dh - hedge - 100
  const dh = c.americanToDecimal(-150);
  close(r.profit, r.hedge_stake * dh - r.hedge_stake - 100);
});

test("prediction market cents", () => {
  const r = c.predictionMarket(40);
  close(r.decimal, 2.5);
  close(r.american, 150);
  close(c.predictionMarket(60).american, -150);
  close(c.predictionMarket(48, 2).american, 100);
  assert.equal(c.predictionMarket(100), null);
});

test("poisson over/under", () => {
  const r = c.poissonOverUnder(2, 2.5);
  close(r.under, Math.exp(-2) * (1 + 2 + 2));
  close(r.over + r.under, 1);
  assert.equal(r.push, 0);
  const p = c.poissonOverUnder(2, 2);
  close(p.push, Math.exp(-2) * 2);
  close(p.over + p.under + p.push, 1);
});

test("half point", () => {
  // At -110 vs -110 buying a half point is free value.
  assert.ok(c.halfPoint(-110, -110, 8).worth_it);
  // Zero push rate and a worse price is never worth it.
  assert.ok(!c.halfPoint(-110, -130, 0).worth_it);
  close(c.halfPoint(100, 100, 0).ev_whole_pct, 0);
});

test("spread to moneyline", () => {
  const r = c.spreadToMoneyline(0, 13.5);
  close(r.fav_prob, 0.5);
  const f = c.spreadToMoneyline(-7, 13.5);
  assert.ok(f.fav_prob > 0.65 && f.fav_prob < 0.75);
  assert.ok(f.fav_american < -100 && f.dog_american > 100);
  close(c.normCdf(1.96), 0.975, 1e-4);
});
