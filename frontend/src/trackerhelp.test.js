// Run with: node --test src/trackerhelp.test.js (also run from pytest via tests/test_tracker_alerts_help.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {trackerEmptyText} from './empty.js';
import {findEntry} from './glossary.js';
import {INTRO_COPY} from './intro.js';

test('copy exists for Tracker and Alerts, one sentence each', () => {
  for (const tab of ['Tracker', 'Alerts']) {
    const c = INTRO_COPY[tab];
    assert.ok(c, tab);
    for (const s of [c.what, c.how]) {
      assert.equal(s.match(/[.!?](\s|$)/g).length, 1, `${tab}: one sentence each: ${s}`);
    }
  }
  assert.match(INTRO_COPY.Tracker.what + INTRO_COPY.Tracker.how, /every bet/i);
  assert.match(INTRO_COPY.Alerts.what + INTRO_COPY.Alerts.how, /never spends? extra API credits/i);
});

test('Tracker and Alerts field terms are defined', () => {
  for (const id of ['closing-odds', 'bonus-bet', 'sharp-clv', 'strategy', 'min-percent', 'discord-webhook']) {
    const e = findEntry(id);
    assert.ok(e, id);
    assert.ok(e.label && e.definition && e.example, id);
  }
  const hook = findEntry('discord-webhook');
  assert.ok(hook.definition);
});

test('tracker empty state only for a loaded empty list', () => {
  assert.equal(
      trackerEmptyText([]),
      'No bets yet. Click Add bet, or Track on any +EV or Arbitrage row.');
  for (const data of [null, undefined, {detail: 'bad'}, [{id: 1}]]) {
    assert.equal(trackerEmptyText(data), null);
  }
});
