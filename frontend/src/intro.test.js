// Run with: node --test src/intro.test.js (also run from pytest via tests/test_intro_js.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {INTRO_COPY, introDismissed, setIntroDismissed, introKey} from './intro.js';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

const brokenStorage = {
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('denied');
  },
  removeItem() {
    throw new Error('denied');
  },
};

test('copy exists for the three core tabs, two sentences max', () => {
  for (const tab of ['Odds Screen', '+EV', 'Arbitrage']) {
    const c = INTRO_COPY[tab];
    assert.ok(c, tab);
    assert.ok(c.what.length > 0 && c.how.length > 0);
    for (const s of [c.what, c.how]) {
      assert.equal(s.match(/[.!?](\s|$)/g).length, 1, `${tab}: one sentence each: ${s}`);
    }
  }
});

test('show on first visit', () => {
  assert.equal(introDismissed(fakeStorage(), 'Arbitrage'), false);
});

test('dismiss persists per tab across a reload', () => {
  const s = fakeStorage();
  setIntroDismissed(s, 'Arbitrage', true);
  assert.equal(introDismissed(s, 'Arbitrage'), true);
  assert.equal(introDismissed(s, '+EV'), false);
  assert.notEqual(introKey('Arbitrage'), introKey('+EV'));
});

test('restore shows it again', () => {
  const s = fakeStorage();
  setIntroDismissed(s, '+EV', true);
  setIntroDismissed(s, '+EV', false);
  assert.equal(introDismissed(s, '+EV'), false);
});

test('works with storage unavailable', () => {
  assert.equal(introDismissed(brokenStorage, 'Arbitrage'), false);
  assert.doesNotThrow(() => setIntroDismissed(brokenStorage, 'Arbitrage', true));
  assert.equal(introDismissed(undefined, 'Arbitrage'), false);
  assert.doesNotThrow(() => setIntroDismissed(undefined, 'Arbitrage', true));
});
