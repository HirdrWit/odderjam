import assert from 'node:assert/strict';
import {test} from 'node:test';

import {CHOICES, choiceLabel, intervalMs, optionText, tickAllowed} from './refresh.js';

test('choices are Off, 1s ... 120m in order', () => {
  assert.deepEqual(CHOICES, [0, 1, 5, 10, 30, 60, 300, 900, 1800, 3600, 7200]);
  assert.deepEqual(CHOICES.map(choiceLabel),
      ['Off', '1s', '5s', '10s', '30s', '60s', '5m', '15m', '30m', '60m', '120m']);
});

test('option text shows credits per hour and the time left', () => {
  assert.equal(optionText({seconds: 30, credits_per_hour: 720, hours_left: 130 / 720}),
      '30s · 720 credits/h · ~11 min left');
  assert.equal(optionText({seconds: 7200, credits_per_hour: 3, hours_left: 100}), '120m · 3 credits/h · ~4 days left');
  assert.equal(optionText({seconds: 300, credits_per_hour: 72, hours_left: 10}), '5m · 72 credits/h · ~10 h left');
});

test('unknown remaining credits show only credits per hour', () => {
  assert.equal(optionText({seconds: 30, credits_per_hour: 720, hours_left: null}), '30s · 720 credits/h');
  assert.equal(optionText({seconds: 30, credits_per_hour: 720}), '30s · 720 credits/h');
});

test('Off shows no cost', () => {
  assert.equal(optionText({seconds: 0, credits_per_hour: 0, hours_left: null}), 'Off');
});

test('interval in ms, none for Off or bad values', () => {
  assert.equal(intervalMs(30), 30000);
  assert.equal(intervalMs(0), null);
  assert.equal(intervalMs(null), null);
  assert.equal(intervalMs(undefined), null);
});

test('a tick runs only for a visible tab, with a timed choice, and no fetch running', () => {
  assert.equal(tickAllowed({hidden: false, fetching: false, seconds: 30}), true);
  assert.equal(tickAllowed({hidden: true, fetching: false, seconds: 30}), false);
  assert.equal(tickAllowed({hidden: false, fetching: true, seconds: 1}), false);
  assert.equal(tickAllowed({hidden: false, fetching: false, seconds: 0}), false);
});
