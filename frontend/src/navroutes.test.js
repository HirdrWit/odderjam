import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {navTabs, MOBILE_TABS, moreTabs} from './navgroups.js';

const main = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const help = readFileSync(new URL('./Help.jsx', import.meta.url), 'utf8');

test('Glossary is merged into Help', () => {
  assert.ok(!navTabs().includes('Glossary'));
  assert.ok(!/'Glossary':\s*Glossary/.test(main));
  assert.ok(help.includes('Glossary'));
});

test('mobile bar has four key tabs plus More, More lists the rest', () => {
  assert.deepEqual(MOBILE_TABS, ['Odds Screen', '+EV', 'Arbitrage', 'Tracker']);
  assert.deepEqual([...MOBILE_TABS, ...moreTabs()].sort(), [...navTabs()].sort());
});

test('sidebar subtitle shows only for the active item', () => {
  assert.match(css, /nav button \.sub\s*\{[^}]*display:\s*none/);
  assert.match(css, /nav button\.on \.sub\s*\{[^}]*display:\s*block/);
});

test('mobile nav is one fixed non-wrapping row', () => {
  const m = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)[0];
  assert.match(m, /position:\s*fixed/);
  assert.match(m, /bottom:\s*0/);
  assert.doesNotMatch(m, /flex-wrap:\s*wrap/);
});

test('app wires hash routes to history', () => {
  assert.match(main, /hashchange/);
  assert.match(main, /parseHash/);
  assert.match(main, /buildHash/);
});
