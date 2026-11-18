import assert from 'node:assert/strict';
import {test} from 'node:test';

import {createPoller, shouldRefreshOnShow} from './visibility.js';

function fakeEnv(initial) {
  const env = {state: initial, listeners: [], timers: new Map(), next: 1};
  env.doc = {
    get visibilityState() {
      return env.state;
    },
    addEventListener: (_t, fn) => env.listeners.push(fn),
    removeEventListener: (_t, fn) => {
      env.listeners = env.listeners.filter((f) => f !== fn);
    },
  };
  env.setInterval = (fn) => {
    env.timers.set(env.next, fn);
    return env.next++;
  };
  env.clearInterval = (id) => env.timers.delete(id);
  env.set = (s) => {
    env.state = s;
    env.listeners.forEach((f) => f());
  };
  env.tick = () => [...env.timers.values()].forEach((f) => f());
  return env;
}

test('no timer runs while hidden; one starts when visible', () => {
  const env = fakeEnv('hidden');
  let n = 0;
  const stop = createPoller(() => n++, 30000, env);
  assert.equal(env.timers.size, 0);
  env.tick();
  assert.equal(n, 0);
  env.set('visible');
  assert.equal(env.timers.size, 1);
  env.tick();
  assert.equal(n, 1);
  env.set('hidden');
  assert.equal(env.timers.size, 0);
  stop();
  assert.equal(env.listeners.length, 0);
});

test('visible at start polls and ticks', () => {
  const env = fakeEnv('visible');
  let n = 0;
  createPoller(() => n++, 30000, env);
  assert.equal(env.timers.size, 1);
  env.tick();
  assert.equal(n, 1);
});

test('onShow fires on each return to visible, not on hide', () => {
  const env = fakeEnv('visible');
  let shown = 0;
  createPoller(() => {}, 30000, env, () => shown++);
  env.set('hidden');
  assert.equal(shown, 0);
  env.set('visible');
  assert.equal(shown, 1);
});

test('refresh on show only when the data is older than the interval', () => {
  assert.equal(shouldRefreshOnShow(7300, 7200), true);
  assert.equal(shouldRefreshOnShow(100, 7200), false);
  assert.equal(shouldRefreshOnShow(null, 7200), true);
});
