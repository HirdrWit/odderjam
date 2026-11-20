import assert from 'node:assert/strict';
import {test} from 'node:test';

import {EV_COLUMNS, statusIcon} from './evcolumns.js';
import {COLUMNS, columnTip} from './columns.js';
import {RULES_BUTTON, RULES_FIELDSET_ID, requestRules} from './settings.js';
import {takePanel} from './settings.js';
import {filterBettable} from './bettable.js';

test('Status column sits right after EV and sorts Bettable first (I3)', () => {
  const ids = EV_COLUMNS.map((c) => c[0]);
  assert.equal(ids[0], 'ev');
  assert.equal(ids[1], 'status');
  assert.equal(EV_COLUMNS[1][1], 'Status');
  assert.equal(EV_COLUMNS[1][2], 'asc');
});

test('Status has column help, and the column list matches the help list (I6)', () => {
  assert.ok(columnTip('+EV', 'Status').length > 10);
  assert.ok(COLUMNS['+EV'].some((c) => c.label === 'Status'));
  for (const [, label] of EV_COLUMNS) {
    if (label === 'Sharps (hold)') continue;
    assert.ok(COLUMNS['+EV'].some((c) => c.label === label), label);
  }
});

test('status icon differs by label so colour is not the only cue (I2)', () => {
  assert.notEqual(statusIcon('Bettable'), statusIcon('Not bettable'));
  assert.ok(statusIcon('Bettable'));
});

test('mode off keeps every flagged row (I4)', () => {
  const rows = [{flags: []}, {flags: ['fragile']}, {flags: ['in_play', 'longshot']}];
  assert.equal(filterBettable(rows, false).shown.length, 3);
});

test('Change these rules opens Model settings at the Bettable mode fieldset (I5)', () => {
  assert.equal(RULES_BUTTON, 'Change these rules');
  assert.equal(RULES_FIELDSET_ID, 'bettable-mode');
  const target = requestRules();
  assert.equal(target.panel, 'model');
  assert.equal(target.scrollTo, RULES_FIELDSET_ID);
  assert.equal(takePanel(), 'model');
});
