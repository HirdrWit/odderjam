import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {navTabs} from './navgroups.js';
import {
  SETTINGS_LABEL, settingsReachable, SETTINGS_LINKS, requestPanel, takePanel,
} from './settings.js';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

test('Settings is reachable from every tab', () => {
  assert.equal(SETTINGS_LABEL, 'Settings');
  for (const tab of [...navTabs(), 'Tracker', 'Calculator', 'Pick\'em', 'Alerts', 'Help']) {
    assert.equal(settingsReachable(tab), true, tab);
  }
});

test('settings links go to Bankroll & staking and Model settings', () => {
  assert.deepEqual(SETTINGS_LINKS.map((l) => l.label), ['Bankroll & staking', 'Model settings']);
  assert.deepEqual(SETTINGS_LINKS.map((l) => l.panel), ['staking', 'model']);
});

test('a requested panel is handed over once', () => {
  requestPanel('staking');
  assert.equal(takePanel(), 'staking');
  assert.equal(takePanel(), null);
});

const rule = (sel) => {
  const m = css.match(new RegExp(`(?:^|[}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `no rule for ${sel}`);
  return m[1];
};

test('dialog text uses the type scale, not raw pixel sizes', () => {
  for (const sel of ['.settings-dialog', '.settings-dialog label']) {
    const body = (() => { try { return rule(sel); } catch { return ''; } })();
    assert.ok(!/font-size\s*:\s*\d+px/.test(body), sel);
  }
  assert.match(rule('.settings-dialog'), /background\s*:\s*var\(--surface-[12]\)/);
  assert.match(rule('.settings-dialog'), /color\s*:\s*var\(--text\)/);
});
