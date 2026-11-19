import assert from 'node:assert/strict';
import {test} from 'node:test';

import {BAND_COLUMNS, BAND_SORT} from './bands.js';

test('columns cover the group metrics', () => {
  const ids = BAND_COLUMNS.map(([id]) => id);
  for (const id of ['name', 'bets', 'staked', 'profit', 'roi', 'expected', 'clv', 'beat']) {
    assert.ok(ids.includes(id), id);
    assert.equal(typeof BAND_SORT[id], 'function', id);
  }
});

test('accessors read the API fields; missing CLV is null', () => {
  const g = {name: 'x', bets: 2, staked: 10, profit: 3, roi_pct: 30, expected_profit: 1, avg_clv: null, beat_close_pct: null};
  assert.equal(BAND_SORT.roi(g), 30);
  assert.equal(BAND_SORT.expected(g), 1);
  assert.equal(BAND_SORT.clv(g), null);
  assert.equal(BAND_SORT.beat(g), null);
});
