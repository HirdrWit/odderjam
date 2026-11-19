/**
 * @fileoverview Shared display formatters (percent, money, odds, event time)
 * used by every table. Signs are always written out so the meaning never
 * depends on color alone. Tested in fmt.test.js.
 */

const MINUS = '−';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const missing = (v) => v == null || !Number.isFinite(v);

/** @return {string} The sign prefix for a value: true minus, optional plus. */
function sign(value, signed) {
  if (value < 0) return MINUS;
  return signed && value > 0 ? '+' : '';
}

/**
 * @param {?number} value Percent points (3.5 means 3.5%).
 * @param {{digits: (number|undefined), signed: (boolean|undefined)}=} opts
 */
export function percent(value, {digits = 1, signed = false} = {}) {
  if (missing(value)) return '—';
  const text = Math.abs(value).toFixed(digits);
  const zero = Number(text) === 0;
  return `${zero ? '' : sign(value, signed)}${text}%`;
}

/** @param {?number} value Dollars. */
export function money(value, {signed = false} = {}) {
  if (missing(value)) return '—';
  const text = Math.abs(value).toFixed(2);
  const zero = Number(text) === 0;
  return `${zero ? '' : sign(value, signed)}$${text}`;
}

/** @param {?number} american An American price. */
export function odds(american) {
  if (missing(american)) return '—';
  const rounded = Math.round(american);
  return `${sign(rounded, true)}${Math.abs(rounded)}`;
}

/** @return {string} CSS class: 'best' for positive, 'bad' for negative. */
export function signClass(value) {
  if (missing(value)) return '';
  if (value > 0) return 'best';
  return value < 0 ? 'bad' : '';
}

const time12 = (d) => {
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Event time: `Today 7:42 PM`, `Tue 7:40 PM` (next 5 days) or `Nov 22, 1:00 PM`.
 * @param {(Date|string|number|null)} when
 * @param {!Date=} now
 */
export function eventTime(when, now = new Date()) {
  if (when == null) return '—';
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return '—';
  const days = Math.round((dayStart(d) - dayStart(now)) / 86400000);
  if (days === 0) return `Today ${time12(d)}`;
  if (days >= 1 && days <= 5) return `${DAYS[d.getDay()]} ${time12(d)}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time12(d)}`;
}

/** @param {?number} prob A probability from 0 to 1. @return {string} e.g. '24.6%', or '—'. */
export function probPercent(prob) {
  if (typeof prob !== 'number' || !Number.isFinite(prob) || prob <= 0 || prob > 1) return '—';
  return `${(prob * 100).toFixed(1)}%`;
}

/** @param {?number} american An American price. @return {string} Implied chance, e.g. '52.4%', or '—'. */
export function impliedPercent(american) {
  if (typeof american !== 'number' || !Number.isFinite(american) || Math.abs(american) < 100) return '—';
  return probPercent(american < 0 ? -american / (-american + 100) : 100 / (american + 100));
}
