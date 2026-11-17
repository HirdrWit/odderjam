import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';

import {failedText} from './tablestate.js';

test('failedText: names what failed only when there is an error and no data to show', () => {
  assert.equal(failedText({data: null, error: 'Server error (500)', what: 'bankroll'}),
      "Couldn't load bankroll. Server error (500)");
  assert.equal(failedText({data: null, error: null, what: 'bankroll'}), null);
  assert.equal(failedText({data: {a: 1}, error: 'x', what: 'bankroll'}), null);
});

test('every plain useApi( call site is commented as harmless; the rest use useApiStatus', () => {
  const dir = new URL('.', import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((n) => /\.jsx?$/.test(n) && !n.startsWith('hooks') && !n.endsWith('.test.js'))) {
    const lines = readFileSync(dir + f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\buseApi\(/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      assert.match(lines[i - 1] || '', /\/\/ No error state:/, `${f}:${i + 1} useApi( needs a "// No error state: <why>" comment`);
    });
  }
});

test('failing loads render a Retry via failedText', () => {
  const dir = new URL('.', import.meta.url).pathname;
  assert.match(readFileSync(dir + 'OddsScreen.jsx', 'utf8'), /failedText\(/);
  assert.match(readFileSync(dir + 'Tracker.jsx', 'utf8'), /failedText\(/);
  assert.match(readFileSync(dir + 'main.jsx', 'utf8'), /failedText\(/);
});
