// odderjam-37: rounded arb stakes must not add up to more than the entered
// total. Mirrors tests/test_sizing_total.py. Run from pytest via
// tests/test_calc_js.py.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as calc from './calc.js';

/** Returns true if some floor/ceil combination of positive stakes fits. */
function fits(idealStakes, inc, total) {
  const options = idealStakes.map((s) => {
    const lo = Math.floor(s / inc + 1e-6) * inc;
    return [lo, lo + inc].filter((x) => x > 0);
  });
  const combos = options.reduce(
      (acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]);
  return combos.some((c) => c.reduce((x, y) => x + y, 0) <= total + 1e-9);
}

test('sizeArb never exceeds the total when a rounding fits', () => {
  for (const a of [100, 105, 120, 150, 300]) {
    for (const b of [-140, -120, -105, 100, 110]) {
      for (const t of [10, 50, 100, 333]) {
        for (const inc of [1, 5, 10]) {
          const r = calc.sizeArb([a, b], t, inc);
          if (fits(r.idealStakes, inc, t)) {
            assert.ok(r.totalStake <= t + 1e-9, `${[a, b, t, inc]}: ${r.stakes}`);
            assert.equal(r.overTotal, false);
          }
        }
      }
    }
  }
  const example = calc.sizeArb([-400, 440], 100, 1);
  assert.ok(example.totalStake <= 100, `${example.stakes}`);
});

test('sizeArb flags an overspend no rounding can avoid', () => {
  const r = calc.sizeArb([100, 110], 10, 10);
  assert.deepEqual(r.stakes, [10, 10]);
  assert.equal(r.overTotal, true);
  assert.ok(r.warning && r.warning.includes('$10.00 over'), r.warning);
  const both = calc.sizeArb([300, -105], 10, 10);
  assert.ok(both.overTotal && both.roundingLoss);
  assert.ok(both.warning.includes('over') && both.warning.includes('lose'));
});
