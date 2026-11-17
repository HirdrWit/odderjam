/**
 * @fileoverview Pure helpers for sortable tables (no React), tested in
 * sorttable.test.js. Used by the +EV, Arbitrage, Middles, Low Hold and Tracker tabs.
 */

const ODDS_STRING = /^[+-]\d{3,}$/;

/**
 * Converts American odds to the decimal price, so +236 sorts above -220.
 * @param {number} american
 * @return {number}
 */
export function oddsKey(american) {
  return american > 0 ? 1 + american / 100 : 1 - 100 / american;
}

/**
 * Turns a cell value into something comparable: a number, a lower-case string,
 * or null for an empty value.
 * @param {*} value
 * @return {(number|string|null)}
 */
function sortKey(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  const text = String(value).trim();
  if (text === '' || text === '—') return null;
  if (ODDS_STRING.test(text)) return oddsKey(Number(text));
  const number = Number(text.replace(/[%$,]/g, ''));
  return Number.isNaN(number) ? text.toLowerCase() : number;
}

/**
 * Compares two cell values. Empty values always sort last, whatever `dir`.
 * @param {*} a
 * @param {*} b
 * @param {string} dir 'asc' or 'desc'.
 * @return {number}
 */
export function compareValues(a, b, dir) {
  const x = sortKey(a);
  const y = sortKey(b);
  if (x === null || y === null) return x === y ? 0 : (x === null ? 1 : -1);
  let order;
  if (typeof x === typeof y) order = x < y ? -1 : (x > y ? 1 : 0);
  else order = typeof x === 'number' ? -1 : 1;
  return dir === 'desc' ? -order : order;
}

/**
 * Returns a sorted copy of `rows`. The sort is stable.
 * @param {!Array} rows
 * @param {function(*): *} accessor Reads the cell value from a row.
 * @param {string} dir 'asc' or 'desc'.
 * @return {!Array}
 */
export function sortRows(rows, accessor, dir) {
  return rows
      .map((row, i) => ({row, i, value: accessor(row)}))
      .sort((p, q) => compareValues(p.value, q.value, dir) || p.i - q.i)
      .map((p) => p.row);
}

/**
 * The sort after a click on column `key`: the active column reverses, a new one
 * starts in `defaultDir`.
 * @param {{key: string, dir: string}} current
 * @param {string} key
 * @param {string=} defaultDir
 * @return {{key: string, dir: string}}
 */
export function nextSort(current, key, defaultDir = 'asc') {
  if (current.key === key) return {key, dir: current.dir === 'asc' ? 'desc' : 'asc'};
  return {key, dir: defaultDir};
}

/** @return {string} The `aria-sort` value for column `key`. */
export function ariaSort(sort, key) {
  if (sort.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

/** @return {string} ▲, ▼ or '' for column `key`. */
export function arrow(sort, key) {
  if (sort.key !== key) return '';
  return sort.dir === 'asc' ? '▲' : '▼';
}

const storageKey = (tab) => `sort:${tab}`;

/**
 * Reads the saved sort for `tab`, or `fallback` when nothing valid is saved.
 * @param {{getItem: function(string): ?string}} storage
 * @param {string} tab
 * @param {{key: string, dir: string}} fallback
 * @return {{key: string, dir: string}}
 */
export function loadSort(storage, tab, fallback) {
  try {
    const saved = JSON.parse(storage.getItem(storageKey(tab)));
    if (saved && typeof saved.key === 'string' && (saved.dir === 'asc' || saved.dir === 'desc')) {
      return {key: saved.key, dir: saved.dir};
    }
  } catch {
    // Storage unavailable or invalid JSON; use the default.
  }
  return fallback;
}

/** Saves the sort for `tab`; storage errors are ignored. */
export function saveSort(storage, tab, sort) {
  try {
    storage.setItem(storageKey(tab), JSON.stringify(sort));
  } catch {
    // Storage full or disabled; the sort still applies for this session.
  }
}
