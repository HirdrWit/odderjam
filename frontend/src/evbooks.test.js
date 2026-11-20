import assert from 'node:assert/strict';
import {test} from 'node:test';

import {DEFAULT_FILTERS, activeChips, booksParam, clearFilter, evFilterCount, loadBooks, serializeBooks} from './evfilters.js';
import {buildHash, evFiltersToParams, evParamsToFilters, parseHash} from './routes.js';

const D = {books: ['DraftKings'], minEv: 1};

test('I3 two books are sent as one comma list', () => {
  assert.equal(booksParam(['DraftKings', 'FanDuel']), '&books=DraftKings%2CFanDuel');
});

test('I4 no books selected sends no book param', () => {
  assert.equal(booksParam([]), '');
});

test('I5 stored values load: old string, all, list, missing, junk', () => {
  assert.deepEqual(loadBooks('FanDuel'), ['FanDuel']);
  assert.deepEqual(loadBooks(''), []);
  assert.deepEqual(loadBooks(null), ['DraftKings']);
  assert.deepEqual(loadBooks(serializeBooks(['DraftKings', 'FanDuel'])), ['DraftKings', 'FanDuel']);
  assert.deepEqual(loadBooks(serializeBooks([])), []);
  assert.deepEqual(loadBooks('["Nope","FanDuel"]'), ['FanDuel']);
});

test('I6 hash round-trips several books', () => {
  const hash = buildHash('+EV', evFiltersToParams({books: ['DraftKings', 'FanDuel'], minEv: 1}));
  assert.deepEqual(evParamsToFilters(parseHash(hash).params, D).books, ['DraftKings', 'FanDuel']);
});

test('I6 old ?book= link works and unknown names are dropped', () => {
  assert.deepEqual(evParamsToFilters({book: 'FanDuel'}, D).books, ['FanDuel']);
  assert.deepEqual(evParamsToFilters({books: 'Nope,FanDuel,Bogus'}, D).books, ['FanDuel']);
  assert.deepEqual(evParamsToFilters({}, D).books, ['DraftKings']);
});

test('I7 chip labels, count and clear', () => {
  const two = {...DEFAULT_FILTERS, books: ['DraftKings', 'FanDuel']};
  assert.equal(activeChips(two)[0].label, 'Books: DraftKings, FanDuel');
  assert.equal(activeChips({...DEFAULT_FILTERS, books: ['FanDuel']})[0].label, 'Book: FanDuel');
  assert.equal(evFilterCount(two), 1);
  assert.deepEqual(clearFilter(two, 'books').books, []);
});
