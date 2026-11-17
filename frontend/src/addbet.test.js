// Tracker add-bet form (odderjam-101): visible labels, hidden until opened, per-field errors, odds format.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {ADD_BET_FIELDS, betFieldErrors, parseOddsInput} from './tracker.js';

const jsx = readFileSync(new URL('./Tracker.jsx', import.meta.url), 'utf8');

test('every add-bet field has a visible label and a unique id', () => {
  assert.ok(ADD_BET_FIELDS.length >= 6);
  const ids = new Set();
  for (const f of ADD_BET_FIELDS) {
    assert.ok(f.label && f.label.trim(), `label for ${f.key}`);
    assert.ok(f.id && !ids.has(f.id), `unique id for ${f.key}`);
    ids.add(f.id);
  }
  for (const name of ['Pick', 'Event', 'Sport', 'Book', 'Odds', 'Stake', 'Strategy']) {
    assert.ok(ADD_BET_FIELDS.some((f) => f.label.startsWith(name)), name);
  }
});

test('the form renders a <label htmlFor> per field and no placeholder-only inputs', () => {
  assert.match(jsx, /<label[^>]*htmlFor=\{f\.id\}/);
  assert.doesNotMatch(jsx, /placeholder="(Pick|Event|Sport|Book|Odds|Stake)/);
});

test('the form is hidden until an Add bet button opens it', () => {
  assert.match(jsx, /useState\(false\)/);
  assert.match(jsx, /\{showForm && /);
  assert.match(jsx, /setShowForm\(true\)|setShowForm\(\(open\)/);
});

test('filters keep Export/Import in a menu', () => {
  assert.match(jsx, /<details className="more"/);
  assert.match(jsx, /<summary[^>]*>⋯<\/summary>/);
});

test('parseOddsInput accepts American in any format and decimal in decimal format', () => {
  assert.equal(parseOddsInput('+150', 'american'), 150);
  assert.equal(parseOddsInput('-110', 'american'), -110);
  assert.equal(parseOddsInput('2.5', 'decimal'), 150);
  assert.equal(parseOddsInput('1.91', 'decimal'), -110);
  assert.equal(parseOddsInput('+150', 'decimal'), 150, 'American still accepted in decimal mode');
  assert.ok(Number.isNaN(parseOddsInput('', 'american')));
  assert.ok(Number.isNaN(parseOddsInput('1.5', 'american')), 'decimal not accepted in american mode');
  assert.ok(Number.isNaN(parseOddsInput('0.9', 'decimal')));
});

test('betFieldErrors reports each problem against its own field', () => {
  assert.deepEqual(betFieldErrors({pick: 'A', odds: '+150', stake: '10'}, 'american'), {});
  const e = betFieldErrors({pick: ' ', odds: '50', stake: '0'}, 'american');
  assert.deepEqual(Object.keys(e).sort(), ['odds', 'pick', 'stake']);
  assert.match(e.pick, /required/i);
  assert.deepEqual(betFieldErrors({pick: 'A', odds: '2.5', stake: '5'}, 'decimal'), {});
});
