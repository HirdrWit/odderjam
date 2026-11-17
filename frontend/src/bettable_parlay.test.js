// Run with: node --test src/bettable_parlay.test.js
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {filterBettable, legWarning, parlayFlagState, pickemLegMark} from './bettable.js';

const clean = {pick: 'A', flags: []};
const plain = {pick: 'B'};
const live = {pick: 'C', flags: ['in_play']};
const two = {pick: 'D', flags: ['longshot', 'too_good']};

test('I1: with the mode on the leg picker lists no flagged rows', () => {
  const {shown} = filterBettable([clean, live, plain, two], true);
  assert.deepEqual(shown, [clean, plain]);
  assert.ok(shown.every((r) => !r.flags?.length));
});

test('I2: a flagged leg warns by flag name', () => {
  assert.match(legWarning(live, true), /in-play/i);
  const w = legWarning(two, true);
  assert.match(w, /longshot/i);
  assert.match(w, /too good/i);
  assert.equal(legWarning(clean, true), '');
  assert.equal(legWarning(plain, true), '');
});

test('I2: parlay with flagged legs shows the count and hides the stake', () => {
  assert.deepEqual(parlayFlagState([clean, live, two], true), {flagged: 2, summary: '2 legs flagged', showStake: false});
  assert.deepEqual(parlayFlagState([clean, live], true), {flagged: 1, summary: '1 leg flagged', showStake: false});
});

test('I2: an unflagged parlay is unchanged', () => {
  assert.deepEqual(parlayFlagState([clean, plain], true), {flagged: 0, summary: '', showStake: true});
});

test('I4: mode off changes nothing', () => {
  assert.deepEqual(parlayFlagState([live, two], false), {flagged: 0, summary: '', showStake: true});
  assert.equal(legWarning(live, false), '');
  assert.equal(pickemLegMark({flags: ['in_play']}, false), '');
  assert.deepEqual(filterBettable([live], false).shown, [live]);
});

test('I3: pick\'em marks in-play and stale legs while the mode is on', () => {
  assert.match(pickemLegMark({flags: ['in_play']}, true), /in-play/i);
  assert.match(pickemLegMark({flags: ['stale']}, true), /stale/i);
  assert.equal(pickemLegMark({flags: []}, true), '');
  assert.equal(pickemLegMark({}, true), '');
});

test('wiring: Parlay and Pick\'em use the helpers and send the mode', () => {
  const main = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
  const pick = readFileSync(new URL('./Pickem.jsx', import.meta.url), 'utf8');
  assert.match(main, /parlayFlagState\(/);
  assert.match(main, /legWarning\(/);
  assert.match(pick, /bettable_only/);
  assert.match(pick, /pickemLegMark\(/);
});
