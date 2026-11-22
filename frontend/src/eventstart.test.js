// Tracker event start (odderjam-142): passed / upcoming / unknown, sorting, form value, phone card cell.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {eventStartInfo, eventStartSortKey, eventStartToIso} from './eventstart.js';
import {ADD_BET_FIELDS} from './tracker.js';

const jsx = readFileSync(new URL('./Tracker.jsx', import.meta.url), 'utf8');
const NOW = new Date('2026-11-21T12:00:00');
const at = (hours) => new Date(NOW.getTime() + hours * 3600000).toISOString();

test('AC1 a pending bet whose start is past is passed, with a text label', () => {
  const i = eventStartInfo(at(-3), 'pending', NOW);
  assert.equal(i.state, 'passed');
  assert.match(i.label, /passed/i);
});

test('AC1 a pending bet in the future shows how far away it is', () => {
  const i = eventStartInfo(at(3), 'pending', NOW);
  assert.equal(i.state, 'upcoming');
  assert.equal(i.label, 'in 3h');
  assert.equal(eventStartInfo(at(24), 'pending', NOW).label, 'tomorrow');
});

test('AC1 no start is unknown, with a dash and a tooltip', () => {
  for (const none of [null, undefined, '', 'garbage']) {
    const i = eventStartInfo(none, 'pending', NOW);
    assert.equal(i.state, 'unknown');
    assert.equal(i.text, '—');
    assert.match(i.title, /unknown/i);
  }
});

test('AC1 settled bets are never flagged passed', () => {
  const i = eventStartInfo(at(-30), 'won', NOW);
  assert.notEqual(i.state, 'passed');
  assert.doesNotMatch(i.label || '', /passed/i);
});

test('AC2 the table has a sortable Event start column that uses eventTime', () => {
  assert.match(jsx, /\['eventStart', 'Event start'/);
  assert.match(jsx, /eventStart:\s*\(b\)/);
  assert.match(jsx, /eventStartInfo\(/);
});

test('AC2 sort key orders by time and puts unknown starts last', () => {
  assert.ok(eventStartSortKey({event_start: at(1)}) < eventStartSortKey({event_start: at(2)}));
  assert.equal(eventStartSortKey({event_start: null}), null);
});

test('AC3 the add-bet form has an event start field and converts it to ISO', () => {
  assert.ok(ADD_BET_FIELDS.some((f) => f.key === 'event_start' && f.label.startsWith('Event start')));
  assert.equal(eventStartToIso(''), null);
  assert.equal(eventStartToIso('2026-11-21T19:30'), new Date('2026-11-21T19:30').toISOString());
  assert.match(jsx, /event_start/);
});

test('AC5 the start cell carries a data-label for the phone cards', () => {
  assert.match(jsx, /data-label="Event start"/);
});
