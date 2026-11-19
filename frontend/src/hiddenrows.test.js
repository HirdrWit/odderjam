import assert from 'node:assert/strict';
import {test} from 'node:test';

import {hiddenSummary, splitHidden} from './hiddenrows.js';

const rows = [{id: 1, hidden: null}, {id: 2, hidden: 'hidden'}, {id: 3, hidden: 'tracked'}, {id: 4, hidden: 'tracked'}];

test('splitHidden drops hidden rows unless show is on', () => {
  assert.deepEqual(splitHidden(rows, false).visible.map((r) => r.id), [1]);
  assert.deepEqual(splitHidden(rows, true).visible.map((r) => r.id), [1, 2, 3, 4]);
});

test('splitHidden counts hidden and already tracked', () => {
  const s = splitHidden(rows, false);
  assert.equal(s.hidden, 3);
  assert.equal(s.tracked, 2);
});

test('summary reads "N hidden (M already tracked)"', () => {
  assert.equal(hiddenSummary({hidden: 3, tracked: 2}), '3 hidden (2 already tracked)');
  assert.equal(hiddenSummary({hidden: 1, tracked: 0}), '1 hidden');
  assert.equal(hiddenSummary({hidden: 0, tracked: 0}), '');
});

test('splitHidden tolerates a non-array', () => {
  assert.deepEqual(splitHidden(undefined, false), {visible: [], hidden: 0, tracked: 0});
});
