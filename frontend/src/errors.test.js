import assert from 'node:assert/strict';
import {test} from 'node:test';

import {fetchJson, loadState, plainError} from './api.js';
import {boundaryMessage} from './boundary.js';
import {providerErrorText} from './freshness.js';
import {tableView} from './tablestate.js';
import {legStake, trackLegs} from './track.js';

const ok = (body) => async () => ({ok: true, status: 200, json: async () => body});
const bad = (status, body) => async () => ({ok: false, status, json: async () => body, text: async () => 'boom'});

test('fetchJson returns parsed JSON on ok', async () => {
  assert.deepEqual(await fetchJson('/x', ok({a: 1})), {a: 1});
});

test('fetchJson rejects on a non-ok response, even a plain-text 500', async () => {
  await assert.rejects(fetchJson('/x', async () => ({
    ok: false, status: 500, json: async () => { throw new SyntaxError('bad'); },
  })));
});

test('fetchJson rejects when fetch itself rejects', async () => {
  await assert.rejects(fetchJson('/x', async () => { throw new TypeError('offline'); }));
});

test('loadState: success gives data and no error', async () => {
  assert.deepEqual(await loadState('/x', ok([1])), {data: [1], error: null});
});

test('loadState: non-ok gives an error and keeps no data', async () => {
  const s = await loadState('/x', bad(500));
  assert.equal(s.data, null);
  assert.ok(s.error && typeof s.error === 'string');
});

test('loadState: rejected fetch gives an error', async () => {
  const s = await loadState('/x', async () => { throw new TypeError('offline'); });
  assert.equal(s.data, null);
  assert.ok(s.error);
});

test('loadState: null url clears data and error without fetching', async () => {
  const s = await loadState(null, () => assert.fail('must not fetch'));
  assert.deepEqual(s, {data: null, error: null});
});

test('plainError never shows raw exception text', () => {
  const t = plainError(new TypeError('NetworkError when attempting to fetch resource'), 500);
  assert.doesNotMatch(t, /TypeError|NetworkError|undefined|null/);
});

test('tableView shows a failed state with Retry text, never skeleton', () => {
  const v = tableView({data: null, error: 'x', emptyText: null, refreshing: false, what: 'odds'});
  assert.equal(v.kind, 'failed');
  assert.equal(v.showHead, false);
  assert.match(v.text, /Couldn't load odds/);
});

test('tableView still shows skeleton when there is no error', () => {
  assert.equal(tableView({data: null, emptyText: null, refreshing: false}).kind, 'skeleton');
});

test('boundaryMessage names the tab', () => {
  assert.match(boundaryMessage('Middles'), /Middles.*hit an error.*Reload/s);
});

test('legStake refuses a missing or zero stake instead of defaulting to 1', () => {
  assert.equal(legStake({stake: 0}), null);
  assert.equal(legStake({}), null);
  assert.equal(legStake({stake: undefined}), null);
  assert.equal(legStake({stake: 12.345}), 12.35);
});

const legs = [{pick: 'A', stake: 10}, {pick: 'B', stake: 20}, {pick: 'C', stake: 5}];

test('trackLegs success posts every leg', async () => {
  const posted = [];
  const r = await trackLegs(legs, async (l) => { posted.push(l.pick); return {ok: true}; });
  assert.deepEqual(posted, ['A', 'B', 'C']);
  assert.equal(r.ok, true);
});

test('trackLegs stops at a rejected leg and names it', async () => {
  const posted = [];
  const r = await trackLegs(legs, async (l) => { posted.push(l.pick); return {ok: l.pick !== 'B'}; });
  assert.equal(r.ok, false);
  assert.equal(r.failed.pick, 'B');
  assert.equal(r.logged, 1);
  assert.deepEqual(posted, ['A', 'B']);
  assert.match(r.message, /B/);
});

test('trackLegs treats a thrown post as a failure', async () => {
  const r = await trackLegs(legs, async () => { throw new TypeError('offline'); });
  assert.equal(r.ok, false);
  assert.equal(r.failed.pick, 'A');
});

test('trackLegs refuses a leg with no stake and posts nothing', async () => {
  const r = await trackLegs([{pick: 'A', stake: 10}, {pick: 'B'}], async () => assert.fail('no post'));
  assert.equal(r.ok, false);
  assert.match(r.message, /B/);
});

test('providerErrorText says what is wrong and since when', () => {
  const at = Date.UTC(2026, 10, 1, 21, 12) / 1000;
  assert.match(providerErrorText({status: 401, at}), /Odds provider: .*(key|credits)/i);
  assert.match(providerErrorText({status: 429, at}), /rate limited/i);
  assert.match(providerErrorText({status: null, at}), /offline|reach/i);
  assert.equal(providerErrorText(null), null);
  assert.equal(providerErrorText(undefined), null);
});
