import assert from 'node:assert/strict';
import {test} from 'node:test';

import {PRICE_TABS, STALE_LIVE_SECONDS, STALE_PREGAME_SECONDS, ageLabel, isStale, rowFreshness, showsStrip, stripState} from './freshness.js';

test('thresholds: 10 minutes pre-game, 1 minute live', () => {
  assert.equal(STALE_PREGAME_SECONDS, 600);
  assert.equal(STALE_LIVE_SECONDS, 60);
});

test('pre-game staleness passes at 10 minutes', () => {
  assert.equal(isStale(599, false), false);
  assert.equal(isStale(600, false), false);
  assert.equal(isStale(601, false), true);
});

test('live staleness passes at 1 minute', () => {
  assert.equal(isStale(60, true), false);
  assert.equal(isStale(61, true), true);
  assert.equal(isStale(120, false), false);
});

test('unknown age is not flagged stale', () => {
  assert.equal(isStale(null, true), false);
  assert.equal(isStale(undefined, false), false);
});

test('ageLabel reads in words', () => {
  assert.equal(ageLabel(45 * 60), 'Prices are 45m old');
  assert.equal(ageLabel(30), 'Prices are 30s old');
  assert.equal(ageLabel(null), 'Price age unknown');
});

test('rowFreshness gives class and accessible label only for stale rows', () => {
  const fresh = rowFreshness({price_age_seconds: 30, live: false});
  assert.deepEqual(fresh, {stale: false, className: '', label: 'Prices are 30s old'});
  const stale = rowFreshness({price_age_seconds: 2700, live: false});
  assert.equal(stale.stale, true);
  assert.equal(stale.className, 'stale');
  assert.equal(stale.label, 'Stale: prices are 45m old');
  assert.equal(rowFreshness({price_age_seconds: 90, live: true}).className, 'stale');
});

test('stripState is amber when the feed is stale, live threshold when live mode is on', () => {
  assert.deepEqual(stripState({live: true, age_seconds: 2400}, false),
      {stale: true, text: 'Live odds · updated 40m ago', mock: false});
  assert.equal(stripState({live: true, age_seconds: 300}, false).stale, false);
  assert.equal(stripState({live: true, age_seconds: 90}, true).stale, true);
  const mock = stripState({live: false, age_seconds: null}, false);
  assert.equal(mock.mock, true);
  assert.equal(mock.stale, false);
});

test('strip shows on every tab that shows prices', () => {
  for (const t of ['Odds Screen', '+EV', 'Parlay', 'Arbitrage', 'Low Hold', 'Middles', 'Sharp Money', 'Promos']) {
    assert.equal(showsStrip(t), true, t);
    assert.ok(PRICE_TABS.includes(t));
  }
  for (const t of ['Glossary', 'Help', 'Calculator', 'Tracker']) assert.equal(showsStrip(t), false, t);
});
