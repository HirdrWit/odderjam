import assert from 'node:assert/strict';
import {test} from 'node:test';

import {parseStakeInput, trackButtonLabel, trackKey, trackStake, trackToast} from './track.js';

test('logs the stake the row shows, rounded to cents', () => {
  assert.equal(trackStake({stake: 12.345}), 12.35);
  assert.equal(trackStake({stake: 5}), 5);
});

test('a zero or missing suggested stake is not silently replaced by 1', () => {
  assert.equal(trackStake({stake: 0}), null);
  assert.equal(trackStake({stake: 0.004}), null);
  assert.equal(trackStake({}), null);
  assert.equal(trackStake({stake: -3}), null);
});

test('parseStakeInput accepts positive amounts only', () => {
  assert.equal(parseStakeInput('25'), 25);
  assert.equal(parseStakeInput(' $10.5 '), 10.5);
  assert.equal(parseStakeInput(''), null);
  assert.equal(parseStakeInput(null), null);
  assert.equal(parseStakeInput('abc'), null);
  assert.equal(parseStakeInput('0'), null);
  assert.equal(parseStakeInput('-4'), null);
});

test('toast confirms the logged stake and links to Tracker', () => {
  const t = trackToast({pick: 'Titans', book: 'DK'}, 12.5);
  assert.match(t.text, /logged in tracker/i);
  assert.match(t.text, /\$12\.50/);
  assert.equal(t.kind, 'ok');
  assert.equal(t.action.tab, 'Tracker');
  assert.match(t.action.label, /tracker/i);
});

test('button shows tracked state', () => {
  assert.notEqual(trackButtonLabel(true), trackButtonLabel(false));
  assert.match(trackButtonLabel(true), /tracked/i);
  assert.equal(trackButtonLabel(false), 'Track');
});

test('trackKey identifies a row by event, market, pick, point and book', () => {
  const a = {event_id: 'e', market: 'h2h', pick: 'X', point: null, book: 'DK'};
  assert.equal(trackKey(a), trackKey({...a}));
  assert.notEqual(trackKey(a), trackKey({...a, book: 'FD'}));
});
