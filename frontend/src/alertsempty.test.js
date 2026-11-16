import assert from 'node:assert/strict';
import {test} from 'node:test';

import {alertsEmptyText} from './empty.js';

test('alertsEmptyText says no alerts yet and points at the rule form', () => {
  assert.equal(alertsEmptyText({items: []}), 'No alerts yet. Add a rule above.');
});

test('alertsEmptyText is null while loading, on error, and with rows', () => {
  assert.equal(alertsEmptyText(null), null);
  assert.equal(alertsEmptyText(undefined), null);
  assert.equal(alertsEmptyText({detail: 'x'}), null);
  assert.equal(alertsEmptyText({items: [{id: 1}]}), null);
});
