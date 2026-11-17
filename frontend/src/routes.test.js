import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHash, buildHash, TAB_SLUGS, evParamsToFilters, evFiltersToParams} from './routes.js';
import {navTabs} from './navgroups.js';

test('parses tab and filters from a hash', () => {
  assert.deepEqual(parseHash('#/ev?book=draftkings&min=2'), {tab: '+EV', params: {book: 'draftkings', min: '2'}});
  assert.deepEqual(parseHash('#/odds'), {tab: 'Odds Screen', params: {}});
});

test('empty or unknown hashes give no tab', () => {
  for (const h of ['', '#', '#/', '#/nope', 'junk']) assert.equal(parseHash(h).tab, null, h);
});

test('buildHash writes tab and params and round-trips', () => {
  assert.equal(buildHash('+EV', {book: 'draftkings', min: '2'}), '#/ev?book=draftkings&min=2');
  assert.equal(buildHash('Arbitrage', {}), '#/arbitrage');
  assert.equal(buildHash('Arbitrage', {a: ''}), '#/arbitrage');
  const back = parseHash(buildHash('+EV', {book: 'Fan Duel', min: '1.5'}));
  assert.deepEqual(back, {tab: '+EV', params: {book: 'Fan Duel', min: '1.5'}});
});

test('every nav tab has a unique slug and glossary opens Help', () => {
  const slugs = navTabs().map((t) => TAB_SLUGS[t]);
  assert.ok(slugs.every(Boolean));
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(parseHash('#/glossary').tab, 'Help');
});

test('+EV filters map to and from params', () => {
  const d = {book: 'DraftKings', minEv: 1};
  assert.deepEqual(evParamsToFilters({book: 'FanDuel', min: '2.5'}, d), {book: 'FanDuel', minEv: 2.5});
  assert.deepEqual(evParamsToFilters({min: 'abc'}, d), d);
  assert.deepEqual(evParamsToFilters({}, d), d);
  assert.deepEqual(evFiltersToParams({book: 'FanDuel', minEv: 2.5}), {book: 'FanDuel', min: '2.5'});
});
