// Run with: node --test src/introtabs.test.js (also run from pytest via tests/test_intro_more_tabs.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {INTRO_COPY} from './intro.js';

const TABS = ['Parlay', 'Low Hold', 'Middles', 'Sharp Money', 'Promos', 'Pick\'em'];

test('copy exists for each tab, one sentence each', () => {
  for (const tab of TABS) {
    const c = INTRO_COPY[tab];
    assert.ok(c, tab);
    for (const s of [c.what, c.how]) {
      assert.equal(s.match(/[.!?](\s|$)/g).length, 1, `${tab}: one sentence each: ${s}`);
    }
  }
});

test('each banner says what the tab does', () => {
  const text = (t) => INTRO_COPY[t].what + ' ' + INTRO_COPY[t].how;
  assert.match(text('Parlay'), /\+EV/);
  assert.match(text('Parlay'), /slip/i);
  assert.match(text('Parlay'), /book pays (the )?most/i);
  assert.match(text('Low Hold'), /cut/i);
  assert.match(text('Middles'), /both sides/i);
  assert.match(text('Middles'), /between/i);
  assert.match(text('Sharp Money'), /exchange/i);
  assert.match(text('Sharp Money'), /volume/i);
  assert.match(text('Promos'), /free bet/i);
  assert.match(text('Promos'), /profit boost/i);
  assert.match(text('Promos'), /second-chance/i);
  assert.match(text('Pick\'em'), /PrizePicks/);
  assert.match(text('Pick\'em'), /Underdog/);
});

test('each banner names a first step', () => {
  assert.match(INTRO_COPY.Promos.how, /pick your promo type, then your book/i);
  for (const tab of TABS) assert.match(INTRO_COPY[tab].how, /^[A-Z]/, tab);
});

test('promo copy keeps the per-kind facts', () => {
  const t = INTRO_COPY.Promos.what + INTRO_COPY.Promos.how;
  assert.match(t, /not returned/i);
  assert.match(t, /max/i);
});

test('jargon is defined in the copy or wrapped by TabIntro', () => {
  assert.match(INTRO_COPY['Low Hold'].what, /hold \(/i);
  assert.match(INTRO_COPY.Middles.what, /middle|between/i);
});
