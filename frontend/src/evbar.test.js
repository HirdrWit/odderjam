import assert from 'node:assert/strict';
import {test} from 'node:test';

import {DEVIG_METHODS, methodLabel, FILTER_HELP, ROW_ACTION_TIPS, DEFAULT_METHOD, pendingStartText} from './evbar.js';

const CODES = ['multiplicative', 'additive', 'power', 'shin', 'worst_case'];

test('every devig method has a readable name with no raw code', () => {
  for (const code of CODES) {
    const label = methodLabel(code);
    assert.ok(label.length > 3, code);
    assert.ok(!label.includes('_'), `${code} -> ${label}`);
    assert.ok(label[0] === label[0].toUpperCase(), label);
  }
  assert.equal(methodLabel('unknown_thing'), 'unknown_thing');
});

test('the default devig method is named as the default, others are not', () => {
  assert.equal(DEFAULT_METHOD, 'multiplicative');
  assert.match(methodLabel(DEFAULT_METHOD), /default/i);
  for (const code of CODES.filter((c) => c !== DEFAULT_METHOD)) assert.doesNotMatch(methodLabel(code), /default/i);
  assert.deepEqual(Object.keys(DEVIG_METHODS), CODES);
});

test('filter controls have a plain explanation and a recommended default', () => {
  for (const key of ['devig', 'kelly', 'sharpWeights', 'maxHold', 'bankroll']) {
    assert.ok(FILTER_HELP[key].length > 20, key);
    assert.ok(FILTER_HELP[key].length < 260, key);
  }
  for (const key of ['devig', 'kelly', 'sharpWeights', 'maxHold']) assert.match(FILTER_HELP[key], /default|recommend/i, key);
});

test('row action buttons have tooltips', () => {
  for (const key of ['bet', 'track', 'slip']) assert.ok(ROW_ACTION_TIPS[key].length > 10, key);
});

test('pending start text shows only when the typed value differs from saved', () => {
  assert.equal(pendingStartText(100, 100), '');
  assert.match(pendingStartText(1500, 100), /saving|pending/i);
  assert.equal(pendingStartText('', 100), '');
});
