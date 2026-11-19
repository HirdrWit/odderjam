import test from 'node:test';
import assert from 'node:assert/strict';
import {ARB_BACKED_TIP, arbBackedBadge, arbBackedParam, legEvText} from './arbbadge.js';

test('tooltip text', () => {
  assert.equal(ARB_BACKED_TIP, 'The other side is priced so you could bet both for a guaranteed profit, so at least one side has an edge');
});

test('badge only for arb-backed rows', () => {
  assert.equal(arbBackedBadge({arb_backed: false}), null);
  const b = arbBackedBadge({arb_backed: true, arb_profit_pct: 0.5});
  assert.equal(b.label, 'Arb-backed');
  assert.equal(b.tip, ARB_BACKED_TIP);
});

test('query param only when the filter is on', () => {
  assert.equal(arbBackedParam(true), '&arb_backed=true');
  assert.equal(arbBackedParam(false), '');
});

test('leg ev text', () => {
  assert.equal(legEvText({ev_pct: 1.234}), 'EV +1.23%');
  assert.equal(legEvText({ev_pct: -0.5}), 'EV -0.50%');
  assert.equal(legEvText({ev_pct: null}), '');
});
