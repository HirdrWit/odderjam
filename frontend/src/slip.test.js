// Run with: node --test src/slip.test.js (also run from pytest via tests/test_parlay_slip_js.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {slipLeg, slipPriceText} from './slip.js';

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
