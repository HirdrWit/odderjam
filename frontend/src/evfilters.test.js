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

import {evFilterCount, oddsParam, validateOdds} from './evfilters.js';

test('oddsParam builds the query fragment', () => {
  assert.equal(oddsParam(-220, 320), '&odds_min=-220&odds_max=320');
  assert.equal(oddsParam('', 320), '&odds_max=320');
  assert.equal(oddsParam(-220, ''), '&odds_min=-220');
  assert.equal(oddsParam('', ''), '');
});

test('validateOdds rejects bad values and accepts good ones', () => {
  assert.match(validateOdds(50, '').min, /100/);
  assert.ok(validateOdds('', -99).max);
  assert.ok(validateOdds(NaN, '').min);
  assert.ok(validateOdds(300, 200).max);
  assert.deepEqual(validateOdds(-220, 100), {});
  assert.deepEqual(validateOdds(-100, 320), {});
  assert.deepEqual(validateOdds('', ''), {});
});

test('odds chip label, count and reset', () => {
  const f = {...DEFAULT_FILTERS, oddsMin: -220, oddsMax: 320};
  assert.deepEqual(activeChips(f).map((c) => [c.key, c.label]), [['odds', 'Odds -220 to +320']]);
  assert.equal(activeChips({...DEFAULT_FILTERS, oddsMin: -220})[0].label, 'Odds ≥ -220');
  assert.equal(activeChips({...DEFAULT_FILTERS, oddsMax: 320})[0].label, 'Odds ≤ +320');
  assert.equal(evFilterCount(f), 1);
  assert.equal(evFilterCount({...f, sport: 'NBA'}), 2);
  assert.deepEqual(clearFilter(f, 'odds'), DEFAULT_FILTERS);
  assert.deepEqual(resetFilters(), {...DEFAULT_FILTERS});
  assert.equal(evFilterCount(resetFilters()), 0);
});
