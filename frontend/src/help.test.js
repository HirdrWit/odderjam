import assert from 'node:assert/strict';
import {test} from 'node:test';

import {GOTO_EVENT, HELP_SECTIONS, HELP_TAB, convertOdds} from './help.js';

const byId = (id) => HELP_SECTIONS.find((s) => s.id === id);
const textOf = (s) => [s.title, ...(s.paragraphs || []), ...(s.steps || []), s.risk || '',
  ...(s.items || []).flatMap((i) => [i.q, i.a])].join(' ');

test('constants', () => {
  assert.equal(HELP_TAB, 'Help');
  assert.ok(GOTO_EVENT);
});

test('has every required section', () => {
  for (const id of ['how-it-works', 'odds-formats', 'ev', 'arbitrage', 'middles', 'promos', 'faq']) {
    assert.ok(byId(id), `missing ${id}`);
  }
});

test('walkthrough has a worked example from price to logged bet', () => {
  const t = textOf(byId('how-it-works'));
  assert.match(t, /Odds Screen/);
  assert.match(t, /Tracker/);
  assert.match(t, /\+\d{3}|-\d{3}/, 'example needs a real price');
  assert.ok(byId('how-it-works').steps.length >= 4);
});

test('each guide ends with a risk note covering limits, voids and odds errors', () => {
  for (const id of ['ev', 'arbitrage', 'middles', 'promos']) {
    const r = byId(id).risk;
    assert.ok(r, `${id} risk`);
    assert.match(r, /limit/i, id);
    assert.match(r, /void/i, id);
    assert.match(r, /error|mistake/i, id);
  }
});

test('faq answers the three questions', () => {
  const qs = byId('faq').items.map((i) => i.q.toLowerCase()).join('|');
  assert.match(qs, /disappear/);
  assert.match(qs, /refresh/);
  assert.match(qs, /credit/);
  assert.match(qs, /missing|book/);
  for (const i of byId('faq').items) assert.ok(i.a.length > 20);
});

test('plain English: short sentences everywhere', () => {
  for (const s of HELP_SECTIONS) {
    const sentences = textOf(s).split(/(?<=[.?!])\s+/);
    for (const x of sentences) {
      assert.ok(x.split(/\s+/).length <= 22, `too long in ${s.id}: ${x}`);
    }
  }
});

test('odds formats section defines all three formats', () => {
  const t = textOf(byId('odds-formats'));
  for (const w of [/American/, /decimal/i, /fractional/i]) assert.match(t, w);
});

test('convertOdds from american', () => {
  const r = convertOdds('+150', 'american');
  assert.equal(r.american, '+150');
  assert.equal(r.decimal, '2.50');
  assert.equal(r.fractional, '3/2');
  assert.equal(r.prob, '40.0%');
  assert.equal(convertOdds('-200', 'american').decimal, '1.50');
});

test('convertOdds from decimal and fractional', () => {
  assert.equal(convertOdds('2', 'decimal').american, '+100');
  assert.equal(convertOdds('3/2', 'fractional').american, '+150');
  assert.equal(convertOdds('1.5', 'decimal').american, '-200');
});

test('convertOdds returns null for bad input', () => {
  for (const [v, f] of [['', 'american'], ['abc', 'decimal'], ['50', 'american'], ['0.5', 'decimal'], ['1/0', 'fractional']]) {
    assert.equal(convertOdds(v, f), null, `${v} ${f}`);
  }
});
