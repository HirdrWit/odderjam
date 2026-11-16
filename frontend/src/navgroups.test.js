import test from 'node:test';
import assert from 'node:assert/strict';
import {NAV_GROUPS, NAV_SUBTITLES, navTabs} from './navgroups.js';

const ALL = ['Odds Screen', '+EV', 'Parlay', 'Arbitrage', 'Low Hold', 'Middles', 'Sharp Money', 'Promos', 'Pick\'em', 'Calculator', 'Tracker', 'Alerts', 'Glossary'];

test('three groups with the issue headings', () => {
  assert.deepEqual(NAV_GROUPS.map((g) => g.title), ['Compare prices', 'Find bets', 'Size and track']);
});

test('every tab appears exactly once', () => {
  assert.deepEqual([...navTabs()].sort(), [...ALL].sort());
});

test('group membership follows the issue', () => {
  const by = Object.fromEntries(NAV_GROUPS.map((g) => [g.title, g.tabs]));
  assert.deepEqual(by['Compare prices'], ['Odds Screen']);
  assert.deepEqual(by['Size and track'], ['Calculator', 'Tracker', 'Alerts', 'Glossary']);
  assert.equal(by['Find bets'].length, 8);
});

test('every tab has a short one-line subtitle', () => {
  for (const t of ALL) {
    assert.ok(NAV_SUBTITLES[t] && NAV_SUBTITLES[t].length <= 40, t);
    assert.ok(!NAV_SUBTITLES[t].includes('\n'));
  }
  assert.equal(NAV_SUBTITLES['Arbitrage'], 'Guaranteed profit');
});
