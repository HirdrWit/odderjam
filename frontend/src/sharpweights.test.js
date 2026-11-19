import assert from 'node:assert/strict';
import {test} from 'node:test';

import {FAIR_SOURCES, isCustom, setWeight, weightsSpec} from './sharpweights.js';

const REC = {main: {Pinnacle: 1, 'Circa Sports': 0.5}, props: {Pinnacle: 0.5, FanDuel: 0.25}};

test('weightsSpec writes the per-class form and skips zero weights', () => {
  assert.equal(weightsSpec({main: {Pinnacle: 1, Novig: 0}, props: {FanDuel: 0.25}}),
      'main:Pinnacle:1;props:FanDuel:0.25');
  assert.equal(weightsSpec(REC), 'main:Pinnacle:1,Circa Sports:0.5;props:Pinnacle:0.5,FanDuel:0.25');
});

test('setWeight changes one book in one class only', () => {
  const next = setWeight(REC, 'props', 'Pinnacle', 1);
  assert.equal(next.props.Pinnacle, 1);
  assert.equal(next.main.Pinnacle, 1);
  assert.equal(REC.props.Pinnacle, 0.5);
});

test('isCustom is false for recommended weights and true after an edit (Reset target)', () => {
  assert.equal(isCustom(REC, REC), false);
  assert.equal(isCustom(null, REC), false);
  assert.equal(isCustom(setWeight(REC, 'main', 'Pinnacle', 2), REC), true);
});

test('fair sources', () => {
  assert.deepEqual(FAIR_SOURCES.map((s) => s.value), ['sharp', 'all_books']);
});
