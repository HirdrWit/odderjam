import assert from 'node:assert/strict';
import {test} from 'node:test';

import {ageText, historyQuery, moveLabel} from './linemove.js';

test('sharps moving toward the side is Steam, away is Fading', () => {
  assert.equal(moveLabel(3.2).label, 'Steam');
  assert.equal(moveLabel(-3.2).label, 'Fading');
});

test('small or missing movement has no label', () => {
  assert.equal(moveLabel(0.1), null);
  assert.equal(moveLabel(null), null);
});

test('price age reads in minutes then hours', () => {
  assert.equal(ageText(12), '12m');
  assert.equal(ageText(85), '1h 25m');
  assert.equal(ageText(null), '');
});

test('history query carries market, point and player when set', () => {
  assert.equal(historyQuery({market: 'totals', point: 220.5, player: null}), 'market=totals&point=220.5');
  assert.equal(historyQuery({market: 'player_points', point: 24.5, player: 'A B'}),
      'market=player_points&point=24.5&player=A%20B');
});
