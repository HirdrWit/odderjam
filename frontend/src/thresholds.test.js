// odderjam-116: Bettable thresholds in Model settings.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  BETTABLE_DEFAULTS, BETTABLE_FIELDS, bettableQuery, bettableReset, validateBettable,
} from './thresholds.js';

test('defaults match the backend profile', () => {
  assert.deepEqual(BETTABLE_DEFAULTS, {
    oddsMin: -250, oddsMax: 250, evCeiling: 8, propEvCeiling: 12, maxSkewSeconds: 20, maxSharpSpread: 3,
    requireConservative: true,
  });
});

test('a changed threshold changes the query (I1)', () => {
  const base = bettableQuery(BETTABLE_DEFAULTS);
  const changed = bettableQuery({...BETTABLE_DEFAULTS, evCeiling: 5});
  assert.notEqual(base, changed);
  assert.match(changed, /&ev_ceiling=5(&|$)/);
  assert.match(base, /bettable_odds_min=-250/);
  assert.match(base, /bettable_odds_max=250/);
  assert.match(base, /prop_ev_ceiling=12/);
  assert.match(base, /max_skew_seconds=20/);
  assert.match(base, /require_conservative=true/);
});

test('sharp spread is shown in points and sent as a 0..1 probability', () => {
  assert.match(bettableQuery(BETTABLE_DEFAULTS), /max_sharp_spread=0\.03(&|$)/);
});

test('the conservative check can be turned off', () => {
  assert.match(bettableQuery({...BETTABLE_DEFAULTS, requireConservative: false}), /require_conservative=false/);
});

test('valid defaults have no errors', () => {
  assert.deepEqual(validateBettable(BETTABLE_DEFAULTS), {});
});

test('inverted odds range is an inline error (I2)', () => {
  const errors = validateBettable({...BETTABLE_DEFAULTS, oddsMin: 300, oddsMax: 100});
  assert.ok(errors.oddsMin || errors.oddsMax);
});

test('negative and non-numeric values are errors (I2)', () => {
  const errors = validateBettable({...BETTABLE_DEFAULTS, evCeiling: -1, maxSkewSeconds: 'abc', maxSharpSpread: -2});
  assert.ok(errors.evCeiling);
  assert.ok(errors.maxSkewSeconds);
  assert.ok(errors.maxSharpSpread);
  assert.equal(errors.propEvCeiling, undefined);
});

test('empty and non-finite values are errors', () => {
  assert.ok(validateBettable({...BETTABLE_DEFAULTS, propEvCeiling: ''}).propEvCeiling);
  assert.ok(validateBettable({...BETTABLE_DEFAULTS, oddsMax: Infinity}).oddsMax);
});

test('invalid values are never sent: the query falls back to the last valid ones (I2)', () => {
  const last = {...BETTABLE_DEFAULTS, evCeiling: 6};
  const bad = {...last, evCeiling: -3};
  assert.equal(bettableQuery(bad, last), bettableQuery(last));
});

test('reset restores every default (I3)', () => {
  const reset = bettableReset();
  assert.deepEqual(reset, BETTABLE_DEFAULTS);
  assert.notEqual(reset, BETTABLE_DEFAULTS);
  assert.equal(bettableQuery(reset), bettableQuery(BETTABLE_DEFAULTS));
});

test('every field has a one-line plain help text (I4)', () => {
  const keys = BETTABLE_FIELDS.map((f) => f.key);
  assert.deepEqual(keys.sort(), Object.keys(BETTABLE_DEFAULTS).sort());
  for (const f of BETTABLE_FIELDS) {
    assert.ok(f.label.length > 0, f.key);
    assert.ok(f.help.length > 20 && f.help.length < 200, f.key);
    assert.ok(!f.help.includes('\n'), f.key);
  }
});
