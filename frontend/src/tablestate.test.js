import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {SKELETON_ROWS, tableView} from './tablestate.js';

const ROWS = [{a: 1}];

test('first load (data null) shows skeleton rows and no empty text', () => {
  const v = tableView({data: null, emptyText: null, refreshing: false});
  assert.equal(v.kind, 'skeleton');
  assert.equal(v.rows, SKELETON_ROWS);
  assert.equal(v.className, 'tablewrap');
});

test('no rows means no table header: only the empty-state block', () => {
  const v = tableView({data: [], emptyText: 'No bets yet.', refreshing: false});
  assert.equal(v.kind, 'empty');
  assert.equal(v.showHead, false);
  assert.equal(v.text, 'No bets yet.');
});

test('empty with no text still hides the header', () => {
  const v = tableView({data: [], emptyText: null, refreshing: false});
  assert.equal(v.kind, 'empty');
  assert.equal(v.showHead, false);
});

test('rows show the table with its header', () => {
  const v = tableView({data: ROWS, emptyText: null, refreshing: false});
  assert.equal(v.kind, 'table');
  assert.equal(v.showHead, true);
});

test('refreshing with old rows adds the loading class and keeps rows', () => {
  const v = tableView({data: ROWS, emptyText: null, refreshing: true});
  assert.equal(v.kind, 'table');
  assert.equal(v.className, 'tablewrap loading');
});

test('refreshing an empty list still shows the loading class', () => {
  const v = tableView({data: [], emptyText: 'x', refreshing: true});
  assert.equal(v.className, 'tablewrap loading');
});

test('an API error body is not an empty list: table kind falls to error', () => {
  const v = tableView({data: {detail: 'bad'}, emptyText: null, refreshing: false});
  assert.equal(v.kind, 'error');
  assert.equal(v.showHead, false);
});

test('explicit rows array overrides data (Parlay, Tracker)', () => {
  const v = tableView({data: {books: []}, rows: [], emptyText: 'No book', refreshing: false});
  assert.equal(v.kind, 'empty');
});

const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('the table tabs use the shared TableShell', () => {
  assert.match(src('main.jsx'), /<TableShell/g);
  assert.ok((src('main.jsx').match(/<TableShell/g) || []).length >= 6);
  assert.match(src('Tracker.jsx'), /<TableShell/);
});

test('Parlay no longer renders a bare empty header', () => {
  assert.doesNotMatch(src('main.jsx'), /result\.books\.length === 0 && \(/);
});

test('CSS styles the loading wrapper and skeleton rows', () => {
  const css = src('style.css');
  assert.match(css, /\.tablewrap\.loading/);
  assert.match(css, /\.skeleton/);
});

test('useApi exposes a refreshing flag', () => {
  assert.match(src('hooks.js'), /export function useApiStatus/);
});
