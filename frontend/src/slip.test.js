// Run with: node --test src/slip.test.js (also run from pytest via tests/test_parlay_slip_js.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  INDEPENDENT_NOTE, devigLabel, restoredNote, slipLegPriceText, tinyStakeNote,
  slipLeg, slipPriceText, legFairProbs, MISSING_LEG_TEXT,
} from './slip.js';

const EVENT = {id: 'e1', home: 'Boston Celtics', away: 'Orlando Magic', sport: 'NBA'};
const CELTICS = {name: 'Boston Celtics', point: null, prices: {DraftKings: -150, FanDuel: -145}};

test('slipLeg carries the clicked book and odds', () => {
  const leg = slipLeg(EVENT, 'moneyline', CELTICS, 'FanDuel');
  assert.equal(leg.event_id, 'e1');
  assert.equal(leg.event, 'Orlando Magic @ Boston Celtics');
  assert.equal(leg.sport, 'NBA');
  assert.equal(leg.market, 'moneyline');
  assert.equal(leg.name, 'Boston Celtics');
  assert.equal(leg.point, null);
  assert.equal(leg.pick, 'Boston Celtics');
  assert.equal(leg.book, 'FanDuel');
  assert.equal(leg.odds, -145);
});

test('slipLeg identity does not depend on the book', () => {
  const a = slipLeg(EVENT, 'moneyline', CELTICS, 'FanDuel');
  const b = slipLeg(EVENT, 'moneyline', CELTICS, 'DraftKings');
  const identity = ({event_id, market, name, point}) => ({event_id, market, name, point});
  assert.deepEqual(identity(a), identity(b));
});

test('slipLeg returns null for props', () => {
  const over = {name: 'Over', player: 'Jayson Tatum', point: 27.5, prices: {DraftKings: -110}};
  assert.equal(slipLeg(EVENT, 'player_points', over, 'DraftKings'), null);
});

test('slipPriceText formats odds and book', () => {
  assert.equal(slipPriceText({odds: 150, book: 'DraftKings'}), '+150 @ DraftKings');
  assert.equal(slipPriceText({odds: -145, book: 'FanDuel'}), '-145 @ FanDuel');
  assert.equal(slipPriceText({odds: 150, book: 'DraftKings'}, 'decimal'), '2.50 @ DraftKings');
});

test('slipPriceText is empty for legs saved without a price', () => {
  assert.equal(slipPriceText({event_id: 'e1', market: 'moneyline', name: 'A', point: null}), '');
  assert.equal(slipPriceText({odds: 150}), '');
  assert.equal(slipPriceText({book: 'DraftKings'}), '');
});

test('slipLegPriceText always says something: the price, or why it is missing', () => {
  assert.equal(slipLegPriceText({odds: 150, book: 'DraftKings'}), '+150 @ DraftKings');
  const missing = slipLegPriceText({odds: null, book: null});
  assert.match(missing, /no price/i);
  assert.match(missing, /book/i);
  assert.match(slipLegPriceText({odds: null, book: 'FanDuel'}), /no price/i);
});

test('tinyStakeNote explains a stake under $1 only', () => {
  assert.match(tinyStakeNote(0.02), /under \$1/);
  assert.match(tinyStakeNote(0.02), /bankroll/);
  assert.equal(tinyStakeNote(1), null);
  assert.equal(tinyStakeNote(25), null);
  assert.equal(tinyStakeNote(null), null);
  assert.equal(tinyStakeNote(0), null);
});

test('restoredNote shows only for a slip loaded from a previous session', () => {
  assert.match(restoredNote(2, true), /previous session/i);
  assert.match(restoredNote(2, true), /Clear slip/);
  assert.equal(restoredNote(2, false), null);
  assert.equal(restoredNote(0, true), null);
});

test('devigLabel and INDEPENDENT_NOTE are plain language', () => {
  assert.match(devigLabel('multiplicative'), /remov/i);
  assert.doesNotMatch(devigLabel('multiplicative'), /^Devig:/);
  assert.match(devigLabel('multiplicative'), /\+EV tab/);
  assert.match(INDEPENDENT_NOTE, /independent/i);
  assert.match(INDEPENDENT_NOTE, /one leg/i);
});

test('MISSING_LEG_TEXT is plain language with no ids', () => {
  assert.equal(MISSING_LEG_TEXT, 'No longer offered (game started or line pulled)');
});

test('legFairProbs lines priced legs up with slip rows and marks missing ones', () => {
  const legs = [{fair_prob: 0.5}, {fair_prob: null}];
  const out = legFairProbs(3, [{index: 1}], legs);
  assert.deepEqual(out, [{missing: false, fair: 0.5}, {missing: true, fair: null}, {missing: false, fair: null}]);
});

test('legFairProbs with no result marks nothing missing', () => {
  assert.deepEqual(legFairProbs(2, undefined, undefined),
      [{missing: false, fair: undefined}, {missing: false, fair: undefined}]);
});
