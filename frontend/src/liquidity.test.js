import test from 'node:test';
import assert from 'node:assert/strict';
import {fmtLiquidity} from './liquidity.js';
import {BETTABLE_DEFAULTS, BETTABLE_FIELDS, bettableQuery, validateBettable} from './thresholds.js';
import {FLAGS, badgesFor} from './bettable.js';

test('fmtLiquidity formats dollars and hides missing data', () => {
  assert.equal(fmtLiquidity(68), 'Liquidity $68');
  assert.equal(fmtLiquidity(68000), 'Liquidity $68,000');
  assert.equal(fmtLiquidity(null), '');
  assert.equal(fmtLiquidity(undefined), '');
});

test('threshold: default 5000, field exists, negative is an inline error, sent on the query', () => {
  assert.equal(BETTABLE_DEFAULTS.maxCounterpartyLiquidity, 5000);
  assert.ok(BETTABLE_FIELDS.some((f) => f.key === 'maxCounterpartyLiquidity'));
  assert.ok(validateBettable({...BETTABLE_DEFAULTS, maxCounterpartyLiquidity: -1}).maxCounterpartyLiquidity);
  assert.deepEqual(validateBettable(BETTABLE_DEFAULTS), {});
  assert.match(bettableQuery(BETTABLE_DEFAULTS), /&max_counterparty_liquidity=5000/);
});

test('sharp_counterparty flag has the badge text', () => {
  assert.ok(FLAGS.sharp_counterparty.tip.length > 15);
  assert.match(badgesFor({flags: ['sharp_counterparty']})[0].tip, /Large order on the other side: likely a sharp bettor/);
});
