// Run with: npm test (also run from pytest via tests/test_calc_js.py).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as calc from './calc.js';

function close(a, b, tol = 1e-6) {
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
}

test('odds conversions match backend', () => {
  close(calc.americanToDecimal(-110), 1.909090909);
  close(calc.americanToDecimal(150), 2.5);
  close(calc.decimalToAmerican(2.5), 150);
  close(calc.probToAmerican(calc.americanToProb(-200)), -200);
});

test('fractional odds', () => {
  assert.deepEqual(calc.decimalToFractional(2.5), [3, 2]);
  assert.deepEqual(calc.decimalToFractional(calc.americanToDecimal(-110)), [10, 11]);
  assert.deepEqual(calc.decimalToFractional(2), [1, 1]);
  close(calc.parseFractional('5/2'), 3.5);
  close(calc.parseFractional('10-11'), 1 + 10 / 11);
  assert.ok(Number.isNaN(calc.parseFractional('abc')));
  close(calc.parseFractional('2.5'), 3.5);
  assert.ok(Number.isNaN(calc.parseFractional('')));
  assert.ok(Number.isNaN(calc.parseFractional('2.5x')));
});

test('toDecimal validates each format', () => {
  close(calc.toDecimal(150, 'american'), 2.5);
  assert.ok(Number.isNaN(calc.toDecimal(50, 'american')));
  close(calc.toDecimal(2.5, 'decimal'), 2.5);
  close(calc.toDecimal(40, 'prob'), 2.5);
  close(calc.toDecimal('3/2', 'fractional'), 2.5);
});

test('ev and kelly match backend', () => {
  close(calc.evPct(0.5, 110), 5);
  assert.ok(calc.evPct(0.5, -110) < 0);
  assert.equal(calc.kellyFraction(0.5, -110), 0);
  close(calc.kellyFraction(0.55, 100, 1), 0.1);
});

test('devig methods: even market and sums', () => {
  const even = [calc.americanToProb(-110), calc.americanToProb(-110)];
  for (const method of Object.values(calc.DEVIG)) {
    for (const p of method(even)) {
      close(p, 0.5);
    }
  }
  const three = [calc.americanToProb(150), calc.americanToProb(240), calc.americanToProb(190)];
  for (const name of ['multiplicative', 'power', 'additive']) {
    close(calc.DEVIG[name](three).reduce((a, b) => a + b), 1);
  }
  const worst = calc.worstCase(three);
  const mult = calc.multiplicative(three);
  const pow = calc.power(three);
  for (const [i, x] of worst.entries()) {
    close(x, Math.max(mult[i], pow[i]));
  }
});

test('hold', () => {
  const h = calc.hold([-110, -110]);
  close(h.holdPct, 4.545454545);
  close(h.overroundPct, 4.761904762);
  close(calc.hold([100, 100]).holdPct, 0);
});

test('arb 2-way and 3-way with custom stake', () => {
  const r = calc.arb([110, 110], 100);
  close(r.profitPct, 5);
  for (const stake of r.stakes) {
    close(stake, 50);
  }
  const r3 = calc.arb([300, 300, 300], 300);
  close(r3.profitPct, 33.333333333);
  for (const stake of r3.stakes) {
    close(stake, 100);
  }
  close(r3.payout, 400);
});

test('parlay matches backend', () => {
  close(calc.parlay([100, 100]).decimal, 4);
  close(calc.parlay([100, 100], [0.55, 0.55]).evPct, 21);
});

test('round robin', () => {
  assert.equal(calc.combinations(4, 2).length, 6);
  assert.equal(calc.combinations(3, 4).length, 0);
  const r = calc.roundRobin([100, 100, 100], [2], 10);
  assert.equal(r.count, 3);
  close(r.totalStake, 30);
  close(r.maxPayout, 120);
  const r2 = calc.roundRobin([100, 100, 100], [2, 3], 10);
  assert.equal(r2.count, 4);
  close(r2.maxPayout, 200);
});

test('bonus bet matches backend', () => {
  const r = calc.bonusBetHedge(100, 200, -200);
  assert.ok(r.conversionPct > 60 && r.conversionPct < 80);
  close(r.hedgeStake, 200 / 1.5);
});

test('hedge equalises outcomes', () => {
  const r = calc.hedge(100, 300, -150);
  // original wins: 100*4 - 100 - hedge; hedge wins: hedge*dh - hedge - 100
  const dh = calc.americanToDecimal(-150);
  close(r.profit, r.hedgeStake * dh - r.hedgeStake - 100);
});

test('prediction market cents', () => {
  const r = calc.predictionMarket(40);
  close(r.decimal, 2.5);
  close(r.american, 150);
  close(calc.predictionMarket(60).american, -150);
  close(calc.predictionMarket(48, 2).american, 100);
  assert.equal(calc.predictionMarket(100), null);
});

test('poisson over/under', () => {
  const r = calc.poissonOverUnder(2, 2.5);
  close(r.under, Math.exp(-2) * (1 + 2 + 2));
  close(r.over + r.under, 1);
  assert.equal(r.push, 0);
  const p = calc.poissonOverUnder(2, 2);
  close(p.push, Math.exp(-2) * 2);
  close(p.over + p.under + p.push, 1);
});

test('half point', () => {
  // At -110 vs -110 buying a half point is free value.
  assert.ok(calc.halfPoint(-110, -110, 8).worthIt);
  // Zero push rate and a worse price is never worth it.
  assert.ok(!calc.halfPoint(-110, -130, 0).worthIt);
  close(calc.halfPoint(100, 100, 0).evWholePct, 0);
});

test('spread to moneyline', () => {
  const r = calc.spreadToMoneyline(0, 13.5);
  close(r.favProb, 0.5);
  const f = calc.spreadToMoneyline(-7, 13.5);
  assert.ok(f.favProb > 0.65 && f.favProb < 0.75);
  assert.ok(f.favAmerican < -100 && f.dogAmerican > 100);
  close(calc.normCdf(1.96), 0.975, 1e-4);
});
