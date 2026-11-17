import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {alertsRulesEmptyText, trackerEmptyText} from './empty.js';
import {findEntry} from './glossary.js';

const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('alerts rules empty text is shared empty state, only for a loaded empty list', () => {
  assert.equal(alertsRulesEmptyText([]), 'No rules yet. Add one above.');
  for (const d of [null, undefined, {detail: 'x'}, [{id: 1}]]) {
    assert.equal(alertsRulesEmptyText(d), null);
  }
});

test('alerts rules table is wrapped in TableShell', () => {
  assert.match(src('./main.jsx'), /<TableShell data=\{rules\} emptyText=\{alertsRulesEmptyText\(rules\)\}/);
});

test('no env var name in user-facing Discord copy', () => {
  assert.doesNotMatch(src('./main.jsx'), /set DISCORD_WEBHOOK_URL/);
  const e = findEntry('discord-webhook');
  assert.doesNotMatch(e.definition + e.example, /DISCORD_WEBHOOK_URL|\.env/);
});

test('tracker empty text points at the Add bet button', () => {
  assert.equal(trackerEmptyText([]),
      'No bets yet. Click Add bet, or Track on any +EV or Arbitrage row.');
});

test('help links use the accent token', () => {
  assert.match(src('./style.css'), /\.help a(:visited)?[^{]*\{[^}]*color:\s*var\(--accent\)/);
});
