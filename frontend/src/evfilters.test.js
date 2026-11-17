import assert from 'node:assert/strict';
import {test} from 'node:test';

import {DEFAULT_FILTERS, activeChips, clearFilter, resetFilters, sportsParam} from './evfilters.js';

test('default filters produce no chips', () => {
  assert.deepEqual(activeChips(DEFAULT_FILTERS), []);
});

test('each non-default filter shows one chip with a readable label', () => {
  const chips = activeChips({book: 'FanDuel', minEv: 3, sport: 'NBA', props: 'mainlines'});
  assert.deepEqual(chips.map((c) => c.key), ['book', 'minEv', 'sport', 'props']);
  assert.match(chips[0].label, /FanDuel/);
  assert.match(chips[1].label, /3/);
  assert.match(chips[2].label, /NBA/);
  assert.match(chips[3].label, /game lines/i);
});

test('only the changed filter gets a chip', () => {
  const chips = activeChips({...DEFAULT_FILTERS, sport: 'NHL'});
  assert.deepEqual(chips.map((c) => c.key), ['sport']);
});

test('all books is a non-default choice and is labelled', () => {
  const chips = activeChips({...DEFAULT_FILTERS, book: ''});
  assert.equal(chips.length, 1);
  assert.match(chips[0].label, /all books/i);
});

test('removing a chip restores that one filter only', () => {
  const start = {book: 'FanDuel', minEv: 3, sport: 'NBA', props: 'mainlines'};
  assert.deepEqual(clearFilter(start, 'sport'), {...start, sport: DEFAULT_FILTERS.sport});
});

test('reset restores every default and returns a fresh object', () => {
  const reset = resetFilters();
  assert.deepEqual(reset, DEFAULT_FILTERS);
  assert.notEqual(reset, DEFAULT_FILTERS);
  assert.deepEqual(activeChips(reset), []);
});

test('sports query param is empty for any sport', () => {
  assert.equal(sportsParam(''), '');
  assert.equal(sportsParam('NBA'), '&sports=NBA');
});
