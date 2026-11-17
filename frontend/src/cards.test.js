import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterCount, filtersLabel} from './cards.js';

test('filterCount counts only values that differ from the default', () => {
  const defaults = {book: 'DraftKings', minEv: 1, sport: ''};
  assert.equal(filterCount({book: 'DraftKings', minEv: 1, sport: ''}, defaults), 0);
  assert.equal(filterCount({book: '', minEv: 1, sport: 'NBA'}, defaults), 2);
});

test('filterCount treats an empty Tracker filter as inactive', () => {
  const none = {date_from: '', status: '', sport: ''};
  assert.equal(filterCount({date_from: '', status: 'won', sport: ''}, none), 1);
});

test('filtersLabel shows the count only when filters are active', () => {
  assert.equal(filtersLabel(0), 'Filters');
  assert.equal(filtersLabel(3), 'Filters (3)');
});
