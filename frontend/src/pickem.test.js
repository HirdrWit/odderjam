// Run with: npm test (also run from pytest via tests/test_calc_js.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import * as pickem from './pickem.js';

const FLEX = {'3': {'3': 2.25, '2': 1.25}, '4': {'4': 5, '3': 1.5}};

test('formatTable writes one row per size, most hits first', () => {
  assert.equal(pickem.formatTable(FLEX), '3: 3=2.25, 2=1.25\n4: 4=5, 3=1.5');
  assert.equal(pickem.formatTable({}), '');
});

test('parseTableText round-trips formatTable', () => {
  assert.deepEqual(pickem.parseTableText(pickem.formatTable(FLEX)), FLEX);
  assert.deepEqual(pickem.parseTableText(' 2 : 2 = 3 \n\n'), {'2': {'2': 3}});
});

test('parseTableText rejects bad rows with the row number', () => {
  assert.throws(() => pickem.parseTableText('2: 2=3\n3 3=5'), /row 2/);
  assert.throws(() => pickem.parseTableText('2: 2=x'), /row 1/);
  assert.throws(() => pickem.parseTableText('2: 3=3'), /row 1/); // more hits than legs
  assert.throws(() => pickem.parseTableText('2: 2=-1'), /row 1/);
});

// odderjam-110: payout grid, visible labels, token styling.
import {readFileSync} from 'node:fs';

const jsx = readFileSync(new URL('./Pickem.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

test('payoutRows gives one row per size and hit count, most hits first, round-tripping to the table', () => {
  const rows = pickem.payoutRows(FLEX);
  assert.deepEqual(rows.map((r) => [r.size, r.hits, r.mult]), [[3, 3, '2.25'], [3, 2, '1.25'], [4, 4, '5'], [4, 3, '1.5']]);
  assert.equal(rows[0].first, true);
  assert.equal(rows[1].first, false);
  assert.deepEqual(pickem.rowsToTable(rows).table, FLEX);
});

test('rowsToTable reports a bad multiplier by size and hits', () => {
  const rows = pickem.payoutRows({'2': {'2': 3}});
  rows[0].mult = 'abc';
  assert.match(pickem.rowsToTable(rows).error, /2-pick/);
  rows[0].mult = '-1';
  assert.match(pickem.rowsToTable(rows).error, /2-pick/);
  rows[0].mult = '';
  assert.match(pickem.rowsToTable(rows).error, /2-pick/);
});

test('the payouts editor is a table with no textarea and no raw text format', () => {
  assert.doesNotMatch(jsx, /formatTable|parseTableText/);
  assert.match(jsx, /<table className="payouts"/);
  assert.match(jsx, /type="checkbox"/);
  assert.match(jsx, /Reset to default/);
  assert.match(jsx, /<textarea[^>]*id=/); // the import box still exists and is labelled below
});

test('every Pickem input has a visible label, not a placeholder', () => {
  assert.doesNotMatch(jsx, /placeholder="(Player|Market|Line)"/);
  for (const name of ['Player', 'Market', 'Line', 'Side']) {
    assert.match(jsx, new RegExp(`<label htmlFor="pk-${name.toLowerCase()}">${name}`), name);
  }
  assert.match(jsx, /<label htmlFor="pk-import">/);
  assert.match(jsx, /<label htmlFor="pk-payout">/);
  assert.match(jsx, /aria-label=\{`[^`]*multiplier/); // payout multiplier inputs get a name
  // every <input|select|textarea> carries an id or aria-label
  const controls = jsx.match(/<(input|select|textarea)\b[^>]*>/g) || [];
  assert.ok(controls.length >= 7);
  for (const c of controls) assert.match(c, /\bid=|aria-label/, c);
});

test('textareas use the input tokens and no pickem css hardcodes colors', () => {
  assert.match(css, /(^|\n)[^\n{]*\btextarea\b[^\n{]*\{[^}]*var\(--surface-2\)/);
  const pk = css.match(/[^\n]*\.(pk-|payouts)[^\n]*/g) || [];
  assert.ok(pk.length > 0);
  for (const rule of pk) assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,8}\b/, rule);
});

test('the lines table uses natural widths with right-aligned numbers', () => {
  assert.match(jsx, /<table className="odds pk-lines"/);
  assert.match(jsx, /<td className="num">\{l\.point\}/);
  assert.match(css, /table\.pk-lines\s*\{[^}]*width:\s*auto/);
});
