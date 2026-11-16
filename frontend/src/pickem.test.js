// Run with: npm test (also run from pytest via tests/test_calc_js.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import * as pickem from './pickem.js';

const FLEX = {'3': {'3': 2.25, '2': 1.25}, '4': {'4': 5, '3': 1.5}};

test('formatTable writes one row per size, most hits first', () => {
  assert.equal(pickem.formatTable(FLEX), '3: 3=2.25, 2=1.25\n4: 4=5, 3=1.5');
  assert.equal(pickem.formatTable({}), '');
});

test('parseTableText round-trips formatTable', () => {
  assert.deepEqual(pickem.parseTableText(pickem.formatTable(FLEX)), FLEX);
  assert.deepEqual(pickem.parseTableText(' 2 : 2 = 3 \n\n'), {'2': {'2': 3}});
});

test('parseTableText rejects bad rows with the row number', () => {
  assert.throws(() => pickem.parseTableText('2: 2=3\n3 3=5'), /row 2/);
  assert.throws(() => pickem.parseTableText('2: 2=x'), /row 1/);
  assert.throws(() => pickem.parseTableText('2: 3=3'), /row 1/); // more hits than legs
  assert.throws(() => pickem.parseTableText('2: 2=-1'), /row 1/);
});
