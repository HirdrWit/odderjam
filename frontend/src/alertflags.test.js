import assert from 'node:assert/strict';
import {test} from 'node:test';

import {alertFlagBadges, BETTABLE_HELP, BLANK_RULE_FIELDS} from './alerts.js';

test('new rules default to Bettable only on', () => {
  assert.equal(BLANK_RULE_FIELDS.bettable, true);
});

test('help text is plain English', () => {
  assert.match(BETTABLE_HELP, /in-play|longshot|stale/i);
});

test('alertFlagBadges lists the flags of an alert, none when clean', () => {
  assert.deepEqual(alertFlagBadges({data: {flags: ['in_play', 'longshot']}}), ['In-play', 'Longshot']);
  assert.deepEqual(alertFlagBadges({data: {}}), []);
  assert.deepEqual(alertFlagBadges({}), []);
});
