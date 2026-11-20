// Run with: node --test src/bettable.test.js
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {BETTABLE_KEY, FLAGS, badgesFor, bettableChip, bettableStatus, bettableRank, filterBettable, hiddenSummary,
  readBettable, showAnyway, writeBettable} from './bettable.js';
import {findEntry} from './glossary.js';
import {HELP_SECTIONS} from './help.js';

const rows = [
  {id: 1, flags: []},
  {id: 2, flags: ['in_play']},
  {id: 3, flags: ['in_play', 'longshot']},
  {id: 4, flags: ['too_good']},
  {id: 5},
];

test('on: flagged rows are dropped, unflagged and flagless rows stay (I1)', () => {
  const {shown, hidden} = filterBettable(rows, true);
  assert.deepEqual(shown.map((r) => r.id), [1, 5]);
  assert.equal(hidden.length, 3);
});

test('off: every row is shown, nothing hidden (I2)', () => {
  const {shown, hidden} = filterBettable(rows, false);
  assert.equal(shown.length, 5);
  assert.equal(hidden.length, 0);
});

test('summary counts rows hidden and each flag (I1)', () => {
  const {hidden} = filterBettable(rows, true);
  assert.equal(hiddenSummary(hidden), '3 hidden: 2 in-play, 1 longshot, 1 too good to be true');
});

test('summary is empty when nothing is hidden', () => {
  assert.equal(hiddenSummary([]), '');
});

test('every flag has a label and a plain-English tooltip', () => {
  for (const f of ['in_play', 'longshot', 'heavy_fav', 'too_good', 'fragile', 'sharps_disagree']) {
    assert.ok(FLAGS[f] && FLAGS[f].badge && FLAGS[f].tip.length > 15 && FLAGS[f].summary, f);
  }
  assert.match(FLAGS.in_play.tip, /stale/);
  assert.match(FLAGS.longshot.tip, /small errors look like big edges/);
});

test('one badge per flag, each with tooltip text; unknown flags still get a badge (I2)', () => {
  const b = badgesFor({flags: ['in_play', 'longshot', 'mystery']});
  assert.equal(b.length, 3);
  assert.ok(b.every((x) => x.label && x.tip));
  assert.deepEqual(badgesFor({}), []);
});

test('storage: defaults to OFF when empty, throws or junk (I1)', () => {
  assert.equal(readBettable({getItem: () => null}), false);
  assert.equal(readBettable({getItem: () => { throw new Error('denied'); }}), false);
  assert.equal(readBettable({getItem: () => 'banana'}), false);
  assert.equal(readBettable(undefined), false);
});

test('storage: new key is bettableOnly.v2 and the old key is ignored (I1)', () => {
  assert.equal(BETTABLE_KEY, 'bettableOnly.v2');
  assert.equal(readBettable({getItem: (k) => (k === 'bettableOnly' ? 'true' : null)}), false);
  assert.equal(readBettable({getItem: (k) => (k === 'bettableOnly.v2' ? 'true' : null)}), true);
});

test('status: unflagged row is Bettable with no reasons (I2)', () => {
  assert.deepEqual(bettableStatus({flags: []}), {label: 'Bettable', reasons: []});
  assert.deepEqual(bettableStatus({}), {label: 'Bettable', reasons: []});
});

test('status: flagged row is Not bettable and lists each flag tip (I2)', () => {
  const s = bettableStatus({flags: ['in_play', 'fragile']});
  assert.equal(s.label, 'Not bettable');
  assert.deepEqual(s.reasons, [FLAGS.in_play.tip, FLAGS.fragile.tip]);
});

test('rank: Bettable rows sort before Not bettable (I3)', () => {
  assert.ok(bettableRank({flags: []}) < bettableRank({flags: ['longshot']}));
});

test('storage: persists and reads back OFF and ON (I3)', () => {
  const mem = {};
  const s = {getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }};
  writeBettable(s, false);
  assert.equal(readBettable(s), false);
  writeBettable(s, true);
  assert.equal(readBettable(s), true);
  assert.equal(mem['bettableOnly.v2'], 'true');
});

test('write does not throw when storage throws (I3)', () => {
  assert.doesNotThrow(() => writeBettable({setItem: () => { throw new Error('full'); }}, false));
  assert.doesNotThrow(() => writeBettable(undefined, false));
});

test('chip shows only when off; show anyway turns mode off (I4)', () => {
  assert.equal(bettableChip(true), null);
  assert.match(bettableChip(false).label, /Bettable only/);
  assert.equal(showAnyway(), false);
});

test('glossary and help explain the mode and list each flag (I5)', () => {
  const g = findEntry('bettable-only');
  assert.ok(g && g.definition && g.example);
  const s = HELP_SECTIONS.find((x) => x.id === 'bettable-only');
  assert.ok(s, 'help section');
  const text = [s.title, ...s.paragraphs, ...(s.items || []).flatMap((i) => [i.q, i.a])].join(' ');
  for (const f of Object.values(FLAGS)) assert.ok(text.includes(f.badge), `help lists ${f.badge}`);
});
