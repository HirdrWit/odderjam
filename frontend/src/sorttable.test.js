import assert from 'node:assert/strict';
import {test} from 'node:test';

import {ariaSort, arrow, compareValues, loadSort, nextSort, saveSort, sortRows} from './sorttable.js';

const memory = () => {
  const data = {};
  return {getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => {
    data[k] = v;
  }};
};

test('odds strings sort by payout, not by sign', () => {
  const rows = ['-220', '+236', '+100', '-110'];
  assert.deepEqual([...rows].sort((a, b) => compareValues(a, b, 'asc')), ['-220', '-110', '+100', '+236']);
  assert.deepEqual([...rows].sort((a, b) => compareValues(a, b, 'desc')), ['+236', '+100', '-110', '-220']);
});

test('percent strings and numbers compare numerically', () => {
  assert.ok(compareValues('9.5%', '10.2%', 'asc') < 0);
  assert.ok(compareValues(2, 10, 'asc') < 0);
  assert.ok(compareValues(2, 10, 'desc') > 0);
});

test('empty values sort last in both directions', () => {
  for (const empty of [null, undefined, '', '—', NaN]) {
    assert.ok(compareValues(empty, 5, 'asc') > 0, `asc ${String(empty)}`);
    assert.ok(compareValues(empty, 5, 'desc') > 0, `desc ${String(empty)}`);
    assert.ok(compareValues(5, empty, 'asc') < 0);
    assert.ok(compareValues(5, empty, 'desc') < 0);
  }
  assert.equal(compareValues(null, '', 'asc'), 0);
});

test('strings compare case-insensitively', () => {
  assert.ok(compareValues('apple', 'Banana', 'asc') < 0);
});

test('sortRows does not mutate and keeps ties stable', () => {
  const rows = [{id: 1, v: 2}, {id: 2, v: null}, {id: 3, v: 2}, {id: 4, v: 1}];
  const out = sortRows(rows, (r) => r.v, 'desc');
  assert.deepEqual(out.map((r) => r.id), [1, 3, 4, 2]);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4]);
});

test('clicking the active column reverses; a new column takes its default direction', () => {
  assert.deepEqual(nextSort({key: 'ev', dir: 'desc'}, 'ev'), {key: 'ev', dir: 'asc'});
  assert.deepEqual(nextSort({key: 'ev', dir: 'asc'}, 'ev'), {key: 'ev', dir: 'desc'});
  assert.deepEqual(nextSort({key: 'ev', dir: 'asc'}, 'odds', 'desc'), {key: 'odds', dir: 'desc'});
  assert.deepEqual(nextSort({key: 'ev', dir: 'asc'}, 'odds'), {key: 'odds', dir: 'asc'});
});

test('aria-sort value and arrow', () => {
  const sort = {key: 'ev', dir: 'desc'};
  assert.equal(ariaSort(sort, 'ev'), 'descending');
  assert.equal(ariaSort({key: 'ev', dir: 'asc'}, 'ev'), 'ascending');
  assert.equal(ariaSort(sort, 'odds'), 'none');
  assert.equal(arrow(sort, 'ev'), '▼');
  assert.equal(arrow({key: 'ev', dir: 'asc'}, 'ev'), '▲');
  assert.equal(arrow(sort, 'odds'), '');
});

test('sort choice is kept per tab and falls back to the default', () => {
  const storage = memory();
  const def = {key: 'ev', dir: 'desc'};
  assert.deepEqual(loadSort(storage, '+EV', def), def);
  saveSort(storage, '+EV', {key: 'odds', dir: 'asc'});
  assert.deepEqual(loadSort(storage, '+EV', def), {key: 'odds', dir: 'asc'});
  assert.deepEqual(loadSort(storage, 'Middles', {key: 'ev', dir: 'desc'}), {key: 'ev', dir: 'desc'});
});

test('bad stored values fall back to the default', () => {
  const storage = memory();
  storage.setItem('sort:+EV', '{nope');
  assert.deepEqual(loadSort(storage, '+EV', {key: 'ev', dir: 'desc'}), {key: 'ev', dir: 'desc'});
  storage.setItem('sort:+EV', JSON.stringify({key: 'x', dir: 'sideways'}));
  assert.deepEqual(loadSort(storage, '+EV', {key: 'ev', dir: 'desc'}), {key: 'ev', dir: 'desc'});
});
