// Run with: npm test (also run from pytest via tests/test_calc_js.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {americanToProb} from './calc.js';
import * as odds from './odds.js';
import * as oddsrow from './oddsrow.js';

function close(a, b, tol = 1e-6) {
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
}

test('formatOdds in each format', () => {
  assert.equal(odds.formatOdds(150), '+150');
  assert.equal(odds.formatOdds(-110), '-110');
  assert.equal(odds.formatOdds(150, 'decimal'), '2.50');
  assert.equal(odds.formatOdds(-200, 'prob'), '66.7%');
  assert.equal(odds.formatOdds(null), '');
});

const SPREADS = [
  {name: 'Lakers', point: -3.5, prices: {A: -110, B: -105}},
  {name: 'Celtics', point: 3.5, prices: {A: -110, B: -115}},
  {name: 'Lakers', point: -4.5, prices: {C: 100}},
  {name: 'Celtics', point: 4.5, prices: {C: -120}},
];

test('lineGroups pairs spread sides from the home perspective', () => {
  const g = odds.lineGroups('spreads', SPREADS, 'Lakers', 'Celtics');
  assert.deepEqual(g.map((x) => x.point), [-4.5, -3.5]);
  assert.ok(g.every((x) => x.complete));
  assert.deepEqual(g[1].outcomes.map((x) => x.name), ['Lakers', 'Celtics']);
});

test('lineGroups handles unknown (prop) markets', () => {
  const outs = [{name: 'Over', point: 25.5, prices: {A: -110}}];
  const g = odds.lineGroups('player_points', outs, 'H', 'A');
  assert.equal(g.length, 1);
  assert.equal(g[0].complete, false);
});

test('lineGroups splits props by player and labels the player', () => {
  const outs = [
    {name: 'Over', player: 'B', point: 20.5, prices: {A: -110}},
    {name: 'Under', player: 'B', point: 20.5, prices: {A: -110}},
    {name: 'Over', player: 'A', point: 20.5, prices: {A: -115}},
    {name: 'Under', player: 'A', point: 20.5, prices: {A: -105}},
  ];
  const g = odds.lineGroups('player_points', outs, 'H', 'A');
  assert.deepEqual(
      g.map((x) => [x.player, x.point, x.complete]), [['A', 20.5, true], ['B', 20.5, true]]);
  assert.equal(odds.outcomeLabel(g[0].outcomes[0]), 'A Over 20.5');
});

test('groupStats: best, hold at best prices, fair', () => {
  const [, main] = odds.lineGroups('spreads', SPREADS, 'Lakers', 'Celtics');
  const s = odds.groupStats(main, ['A', 'B']);
  assert.deepEqual(s.best, [{book: 'B', price: -105}, {book: 'A', price: -110}]);
  const implied = 105 / 205 + 110 / 210;
  close(s.holdPct, (1 - 1 / implied) * 100);
  assert.equal(s.bookCount, 2);
  close(americanToProb(s.fair[0]) + americanToProb(s.fair[1]), 1, 1e-9);
  // Only selected books count.
  assert.deepEqual(odds.groupStats(main, ['A']).best[0], {book: 'A', price: -110});
});

test('mainGroup picks the line most books offer', () => {
  const g = odds.lineGroups('spreads', SPREADS, 'Lakers', 'Celtics');
  assert.equal(odds.mainGroup(g, ['A', 'B', 'C']).point, -3.5);
});

test('filterEvents searches teams and sorts by start', () => {
  const ev = [
    {home: 'Lakers', away: 'Celtics', start: '2026-11-08T00:00:00Z'},
    {home: 'Heat', away: 'Bucks', start: '2026-11-07T00:00:00Z'},
  ];
  assert.deepEqual(odds.filterEvents(ev).map((e) => e.home), ['Heat', 'Lakers']);
  assert.deepEqual(odds.filterEvents(ev, ' celt').map((e) => e.home), ['Lakers']);
});

test('allBooks collects every book', () => {
  assert.deepEqual(odds.allBooks([{markets: {spreads: SPREADS}}]), ['A', 'B', 'C']);
});

test('ageText formats price age compactly', () => {
  assert.equal(odds.ageText(null), '—');
  assert.equal(odds.ageText(undefined), '—');
  assert.equal(odds.ageText(4.4), '4s');
  assert.equal(odds.ageText(89), '89s');
  assert.equal(odds.ageText(600), '10m');
  assert.equal(odds.ageText(7200), '2.0h');
});

test('splitLive separates in-play from upcoming events, keeping order', () => {
  const evs = [{id: 1, live: false}, {id: 2, live: true}, {id: 3}, {id: 4, live: true}];
  const {live, upcoming} = odds.splitLive(evs);
  assert.deepEqual(live.map((e) => e.id), [2, 4]);
  assert.deepEqual(upcoming.map((e) => e.id), [1, 3]);
});

const SUSPECT_SPREAD = {
  complete: true,
  outcomes: [
    {name: 'Nets', point: -3.5, prices: {MGM: -10000, DK: -110}},
    {name: '76ers', point: 3.5, prices: {MGM: 1350, DK: -110}},
  ],
};

test('isSuspectMarket flags the -97% hold example and passes an ordinary market', () => {
  assert.equal(odds.isSuspectMarket('spreads', SUSPECT_SPREAD, ['MGM', 'DK']), true);
  const ordinary = {complete: true, outcomes: SPREADS.slice(0, 2)};
  assert.equal(odds.isSuspectMarket('spreads', ordinary, ['A', 'B']), false);
});

test('isSuspectMarket: hold floor and odds cap', () => {
  const ml = (a, b) => ({complete: true, outcomes: [
    {name: 'A', point: null, prices: {X: a}}, {name: 'B', point: null, prices: {X: b}}]});
  assert.equal(odds.isSuspectMarket('moneyline', ml(400, 400), ['X']), true);
  assert.equal(odds.isSuspectMarket('moneyline', ml(110, 110), ['X']), false);
  assert.equal(odds.isSuspectMarket('moneyline', ml(-6000, 2500), ['X']), false);
  const tot = (p) => ({complete: true, outcomes: [
    {name: 'Over', point: 220.5, prices: {X: p}}, {name: 'Under', point: 220.5, prices: {X: -110}}]});
  assert.equal(odds.isSuspectMarket('totals', tot(-5001), ['X']), true);
  assert.equal(odds.isSuspectMarket('totals', tot(-5000), ['X']), false);
});

test('groupStats on a suspect market has no best price, hold or fair price', () => {
  const s = odds.groupStats(SUSPECT_SPREAD, ['MGM', 'DK'], 'spreads');
  assert.equal(s.suspect, true);
  assert.deepEqual(s.best, [null, null]);
  assert.equal(s.holdPct, null);
  assert.deepEqual(s.fair, [null, null]);
});

test('groupStats on an ordinary market is not suspect', () => {
  const s = odds.groupStats({complete: true, outcomes: SPREADS.slice(0, 2)}, ['A', 'B'], 'spreads');
  assert.equal(s.suspect, false);
  assert.ok(s.best[0] != null && s.holdPct != null);
});

test('suspectNote and holdClass never color a suspect or negative-floor hold as good', () => {
  assert.equal(oddsrow.suspectNote(), 'Prices look stale or mismatched');
  assert.equal(oddsrow.holdClass(-97.02, true), '');
  assert.equal(oddsrow.holdClass(-97.02, false), '');
  assert.equal(oddsrow.holdClass(-1, false), 'best');
  assert.equal(oddsrow.holdClass(8, false), 'bad');
});
