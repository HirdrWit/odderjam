import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {CALC_GUIDE, CALC_QUESTIONS, explainRow} from './calcguide.js';

const jsx = readFileSync(new URL('./Calculators.jsx', import.meta.url), 'utf8');
const block = jsx.slice(jsx.indexOf('const CALCS = {'), jsx.indexOf('};', jsx.indexOf('const CALCS = {')));
const names = [...block.matchAll(/^\s+'([^']+)':/gm)].map((m) => m[1]);

test('every calculator has a use-when line and an example description', () => {
  assert.ok(names.length >= 15);
  for (const n of names) {
    const g = CALC_GUIDE[n];
    assert.ok(g, `missing guide for ${n}`);
    assert.match(g.when, /^Use this when/);
    assert.ok(g.example.length > 10, n);
  }
  assert.deepEqual(Object.keys(CALC_GUIDE).sort(), [...names].sort());
});

test('every result row label used in a calculator has an explanation', () => {
  for (const n of names) {
    const rows = CALC_GUIDE[n].rows;
    assert.ok(Object.keys(rows).length > 0, n);
    for (const text of Object.values(rows)) assert.ok(text.length > 10 && !text.includes('\n'));
  }
  assert.ok(explainRow('Expected value', 'EV %'));
  assert.equal(explainRow('Expected value', 'nope'), '');
  assert.equal(explainRow('nope', 'EV %'), '');
});

test('question index points at real calculators', () => {
  const qs = CALC_QUESTIONS.map((q) => q.question);
  for (const q of ['Is this bet good?', 'How much should I bet?', 'What is the real chance?']) {
    assert.ok(qs.includes(q), q);
  }
  for (const q of CALC_QUESTIONS) assert.ok(names.includes(q.calc), q.calc);
});
