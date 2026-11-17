import test from 'node:test';
import assert from 'node:assert/strict';
import {windowText} from './middles.js';
import {middlesEmptyText} from './empty.js';
import {COLUMNS} from './columns.js';

test('windowText gives the window a unit and its range', () => {
  assert.equal(windowText({window: 1, low: 226.5, high: 227.5}), '1 point (226.5 to 227.5)');
  assert.equal(windowText({window: 2, low: 44.5, high: 46.5}), '2 points (44.5 to 46.5)');
  assert.equal(windowText({window: 1.5, low: 3.5, high: 5}), '1.5 points (3.5 to 5)');
});

test('middles empty state mentions the EV filter', () => {
  const t = middlesEmptyText([], 0.5, 5, 0) ?? '';
  assert.match(t, /min ev/i);
  assert.match(t, /0%/);
});

test('Hit % sits right after EV% in the Middles columns', () => {
  const labels = COLUMNS['Middles'].map((c) => c.label);
  assert.equal(labels[0], 'EV%');
  assert.equal(labels[1], 'Hit %');
});
