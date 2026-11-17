// Run with: node --test src/onboarding.test.js (also run from pytest via tests/test_onboarding.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {afterNavigate, initialWelcome, introShown, introToggle} from './onboarding.js';

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

test('first visit: the welcome belongs to the first tab opened', () => {
  assert.equal(initialWelcome('+EV', fakeStorage()), '+EV');
});

test('dismissed: no welcome on any tab', () => {
  assert.equal(initialWelcome('+EV', fakeStorage({welcomeDismissed: '1'})), null);
});

test('going to another tab closes the welcome', () => {
  assert.equal(afterNavigate('+EV', 'Arbitrage'), null);
  assert.equal(afterNavigate('+EV', '+EV'), '+EV');
  assert.equal(afterNavigate(null, 'Arbitrage'), null);
});

test('a tab intro is never shown while the welcome is showing', () => {
  assert.equal(introShown('+EV', false), false);
  assert.equal(introShown(null, false), true);
});

test('a collapsed intro stays a "?" control, reopened it shows the banner', () => {
  assert.equal(introShown(null, true), false);
  assert.equal(introToggle(true).label, 'About this tab');
  assert.equal(introToggle(false), null);
});

test('at most one onboarding box on any state', () => {
  for (const welcomeTab of [null, '+EV']) {
    for (const collapsed of [true, false]) {
      const boxes = (welcomeTab ? 1 : 0) + (introShown(welcomeTab, collapsed) ? 1 : 0);
      assert.ok(boxes <= 1);
    }
  }
});
