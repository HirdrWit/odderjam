import assert from 'node:assert/strict';
import {test} from 'node:test';

import {gridRows} from './odds.js';

const EVENT = {
  id: 'e1', home: 'Lakers', away: 'Celtics',
  markets: {
    moneyline: [
      {name: 'Lakers', point: null, prices: {A: -150, B: -140}},
      {name: 'Celtics', point: null, prices: {A: 130, B: 125}},
    ],
    spreads: [
      {name: 'Lakers', point: -3.5, prices: {A: -110, B: -105}},
      {name: 'Celtics', point: 3.5, prices: {A: -110, B: -115}},
      {name: 'Lakers', point: -4.5, prices: {A: 100}},
      {name: 'Celtics', point: 4.5, prices: {A: -120}},
    ],
    totals: [
      {name: 'Over', point: 220.5, prices: {A: -110, B: -108}},
      {name: 'Under', point: 220.5, prices: {A: -110, B: -112}},
    ],
    player_points: [
      {name: 'Over', point: 25.5, player: 'LeBron', prices: {A: -110}},
      {name: 'Under', point: 25.5, player: 'LeBron', prices: {A: -110}},
      {name: 'Over', point: 20.5, player: 'Tatum', prices: {A: -110}},
      {name: 'Under', point: 20.5, player: 'Tatum', prices: {A: -110}},
    ],
  },
};

test('moneyline gives one row with two side lines', () => {
  const rows = gridRows(EVENT, 'moneyline', ['A', 'B']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sides.length, 2);
  assert.deepEqual(rows[0].sides.map((s) => s.label), ['Lakers', 'Celtics']);
});

test('each side carries a price per shown book', () => {
  const [row] = gridRows(EVENT, 'moneyline', ['A', 'B']);
  assert.equal(row.sides[0].prices.A, -150);
  assert.equal(row.sides[0].prices.B, -140);
});

test('best price is flagged per side, and only on the best book', () => {
  const [row] = gridRows(EVENT, 'moneyline', ['A', 'B']);
  assert.equal(row.sides[0].best.book, 'B');
  assert.equal(row.sides[0].best.price, -140);
  assert.deepEqual(row.sides[0].isBest, {A: false, B: true});
  assert.deepEqual(row.sides[1].isBest, {A: true, B: false});
});

test('hidden books are ignored when choosing the best', () => {
  const [row] = gridRows(EVENT, 'moneyline', ['A']);
  assert.equal(row.sides[0].best.book, 'A');
  assert.equal(row.sides[0].isBest.B, undefined);
});

test('a spread game shows only its main line, one row', () => {
  const rows = gridRows(EVENT, 'spreads', ['A', 'B']);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sides.map((s) => s.label), ['Lakers -3.5', 'Celtics +3.5']);
});

test('totals give Over and Under sides', () => {
  const rows = gridRows(EVENT, 'totals', ['A', 'B']);
  assert.deepEqual(rows[0].sides.map((s) => s.label), ['Over 220.5', 'Under 220.5']);
});

test('props give one row per player line', () => {
  const rows = gridRows(EVENT, 'player_points', ['A']);
  assert.equal(rows.length, 2);
});

test('a market the game does not have gives no rows', () => {
  assert.deepEqual(gridRows(EVENT, 'player_assists', ['A']), []);
  assert.deepEqual(gridRows({...EVENT, markets: {}}, 'moneyline', ['A']), []);
});

test('rows carry fair price and hold for the Best and Fair columns', () => {
  const [row] = gridRows(EVENT, 'moneyline', ['A', 'B']);
  assert.equal(typeof row.sides[0].fair, 'number');
  assert.equal(typeof row.holdPct, 'number');
  assert.equal(row.suspect, false);
});

test('a suspect line has no best and flags itself', () => {
  const ev = {
    home: 'H', away: 'A',
    markets: {moneyline: [
      {name: 'H', point: null, prices: {A: 400}},
      {name: 'A', point: null, prices: {A: 400}},
    ]},
  };
  const [row] = gridRows(ev, 'moneyline', ['A']);
  assert.equal(row.suspect, true);
  assert.equal(row.sides[0].best, null);
  assert.equal(row.sides[0].isBest.A, false);
});
