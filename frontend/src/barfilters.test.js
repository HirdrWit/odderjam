// odderjam-105: Arbitrage and Sharp Money filter bars follow the +EV layout.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  ARB_COLUMNS, ARB_DEFAULTS, arbChips, arbReset, arbStakingNote, arbTotalPlaceholder,
} from './arbfilters.js';
import {SHARP_DEFAULTS, SHARP_FIELDS, sharpChips, sharpHint, sharpReset} from './sharpfilters.js';

test('arb defaults match what the tab opened with', () => {
  assert.deepEqual(ARB_DEFAULTS, {min: 0, props: 'include', total: ''});
  assert.deepEqual(arbReset(), ARB_DEFAULTS);
  assert.notEqual(arbReset(), ARB_DEFAULTS);
});

test('arb chips appear only for non-default values', () => {
  assert.deepEqual(arbChips(ARB_DEFAULTS), []);
  const chips = arbChips({min: 1.5, props: 'mainlines', total: 500});
  assert.deepEqual(chips.map((c) => c.key), ['min', 'props', 'total']);
  assert.equal(chips[0].label, 'Min profit: 1.5%');
  assert.equal(chips[1].label, 'Game lines only');
  assert.equal(chips[2].label, 'Total: $500');
});

test('arb staking note reads the shared sizing values', () => {
  assert.equal(arbStakingNote({round: 5, max: 50}), 'Round to $5 · max $50 per side');
  assert.equal(arbStakingNote({round: 0, max: ''}), 'Round to cents · no cap per side');
  assert.match(arbStakingNote({round: 1, max: 20}), /\$1 · max \$20/);
});

test('arb total placeholder follows the bankroll', () => {
  assert.equal(arbTotalPlaceholder({current: 1234.56}), '1235');
  assert.equal(arbTotalPlaceholder(null), 'bankroll');
});

test('arb sorting is declared as table columns with accessors', () => {
  const ids = ARB_COLUMNS.map(([id]) => id);
  for (const id of ['profit', 'event', 'stake']) assert.ok(ids.includes(id), id);
  assert.equal(ARB_COLUMNS.find(([id]) => id === 'profit')[2], 'desc');
});

test('sharp defaults and reset', () => {
  assert.deepEqual(SHARP_DEFAULTS, {windowMin: 10, baselineMin: 120, k: 3, minVolume: 500});
  assert.deepEqual(sharpReset(), SHARP_DEFAULTS);
});

test('sharp has four labeled fields', () => {
  assert.equal(SHARP_FIELDS.length, 4);
  assert.deepEqual(SHARP_FIELDS.map((f) => f.key), ['windowMin', 'baselineMin', 'k', 'minVolume']);
  for (const f of SHARP_FIELDS) {
    assert.ok(f.label && f.label.length > 3, f.key);
    assert.ok(!/\s{2,}|\(\s|\s\)/.test(f.label), `stray spaces in ${f.label}`);
  }
});

test('sharp chips only for non-default values', () => {
  assert.deepEqual(sharpChips(SHARP_DEFAULTS), []);
  const chips = sharpChips({...SHARP_DEFAULTS, k: 5, minVolume: 0});
  assert.deepEqual(chips.map((c) => c.key), ['k', 'minVolume']);
});

test('sharp hint is one line and pins the real comparisons', () => {
  const hint = sharpHint({windowMin: 30, baselineMin: 120, k: 3, minVolume: 500});
  assert.ok(!hint.includes('\n'));
  assert.match(hint, /last 30 min/);
  assert.match(hint, /prior 120 min/);
  assert.match(hint, /more than 3 times the usual rate/);
  assert.match(hint, /at least 500 contracts/);
  assert.ok(hint.length < 200);
});
