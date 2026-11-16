import assert from 'node:assert/strict';
import {test} from 'node:test';

import {WELCOME_KEY, dismissWelcome, shouldShowWelcome} from './welcome.js';

/** In-memory Storage stand-in. */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      data.set(k, String(v));
    },
  };
}

const THROWING = {
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('denied');
  },
};

test('first visit shows the welcome banner', () => {
  assert.equal(shouldShowWelcome(memoryStorage()), true);
});

test('dismiss hides it on every later visit', () => {
  const storage = memoryStorage();
  dismissWelcome(storage);
  assert.equal(storage.getItem(WELCOME_KEY) !== null, true);
  assert.equal(shouldShowWelcome(storage), false);
});

test('reopen: clearing dismissal state is not needed, show is in-memory', () => {
  const storage = memoryStorage();
  dismissWelcome(storage);
  // "Show welcome" only flips component state; storage stays dismissed.
  assert.equal(shouldShowWelcome(storage), false);
});

test('a throwing localStorage does not crash and shows the banner', () => {
  assert.equal(shouldShowWelcome(THROWING), true);
  assert.doesNotThrow(() => dismissWelcome(THROWING));
});

test('a missing storage object does not crash', () => {
  assert.equal(shouldShowWelcome(undefined), true);
  assert.doesNotThrow(() => dismissWelcome(undefined));
});
