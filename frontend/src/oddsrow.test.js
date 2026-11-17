import assert from 'node:assert/strict';
import {test} from 'node:test';

import {booksHelp, introVisible, slipToast} from './oddsrow.js';

test('adding a price confirms and links to Parlay', () => {
  const t = slipToast(true);
  assert.match(t.text, /added to slip/i);
  assert.equal(t.kind, 'ok');
  assert.equal(t.action.tab, 'Parlay');
  assert.match(t.action.label, /parlay/i);
});

test('removing a price confirms without a link', () => {
  const t = slipToast(false);
  assert.match(t.text, /removed from slip/i);
  assert.equal(t.action, undefined);
});

test('booksHelp explains the shown/total count', () => {
  const text = booksHelp(3, 4);
  assert.match(text, /3 of 4/);
  assert.match(text, /sportsbook/i);
  assert.match(text, /hidden|hide/i);
});

test('booksHelp copes with one book and none', () => {
  assert.match(booksHelp(0, 0), /0 of 0/);
  assert.match(booksHelp(1, 1), /1 of 1/);
});

test('the tab intro waits while the welcome banner shows', () => {
  assert.equal(introVisible(true), false);
  assert.equal(introVisible(false), true);
});
