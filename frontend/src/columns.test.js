import assert from 'node:assert/strict';
import {test} from 'node:test';

import {COLUMNS, columnTip, rowExample, zeroStakeReason} from './columns.js';
import {evEmptyText, middlesEmptyText, arbsEmptyText, lowHoldEmptyText, sharpEmptyText} from './empty.js';
import {findEntry} from './glossary.js';

const TABS = ['+EV', 'Low Hold', 'Middles', 'Sharp Money'];
const fmt = {odds: (o) => (o > 0 ? `+${o}` : `${o}`), money: (m) => `$${m.toFixed(2)}`};

test('every column on the table tabs has a one-line tooltip', () => {
  for (const tab of TABS) {
    assert.ok(COLUMNS[tab]?.length > 0, `${tab} has columns`);
    for (const c of COLUMNS[tab]) {
      const tip = columnTip(tab, c.label);
      assert.ok(tip.length > 10, `${tab} / ${c.label} has a tooltip`);
      assert.ok(tip.length < 220, `${tab} / ${c.label} tooltip is one line`);
    }
  }
});

test('expected headers are covered', () => {
  const labels = (t) => COLUMNS[t].map((c) => c.label);
  assert.ok(['EV%', 'Fair', 'Stake'].every((l) => labels('+EV').includes(l)));
  assert.ok(['Hold', 'Exp. loss'].every((l) => labels('Low Hold').includes(l)));
  assert.ok(['Hit %', 'Worst case', 'Win both', 'Window'].every((l) => labels('Middles').includes(l)));
  assert.ok(['Volume', '× usual', 'Spike price'].every((l) => labels('Sharp Money').includes(l)));
});

test('tooltips reuse glossary definitions where an entry exists', () => {
  let reused = 0;
  for (const tab of TABS) {
    for (const c of COLUMNS[tab]) {
      if (!c.glossary) continue;
      const entry = findEntry(c.glossary);
      assert.ok(entry, `${c.glossary} exists in the glossary`);
      assert.equal(columnTip(tab, c.label), entry.definition);
      reused += 1;
    }
  }
  assert.ok(reused >= 4);
  assert.equal(columnTip('Low Hold', 'Hold'), findEntry('hold').definition);
  assert.equal(columnTip('+EV', 'Fair'), findEntry('fair-odds').definition);
});

test('columnTip is empty for an unknown column', () => {
  assert.equal(columnTip('+EV', 'Nope'), '');
  assert.equal(columnTip('Nope', 'EV%'), '');
});

test('rowExample reads the first row on each tool tab', () => {
  const ev = rowExample('+EV', {ev_pct: 3.2, pick: 'Chiefs', book: 'FanDuel', odds: 110, fair_odds: 100, stake: 12.5}, fmt);
  assert.match(ev, /How to read this row/);
  assert.match(ev, /Chiefs/);
  assert.match(ev, /FanDuel/);
  assert.match(ev, /3\.2%/);
  assert.match(ev, /\+110/);
  assert.match(ev, /\$12\.50/);
  const arb = rowExample('Arbitrage', {profit_pct: 1.5, legs: [{pick: 'A', book: 'X', stake: 50}, {pick: 'B', book: 'Y', stake: 50}]}, fmt);
  assert.match(arb, /How to read this row/);
  assert.match(arb, /1\.5%/);
  assert.match(arb, /A @ X/);
  const low = rowExample('Low Hold', {hold_pct: 0.8, expected_loss: -0.4, legs: [{pick: 'A', book: 'X'}]}, fmt);
  assert.match(low, /0\.8%/);
  const mid = rowExample('Middles', {window: '3 to 5', worst_case: -4.5, win_both: 90, hit_prob: 0.12}, fmt);
  assert.match(mid, /3 to 5/);
  assert.match(mid, /12\.0%/);
  const sharp = rowExample('Sharp Money', {event: 'A @ B', outcome: 'A', exchange: 'Kalshi', ratio: 4.2, volume: 900}, fmt);
  assert.match(sharp, /4\.2×/);
  assert.match(sharp, /Kalshi/);
});

test('rowExample is empty for an unknown tab', () => {
  assert.equal(rowExample('Nope', {}, fmt), '');
});

test('ev and middles empty states say what the tab looks for and one thing to try', () => {
  const ev = evEmptyText([], 2.5) ?? '';
  assert.match(ev, /2\.5%/);
  assert.match(ev, /lower min ev/i);
  const mid = middlesEmptyText([], 0.5, 5) ?? '';
  assert.match(mid, /middle/i);
  assert.match(mid, /min window/i);
  assert.match(mid, /max cost/i);
  assert.match(middlesEmptyText([], 0.5, '') ?? '', /min window/i);
  for (const data of [null, undefined, {detail: 'bad'}, [{a: 1}]]) {
    assert.equal(evEmptyText(data, 1), null);
    assert.equal(middlesEmptyText(data, 1, 5), null);
  }
});

test('every empty state says what the tab looks for and names a control to change', () => {
  const texts = [
    [evEmptyText([], 1), /min ev/i],
    [arbsEmptyText([], 1), /min profit/i],
    [lowHoldEmptyText([], 1), /max hold/i],
    [middlesEmptyText([], 1, 5), /min window/i],
    [sharpEmptyText([], 3, 10), /spike/i],
  ];
  for (const [t, re] of texts) {
    assert.match(t ?? '', re);
    assert.match(t ?? '', /lower|raise|widen|add|refresh|check back/i);
  }
});

// odderjam-74: a positive edge with a $0 stake must say why.
const ZERO = {ev_pct: 7.4, pick: 'Titans', book: 'DraftKings', odds: 150, fair_odds: 130, stake: 0, kelly_stake: 0.4};

test('zeroStakeReason explains a zero stake on a positive edge', () => {
  const r = zeroStakeReason(ZERO);
  assert.match(r, /under \$1/i);
  assert.match(r, /bankroll/i);
  assert.match(r, /round to/i);
});

test('zeroStakeReason is empty when the stake is positive or there is no edge', () => {
  assert.equal(zeroStakeReason({...ZERO, stake: 5}), '');
  assert.equal(zeroStakeReason({...ZERO, ev_pct: 0}), '');
  assert.equal(zeroStakeReason({...ZERO, ev_pct: -1}), '');
});

test('rowExample gives the zero-stake reason instead of "$0.00"', () => {
  const t = rowExample('+EV', ZERO, fmt);
  assert.match(t, /7\.4%/);
  assert.match(t, /under \$1/i);
  assert.doesNotMatch(t, /\$0\.00/);
});
