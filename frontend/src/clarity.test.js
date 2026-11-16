import assert from 'node:assert/strict';
import {test} from 'node:test';

import {EXAMPLE_LINE, noMatchReason, noSlipsReason} from './pickem.js';
import {chartNote, chartReady, clvTileText, latestMonth, statusClass} from './tracker.js';

test('statusClass gives each status its own badge class', () => {
  const classes = ['pending', 'won', 'lost', 'push', 'void'].map(statusClass);
  assert.equal(new Set(classes).size, 5);
  for (const c of classes) assert.match(c, /^badge /);
  assert.equal(statusClass('won'), 'badge won');
});

test('clvTileText explains a missing CLV and formats a present one', () => {
  assert.equal(clvTileText(null, 'clv'), 'Enter closing odds to see CLV');
  assert.match(clvTileText(null, 'sharp'), /sharp/i);
  assert.equal(clvTileText(null, 'sharp') === clvTileText(null, 'clv'), false);
  assert.equal(clvTileText(2.34, 'clv'), '2.3%');
  assert.equal(clvTileText(0, 'clv'), '0.0%');
});

test('chart needs two daily points', () => {
  assert.equal(chartReady([]), false);
  assert.equal(chartReady([{}]), false);
  assert.equal(chartReady([{}, {}]), true);
  assert.match(chartNote([{}]), /2 days|two days/i);
  assert.equal(chartNote([{}, {}]), null);
});

test('latestMonth picks the month of the newest bet, else today', () => {
  const daily = [{date: '2026-09-30'}, {date: '2026-11-03'}];
  assert.deepEqual(latestMonth(daily, '2026-12-25'), [2026, 10]);
  assert.deepEqual(latestMonth([], '2026-11-16'), [2026, 10]);
});

test('pickem example row is labelled and complete', () => {
  assert.ok(EXAMPLE_LINE.player && EXAMPLE_LINE.market && Number.isFinite(EXAMPLE_LINE.point));
  assert.equal(EXAMPLE_LINE.example, true);
});

test('noMatchReason says why a line did not match', () => {
  assert.match(noMatchReason({matched: false, point: 24.5}), /24\.5/);
  assert.match(noMatchReason({matched: false, point: 24.5}), /sportsbook/i);
  assert.equal(noMatchReason({matched: true}), '');
});

test('noSlipsReason distinguishes too few legs from no positive slip', () => {
  const legs = [{matched: true}, {matched: false}, {matched: false}];
  assert.match(noSlipsReason(3, legs), /1 of 3/);
  assert.match(noSlipsReason(3, legs), /3/);
  const ok = Array(4).fill({matched: true});
  assert.match(noSlipsReason(2, ok), /same player|same game|single-game/i);
  assert.match(noSlipsReason(2, []), /matched/i);
});
