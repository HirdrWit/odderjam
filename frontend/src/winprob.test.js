import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {COLUMNS, columnTip} from './columns.js';
import {impliedPercent, probPercent} from './fmt.js';
import {findEntry} from './glossary.js';
import {evWinCell, sideWinText, winSortKey} from './winprob.js';

const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('impliedPercent: American odds to one-decimal implied chance', () => {
  assert.equal(impliedPercent(-110), '52.4%');
  assert.equal(impliedPercent(300), '25.0%');
  assert.equal(impliedPercent(100), '50.0%');
  for (const bad of [null, undefined, NaN, 0, 'x']) assert.equal(impliedPercent(bad), '—');
});

test('probPercent: probability to one-decimal string, invalid is a dash', () => {
  assert.equal(probPercent(0.246), '24.6%');
  assert.equal(probPercent(0.5), '50.0%');
  for (const bad of [null, undefined, NaN, 0, 1.2, -0.1]) assert.equal(probPercent(bad), '—');
});

test('evWinCell: Win % is fair_prob, implied is the bet price', () => {
  const cell = evWinCell({fair_prob: 0.5238, odds: 300});
  assert.equal(cell.win, '52.4%');
  assert.equal(cell.implied, '25.0%');
  assert.equal(evWinCell({fair_prob: null, odds: -110}).win, '—');
});

test('winSortKey orders by fair_prob, not by odds', () => {
  const rows = [{fair_prob: 0.2, odds: -500}, {fair_prob: 0.7, odds: 900}, {fair_prob: 0.4, odds: 100}];
  const sorted = [...rows].sort((a, b) => winSortKey(b) - winSortKey(a));
  assert.deepEqual(sorted.map((r) => r.fair_prob), [0.7, 0.4, 0.2]);
});

test('sideWinText: win % of the fair price, dash with none', () => {
  assert.equal(sideWinText(-110), '52.4%');
  assert.equal(sideWinText(null), '—');
  assert.equal(sideWinText(undefined), '—');
});

test('columns and glossary carry help for the new columns', () => {
  for (const [tab, label] of [['+EV', 'Win %'], ['Odds Screen', 'Win %'], ['Tracker', 'Implied %']]) {
    assert.ok(columnTip(tab, label).length > 10, `${tab} / ${label} has help`);
  }
  assert.ok(COLUMNS['+EV'].map((c) => c.label).indexOf('Win %') === COLUMNS['+EV'].map((c) => c.label).indexOf('Fair') + 1);
  const entry = findEntry('win-probability');
  assert.ok(entry && /implied/i.test(entry.definition + entry.example) && /fair/i.test(entry.definition));
});

test('+EV table: Win % column after Fair, sortable desc, with implied beneath', () => {
  const main = src('./main.jsx');
  assert.match(src('./evcolumns.js'), /\['fair', 'Fair', 'desc'\],\s*\['win', 'Win %', 'desc'\]/);
  assert.match(main, /win: winSortKey/);
  assert.match(main, /EV_NUM = new Set\([^)]*'win'/);
  assert.match(main, /evWinCell\(r\)/);
  assert.match(main, /className="num c-win"/);
  assert.match(main, /<Term id="win-probability">/);
});

test('Odds Screen: Win % header after Fair and a cell per side', () => {
  const odds = src('./OddsScreen.jsx');
  assert.match(odds, /<Term id="fair-odds">Fair<\/Term><\/th>\s*<th className="num"><Term id="win-probability">Win %<\/Term><\/th>/);
  assert.match(odds, /sideWinText\(side\.fair\)/);
});

test('Tracker: Implied % column and a cell per bet from logged odds', () => {
  const tracker = src('./Tracker.jsx');
  assert.match(tracker, /\['implied', 'Implied %', 'desc'\]/);
  assert.match(tracker, /impliedPercent\(bet\.odds\)/);
  assert.match(tracker, /<Term id="win-probability">/);
  assert.match(tracker, /columns=\{12\}/);
});
