// odderjam-137: Must bet badge, toggle and thresholds.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  MUSTBET_DEFAULTS, MUSTBET_FIELDS, mustBetBadge, mustBetParam, mustBetQuery, mustBetReset, validateMustBet,
} from './mustbet.js';

test('defaults match the backend profile', () => {
  assert.deepEqual(MUSTBET_DEFAULTS, {minEv: 2, oddsMin: -200, oddsMax: 200, maxHold: 5});
  assert.deepEqual(mustBetReset(), MUSTBET_DEFAULTS);
  assert.equal(MUSTBET_FIELDS.length, 4);
});

test('badge for a must-bet row lists the reasons', () => {
  const b = mustBetBadge({must_bet: true, must_bet_reasons: ['flags: none', 'worst_ev: 3%']});
  assert.equal(b.label, 'Must bet');
  assert.equal(b.strong, true);
  assert.match(b.tip, /flags: none/);
  assert.match(b.tip, /worst_ev: 3%/);
});

test('a row that failed shows no badge but a tip with the first failed check', () => {
  const row = {must_bet: false, must_bet_reasons: ['sharps: only 1 sharp', 'hold: 6%']};
  assert.equal(mustBetBadge(row), null);
  assert.equal(mustBetBadge(row, true).tip, 'sharps: only 1 sharp');
});

test('rows without the field get nothing', () => {
  assert.equal(mustBetBadge({}), null);
  assert.equal(mustBetBadge({}, true), null);
});

test('toggle param', () => {
  assert.equal(mustBetParam(true), '&must_bet=true');
  assert.equal(mustBetParam(false), '');
});

test('query carries the thresholds, invalid values fall back to last valid', () => {
  const q = mustBetQuery(MUSTBET_DEFAULTS);
  assert.match(q, /must_bet_min_ev=2(&|$)/);
  assert.match(q, /must_bet_odds_min=-200/);
  assert.match(q, /must_bet_odds_max=200/);
  assert.match(q, /must_bet_max_hold=5/);
  assert.match(mustBetQuery({...MUSTBET_DEFAULTS, minEv: ''}, {...MUSTBET_DEFAULTS, minEv: 3}), /must_bet_min_ev=3(&|$)/);
});

test('validation', () => {
  assert.deepEqual(validateMustBet(MUSTBET_DEFAULTS), {});
  assert.ok(validateMustBet({...MUSTBET_DEFAULTS, minEv: -1}).minEv);
  assert.ok(validateMustBet({...MUSTBET_DEFAULTS, maxHold: 'x'}).maxHold);
  assert.ok(validateMustBet({...MUSTBET_DEFAULTS, oddsMin: 300, oddsMax: 100}).oddsMin);
});
