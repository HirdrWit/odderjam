// Run with: npm test   (also run from pytest via tests/test_calc_js.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as o from './odds.js';
import { americanToProb } from './calc.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('formatOdds in each format', () => {
  assert.equal(o.formatOdds(150), '+150');
  assert.equal(o.formatOdds(-110), '-110');
  assert.equal(o.formatOdds(150, 'decimal'), '2.50');
  assert.equal(o.formatOdds(-200, 'prob'), '66.7%');
  assert.equal(o.formatOdds(null), '');
});

const spreads = [
  { name: 'Lakers', point: -3.5, prices: { A: -110, B: -105 } },
  { name: 'Celtics', point: 3.5, prices: { A: -110, B: -115 } },
  { name: 'Lakers', point: -4.5, prices: { C: 100 } },
  { name: 'Celtics', point: 4.5, prices: { C: -120 } },
];

test('lineGroups pairs spread sides from the home perspective', () => {
  const g = o.lineGroups('spreads', spreads, 'Lakers', 'Celtics');
  assert.deepEqual(g.map((x) => x.point), [-4.5, -3.5]);
  assert.ok(g.every((x) => x.complete));
  assert.deepEqual(g[1].outcomes.map((x) => x.name), ['Lakers', 'Celtics']);
});

test('lineGroups handles unknown (prop) markets', () => {
  const g = o.lineGroups('player_points', [{ name: 'Over', point: 25.5, prices: { A: -110 } }], 'H', 'A');
  assert.equal(g.length, 1);
  assert.equal(g[0].complete, false);
});

test('groupStats: best, hold at best prices, fair', () => {
  const [, main] = o.lineGroups('spreads', spreads, 'Lakers', 'Celtics');
  const s = o.groupStats(main, ['A', 'B']);
  assert.deepEqual(s.best, [{ book: 'B', price: -105 }, { book: 'A', price: -110 }]);
  const implied = 105 / 205 + 110 / 210;
  close(s.holdPct, (1 - 1 / implied) * 100);
  assert.equal(s.bookCount, 2);
  close(americanToProb(s.fair[0]) + americanToProb(s.fair[1]), 1, 1e-9);
  // Only selected books count.
  assert.deepEqual(o.groupStats(main, ['A']).best[0], { book: 'A', price: -110 });
});

test('mainGroup picks the line most books offer', () => {
  const g = o.lineGroups('spreads', spreads, 'Lakers', 'Celtics');
  assert.equal(o.mainGroup(g, ['A', 'B', 'C']).point, -3.5);
});

test('filterEvents searches teams and sorts by start', () => {
  const ev = [
    { home: 'Lakers', away: 'Celtics', start: '2026-11-08T00:00:00Z' },
    { home: 'Heat', away: 'Bucks', start: '2026-11-07T00:00:00Z' },
  ];
  assert.deepEqual(o.filterEvents(ev).map((e) => e.home), ['Heat', 'Lakers']);
  assert.deepEqual(o.filterEvents(ev, ' celt').map((e) => e.home), ['Lakers']);
});

test('allBooks collects every book', () => {
  assert.deepEqual(o.allBooks([{ markets: { spreads } }]), ['A', 'B', 'C']);
});
