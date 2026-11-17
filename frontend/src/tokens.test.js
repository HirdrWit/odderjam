import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const rootMatch = css.match(/(?:^|\n):root\s*\{([^}]*)\}/);
const rootBlock = rootMatch ? rootMatch[1] : '';
const rest = css.replace(rootMatch ? rootMatch[0] : '', '');

const tokens = {};
for (const m of rootBlock.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();

const lum = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(tokens[a]), lum(tokens[b])].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('required color tokens exist on :root', () => {
  for (const t of ['bg', 'surface-1', 'surface-2', 'surface-3', 'border', 'text', 'text-muted',
    'accent', 'positive', 'negative', 'warning']) {
    assert.ok(tokens[t], `missing --${t}`);
  }
});

test('no raw hex outside the :root token block', () => {
  const hits = rest.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hits, []);
});

test('type and spacing scales are defined', () => {
  for (const t of ['fs-1', 'fs-2', 'fs-3', 'fs-4', 'sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5']) {
    assert.ok(tokens[t], `missing --${t}`);
  }
  assert.equal(tokens['fs-1'], '12px');
});

test('no font-size below 12px except badges', () => {
  const bad = [];
  for (const m of rest.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const fs = m[2].match(/font(?:-size)?\s*:\s*(?:[^;]*?\s)?(\d+(?:\.\d+)?)px/);
    if (fs && Number(fs[1]) < 12 && !/badge|tag-example/.test(m[1])) bad.push(m[1].trim());
  }
  assert.deepEqual(bad, []);
  for (const m of rest.matchAll(/font-size\s*:\s*([\d.]+)em/g)) assert.ok(Number(m[1]) >= 1, m[0]);
});

// Text/background pairs: every one must reach 4.5:1 (WCAG 1.4.3).
const surfaces = ['bg', 'surface-1', 'surface-2', 'surface-3'];
const textPairs = [];
for (const s of surfaces) {
  for (const f of ['text', 'text-muted']) textPairs.push([f, s]);
}
for (const s of ['bg', 'surface-1', 'surface-2']) {
  for (const f of ['positive', 'negative', 'warning']) textPairs.push([f, s]);
}
textPairs.push(['on-accent', 'accent-fill'], ['on-accent', 'danger'], ['on-accent', 'info'],
  ['on-accent', 'caution'], ['on-accent', 'neutral'], ['bg', 'positive']);
for (const [f, b] of textPairs) {
  test(`text --${f} on --${b} is at least 4.5:1`, () => {
    assert.ok(ratio(f, b) >= 4.5, `${f} on ${b} = ${ratio(f, b).toFixed(2)}`);
  });
}

// Borders and controls: 3:1 against the surfaces they sit on (WCAG 1.4.11).
for (const s of surfaces) {
  test(`--border on --${s} is at least 3:1`, () => {
    assert.ok(ratio('border', s) >= 3, `${ratio('border', s).toFixed(2)}`);
  });
}
for (const s of surfaces) {
  test(`--accent on --${s} is at least 3:1`, () => {
    assert.ok(ratio('accent', s) >= 3, `${ratio('accent', s).toFixed(2)}`);
  });
}

test('surfaces are visibly distinct steps', () => {
  const order = surfaces.map((s) => lum(tokens[s]));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
});

test('buttons use the accent, not green or red', () => {
  const rule = (sel) => (rest.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`)) || [, ''])[1];
  assert.doesNotMatch(rule('a\\.bet'), /positive|negative/);
  assert.doesNotMatch(rule('button\\.track\\.on'), /positive/);
});
