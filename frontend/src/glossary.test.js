// Run with: node --test src/glossary.test.js (also run from pytest via tests/test_glossary.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {GLOSSARY, findEntry, sortedEntries, tooltipLeft} from './glossary.js';

const REQUIRED = ['ev', 'edge', 'fair-odds', 'devig', 'vig', 'hold', 'sharp-book', 'kelly', 'clv', 'hedge', 'arb', 'middle',
  'american-odds', 'decimal-odds'];

test('every required term is defined with a definition and example', () => {
  for (const id of REQUIRED) {
    const e = findEntry(id);
    assert.ok(e, `missing ${id}`);
    assert.ok(e.label && e.definition && e.example, `incomplete ${id}`);
  }
});

test('ids are unique', () => {
  const ids = GLOSSARY.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('findEntry returns undefined for unknown ids', () => {
  assert.equal(findEntry('nope'), undefined);
});

test('sortedEntries is alphabetical and complete', () => {
  const list = sortedEntries();
  assert.equal(list.length, GLOSSARY.length);
  const labels = list.map((e) => e.label.toLowerCase());
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)));
});

test('tooltipLeft keeps the tooltip inside the viewport', () => {
  // anchor spans 0..40 in a 300px viewport, tip 200 wide, 8px margin
  assert.equal(tooltipLeft({left: 0, width: 40}, 200, 300, 8), 8);
  assert.equal(tooltipLeft({left: 280, width: 20}, 200, 300, 8), 92);
  assert.equal(tooltipLeft({left: 100, width: 40}, 100, 400, 8), 70);
  // tip wider than viewport: pin to the margin
  assert.equal(tooltipLeft({left: 50, width: 10}, 500, 300, 8), 8);
});
