import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTO_SETTLE_KEY, DUE_SETTLE_URL, shouldAutoSettle, dueSettleToast} from './tracker.js';

test('setting key and url', () => {
  assert.equal(AUTO_SETTLE_KEY, 'autoSettle');
  assert.equal(DUE_SETTLE_URL, '/api/bets/settle?due=1');
});

test('on by default, off only when false', () => {
  assert.equal(shouldAutoSettle(undefined), true);
  assert.equal(shouldAutoSettle(true), true);
  assert.equal(shouldAutoSettle(false), false);
});

test('toast only when something settled', () => {
  assert.equal(dueSettleToast({checked: 2, settled: [{}, {}]}), 'Settled 2 bets');
  assert.equal(dueSettleToast({checked: 1, settled: [{}]}), 'Settled 1 bet');
  assert.equal(dueSettleToast({checked: 1, settled: []}), null);
  assert.equal(dueSettleToast(null), null);
  assert.equal(dueSettleToast({}), null);
});
