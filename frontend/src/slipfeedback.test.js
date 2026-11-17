// Run with: node --test src/slipfeedback.test.js
// Covers the + Slip feedback: toast text, Parlay nav count, button tooltip (odderjam-90).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {ROW_ACTION_TIPS} from './evbar.js';
import {navLabel} from './navgroups.js';
import {slipToast} from './oddsrow.js';

test('slip toast says how many legs are on the slip', () => {
  assert.equal(slipToast(true, 2).text, 'Added to slip (2 legs)');
  assert.equal(slipToast(true, 1).text, 'Added to slip (1 leg)');
  assert.equal(slipToast(false, 1).text, 'Removed from slip (1 leg)');
  assert.equal(slipToast(false, 0).text, 'Removed from slip (0 legs)');
});

test('adding still links to the Parlay tab', () => {
  assert.equal(slipToast(true, 2).action.tab, 'Parlay');
});

test('navLabel shows the slip leg count on Parlay only', () => {
  assert.equal(navLabel('Parlay', 2), 'Parlay (2)');
  assert.equal(navLabel('Parlay', 0), 'Parlay');
  assert.equal(navLabel('+EV', 3), '+EV');
});

test('slip tooltip says a parlay needs two or more legs', () => {
  assert.match(ROW_ACTION_TIPS.slip, /parlay/i);
  assert.match(ROW_ACTION_TIPS.slip, /two or more legs/i);
});
