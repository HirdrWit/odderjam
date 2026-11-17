import assert from 'node:assert/strict';
import {test} from 'node:test';

import {HELP_SECTIONS} from './help.js';

test('exchange-setup section is the one place that names the EXCHANGES setting', () => {
  const s = HELP_SECTIONS.find((x) => x.id === 'exchange-setup');
  assert.ok(s, 'missing exchange-setup');
  const t = [s.title, ...(s.paragraphs || []), ...(s.steps || [])].join(' ');
  assert.match(t, /EXCHANGES=Kalshi/);
  assert.match(t, /\.env/);
  assert.match(t, /restart/i);
});
