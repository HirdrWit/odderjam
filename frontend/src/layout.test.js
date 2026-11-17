import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const rule = (sel) => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

test('main has no fixed max-width so tabs fill the window', () => {
  assert.doesNotMatch(rule('main'), /max-width/);
});

test('main can shrink inside the flex row so narrow windows do not scroll the page', () => {
  assert.match(rule('main'), /min-width:\s*0/);
});

test('Help sections keep their own readable line length', () => {
  assert.match(css, /\.help section\s*\{[^}]*max-width:\s*70ch/);
});
