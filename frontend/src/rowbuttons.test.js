import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slipButtonLabel, trackButtonLabel, rowActionAria} from './track.js';

test('slip label changes with a check mark when in the slip', () => {
  assert.equal(slipButtonLabel(false), '+ Slip');
  assert.match(slipButtonLabel(true), /^✓/);
  assert.notEqual(slipButtonLabel(true), slipButtonLabel(false));
});

test('tracked label has a check mark and differs from the off label', () => {
  assert.match(trackButtonLabel(true), /^✓/);
  assert.notEqual(trackButtonLabel(true), trackButtonLabel(false));
});

test('aria labels name the action and the on state in words', () => {
  const row = {pick: 'Lakers', book: 'DraftKings'};
  assert.match(rowActionAria('track', false, row), /track/i);
  assert.match(rowActionAria('track', false, row), /Lakers/);
  assert.match(rowActionAria('track', true, row), /already tracked/i);
  assert.match(rowActionAria('slip', false, row), /add .*slip/i);
  assert.match(rowActionAria('slip', true, row), /remove .*slip|in .*slip/i);
  assert.match(rowActionAria('bet', false, row), /DraftKings/);
});
