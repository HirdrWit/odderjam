import assert from 'node:assert/strict';
import {test} from 'node:test';

import {stakingSummary} from './staking.js';

test('summary names kelly, rounding and cap', () => {
  assert.equal(stakingSummary({kelly: 0.25, round: 1, max: 50}), 'Kelly 0.25 · round to $1 · max $50 per side');
});

test('summary handles cents rounding and no cap', () => {
  assert.equal(stakingSummary({kelly: 0.5, round: 0, max: ''}), 'Kelly 0.5 · round to cents · no cap');
});
