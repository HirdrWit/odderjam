import assert from 'node:assert/strict';
import {test} from 'node:test';

import {PROMO_COLUMNS, PROMO_DEFAULT_SORT, PROMO_NUM, PROMO_SORT, promoLegs} from './promos.js';
import {sortRows} from './sorttable.js';

const rows = [
  {conversion_pct: 60, profit: 60, event: 'B @ C', legs: [{promo: true, is_bonus: true, pick: 'A', odds: 200, book: 'DK', stake: 100}, {promo: false, pick: 'B', odds: -150, book: 'FD', stake: 40}]},
  {conversion_pct: 72.5, profit: 72.5, event: 'A @ D', legs: [{promo: false, pick: 'B', odds: -150, book: 'FD', stake: 40}, {promo: true, is_bonus: true, pick: 'A', odds: 200, book: 'DK', stake: 100}]},
  {conversion_pct: 66.7, profit: 66.7, event: 'C @ A', legs: [{promo: true, pick: 'A', odds: 200, book: 'DK', stake: 100}, {promo: false, pick: 'B', odds: -150, book: 'FD', stake: 40}]},
];

test('columns are in the order the issue lists', () => {
  assert.deepEqual(PROMO_COLUMNS.map(([, label]) => label),
      ['Conversion %', 'Locked $', 'Event', 'Bonus leg', 'Hedge leg']);
});

test('numeric columns are conversion and locked only', () => {
  assert.deepEqual([...PROMO_NUM].sort(), ['conversion', 'locked']);
});

test('conversion and locked start high to low', () => {
  for (const id of ['conversion', 'locked']) {
    assert.equal(PROMO_COLUMNS.find(([i]) => i === id)[2], 'desc');
  }
});

test('default sort is conversion high to low', () => {
  assert.deepEqual(PROMO_DEFAULT_SORT, {key: 'conversion', dir: 'desc'});
  const out = sortRows(rows, PROMO_SORT.conversion, PROMO_DEFAULT_SORT.dir);
  assert.deepEqual(out.map((r) => r.conversion_pct), [72.5, 66.7, 60]);
});

test('every column has a sort accessor', () => {
  for (const [id] of PROMO_COLUMNS) assert.equal(typeof PROMO_SORT[id], 'function', id);
});

test('event and legs sort by text', () => {
  assert.deepEqual(sortRows(rows, PROMO_SORT.event, 'asc').map((r) => r.event), ['A @ D', 'B @ C', 'C @ A']);
  assert.equal(PROMO_SORT.bonus(rows[0]), 'A @ DK');
  assert.equal(PROMO_SORT.hedge(rows[0]), 'B @ FD');
});

test('promoLegs finds the promo leg whatever its position', () => {
  for (const r of rows) {
    const {bonus, hedge} = promoLegs(r);
    assert.equal(bonus.pick, 'A');
    assert.equal(hedge.pick, 'B');
  }
});
