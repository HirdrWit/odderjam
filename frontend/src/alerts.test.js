import assert from 'node:assert/strict';
import {test} from 'node:test';

import {ruleFormError} from './alerts.js';

const VALID_RULE = {name: '', kind: 'ev', min_value: '2', book: '', market: '', sport: ''};

test('ruleFormError accepts zero and positive Min %', () => {
  for (const value of ['0', '2', '0.5', '150', 0, 3]) {
    assert.equal(ruleFormError({...VALID_RULE, min_value: value}), null, `min_value ${JSON.stringify(value)}`);
  }
});

test('ruleFormError rejects a negative Min %', () => {
  for (const value of ['-5', '-0.5', -500]) {
    assert.match(ruleFormError({...VALID_RULE, min_value: value}) ?? '', /min %/i, `min_value ${value}`);
  }
});

test('ruleFormError rejects a blank or non-numeric Min %', () => {
  for (const value of ['', '  ', 'abc', 'Infinity', '1e999']) {
    assert.match(ruleFormError({...VALID_RULE, min_value: value}) ?? '', /min %/i,
        `min_value ${JSON.stringify(value)}`);
  }
});
