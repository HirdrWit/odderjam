import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {eventTime, money, odds, percent, signClass} from './fmt.js';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

test('percent: fixed decimals, explicit sign, true minus', () => {
  assert.equal(percent(3.456), '3.5%');
  assert.equal(percent(3.456, {signed: true}), '+3.5%');
  assert.equal(percent(-2.04, {signed: true}), '−2.0%');
  assert.equal(percent(-97.02, {digits: 2}), '−97.02%');
  assert.equal(percent(0, {signed: true}), '0.0%');
  assert.equal(percent(null), '—');
});

test('money: two decimals, sign carried without color', () => {
  assert.equal(money(12.5), '$12.50');
  assert.equal(money(12.5, {signed: true}), '+$12.50');
  assert.equal(money(-3), '−$3.00');
  assert.equal(money(undefined), '—');
});

test('odds: American with explicit plus, rounded', () => {
  assert.equal(odds(190), '+190');
  assert.equal(odds(-110.4), '−110');
  assert.equal(odds(null), '—');
});

test('signClass: good, bad, neutral', () => {
  assert.equal(signClass(1), 'best');
  assert.equal(signClass(-1), 'bad');
  assert.equal(signClass(0), '');
  assert.equal(signClass(null), '');
});

test('eventTime shapes: no year, no seconds', () => {
  const now = new Date(2026, 10, 16, 12, 0, 0);
  assert.equal(eventTime(new Date(2026, 10, 16, 19, 42, 30), now), 'Today 7:42 PM');
  assert.equal(eventTime(new Date(2026, 10, 17, 19, 40, 0), now), 'Tue 7:40 PM');
  assert.equal(eventTime(new Date(2026, 10, 22, 13, 0, 0), now), 'Nov 22, 1:00 PM');
  assert.equal(eventTime(new Date(2027, 0, 3, 13, 0, 0), now), 'Jan 3, 1:00 PM');
  assert.equal(eventTime(null, now), '—');
});

test('past days and far dates use the date form', () => {
  const now = new Date(2026, 10, 16, 12, 0, 0);
  assert.equal(eventTime(new Date(2026, 10, 14, 9, 5, 0), now), 'Nov 14, 9:05 AM');
});

test('num class right-aligns with tabular figures, including headers', () => {
  assert.match(css, /(?:th|td)\.num[^{]*\{[^}]*text-align:\s*right/);
  assert.match(css, /\.num[^{]*\{[^}]*font-variant-numeric:\s*tabular-nums/);
});

test('good and bad colors are color-blind safe and not the old red/green', () => {
  assert.match(css, /--negative:\s*#ff9f43/);
  assert.match(css, /--positive:\s*#4ee38f/);
});
