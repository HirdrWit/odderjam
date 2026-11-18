import assert from 'node:assert/strict';
import {test} from 'node:test';

import {creditsText} from './freshness.js';

test('shows credits left and the last fetch cost', () => {
  assert.equal(creditsText({remaining: '134', last_cost: '6'}), '134 credits left · last fetch 6');
});

test('accepts numbers as well as header strings', () => {
  assert.equal(creditsText({remaining: 134, last_cost: 0}), '134 credits left · last fetch 0');
});

test('omits the last fetch when it is unknown', () => {
  assert.equal(creditsText({remaining: '134'}), '134 credits left');
  assert.equal(creditsText({remaining: '134', last_cost: null}), '134 credits left');
});

test('shows nothing when credits are unknown', () => {
  assert.equal(creditsText({}), null);
  assert.equal(creditsText({remaining: null, last_cost: '6'}), null);
  assert.equal(creditsText({remaining: 'null'}), null);
  assert.equal(creditsText(null), null);
});

test('singular for one credit', () => {
  assert.equal(creditsText({remaining: '1'}), '1 credit left');
});
