import test from 'node:test';
import assert from 'node:assert/strict';
import {FLAGS, badgesFor, hiddenSummary} from './bettable.js';

test('multi-leg flags have badge copy', () => {
  assert.ok(FLAGS.leg_skew && FLAGS.longshot_leg);
  const labels = badgesFor({flags: ['leg_skew', 'longshot_leg']}).map((b) => b.label);
  assert.deepEqual(labels, ['Legs priced apart', 'Longshot leg']);
});

test('hidden summary names multi-leg flags', () => {
  const s = hiddenSummary([{flags: ['leg_skew']}, {flags: ['too_good', 'leg_skew']}]);
  assert.equal(s, '2 hidden: 1 too good to be true, 2 legs priced apart');
});
