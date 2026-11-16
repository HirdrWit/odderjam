import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  arbMinWarning, arbsEmptyText, ARB_TOTAL_NOTE, LOW_HOLD_DEFAULT_MAX, lowHoldEmptyText, sharpEmptyText,
} from './empty.js';

const NOT_EMPTY = [
  ['loading', null],
  ['undefined', undefined],
  ['API error', {detail: 'min_profit: bad'}],
  ['validation error', {detail: [{loc: ['query', 'k'], msg: 'bad'}]}],
  ['rows', [{event: 'A @ B'}]],
];

const HELPERS = [
  ['arbsEmptyText', (data) => arbsEmptyText(data, 0)],
  ['lowHoldEmptyText', (data) => lowHoldEmptyText(data, 1)],
  ['sharpEmptyText', (data) => sharpEmptyText(data, 3, 10)],
];

test('empty-state helpers return null unless data is an empty list', () => {
  for (const [name, helper] of HELPERS) {
    for (const [label, data] of NOT_EMPTY) {
      assert.equal(helper(data), null, `${name} with ${label}`);
    }
  }
});

test('arbsEmptyText names the min profit threshold and how to widen it', () => {
  assert.match(arbsEmptyText([], 0) ?? '', /no arbs/i);
  assert.match(arbsEmptyText([], 0) ?? '', />= 0%/);
  assert.match(arbsEmptyText([], 1.5) ?? '', />= 1\.5%/);
  assert.match(arbsEmptyText([], 0) ?? '', /min profit/i);
  assert.match(arbsEmptyText([], 0) ?? '', /refresh/i);
});

test('lowHoldEmptyText names the max hold threshold and how to widen it', () => {
  assert.match(lowHoldEmptyText([], 1) ?? '', /<= 1%/);
  assert.match(lowHoldEmptyText([], 2.25) ?? '', /<= 2\.25%/);
  assert.match(lowHoldEmptyText([], 1) ?? '', /max hold/i);
  assert.match(lowHoldEmptyText([], 1) ?? '', /refresh/i);
});

test('sharpEmptyText names the spike multiple and window', () => {
  const text = sharpEmptyText([], 3, 10) ?? '';
  assert.match(text, /spike/i);
  assert.match(text, /3×/);
  assert.match(text, /10 min/);
  assert.match(sharpEmptyText([], 2.5, 30) ?? '', /2\.5×.*30 min|30 min.*2\.5×/);
});

test('arbsEmptyText never tells the user to go below zero', () => {
  for (const min of [-2, -0.5]) {
    const text = arbsEmptyText([], min) ?? '';
    assert.doesNotMatch(text, /lower min profit/i, `min ${min}`);
    assert.match(text, /negative/i);
    assert.match(text, /0%? or more|0 or more/i);
  }
  assert.match(arbsEmptyText([], 0) ?? '', /lower min profit/i);
});

test('arbMinWarning warns only on a negative minimum', () => {
  assert.match(arbMinWarning(-2) ?? '', /negative/i);
  assert.equal(arbMinWarning(0), null);
  assert.equal(arbMinWarning(1.5), null);
});

test('lowHoldEmptyText shows the nearest miss when given the lowest hold', () => {
  const text = lowHoldEmptyText([], 1, 1.2) ?? '';
  assert.match(text, /Lowest hold right now: 1\.20%/);
  assert.match(text, /<= 1%/);
  assert.doesNotMatch(lowHoldEmptyText([], 1) ?? '', /lowest hold/i);
  assert.doesNotMatch(lowHoldEmptyText([], 1, null) ?? '', /lowest hold/i);
});

test('Low Hold opens at a value that shows rows, and Arb total says it follows the bankroll', () => {
  assert.equal(LOW_HOLD_DEFAULT_MAX, 3);
  assert.match(ARB_TOTAL_NOTE, /bankroll/i);
});
