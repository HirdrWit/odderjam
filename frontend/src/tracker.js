/**
 * @fileoverview Pure helpers for the Tracker charts (no React, so they run
 * under node --test).
 */

// Diverging P/L scale: blue = profit, red = loss, gray midpoint. Validated
// for colour vision deficiency on the dark surface.

/** Colour of the largest daily profit. */
export const PROFIT = '#3b82f6';

/** Colour of the largest daily loss. */
export const LOSS = '#e5534b';

/** Colour of a day with no profit or loss. */
export const NEUTRAL = '#383835';

/** Parses '#rrggbb' into [r, g, b]. */
function toRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** Formats [r, g, b] as '#rrggbb'. */
function toHex(rgb) {
  return `#${rgb.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Returns the cell colour for a day's profit, scaled against the largest
 * absolute daily P/L.
 * @param {number} profit
 * @param {number} maxAbs
 * @return {string}
 */
export function plColor(profit, maxAbs) {
  if (!profit || !maxAbs) return NEUTRAL;
  // Never fade all the way to gray.
  const t = 0.3 + 0.7 * Math.min(1, Math.abs(profit) / maxAbs);
  const from = toRgb(NEUTRAL);
  const to = toRgb(profit > 0 ? PROFIT : LOSS);
  return toHex(from.map((x, i) => x + (to[i] - x) * t));
}

/** Formats a date as 'YYYY-MM-DD' (month is 0-based). */
function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Returns the weeks (Sun..Sat) of a month, each cell `{date, day}` or null
 * for padding.
 * @param {number} year
 * @param {number} month 0-based month.
 * @return {!Array<!Array<?{date: string, day: number}>>}
 */
export function calendarWeeks(year, month) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthDays = Array.from(
      {length: days}, (_, i) => ({date: isoDate(year, month, i + 1), day: i + 1}));
  const cells = [...Array(first).fill(null), ...monthDays];
  while (cells.length % 7) cells.push(null);
  return Array.from({length: cells.length / 7}, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/**
 * Scales daily rows `[{date, cumulative}]` to SVG points inside a `w` x `h`
 * box (with `pad`). The range always includes the 0 line.
 * @param {!Array<{cumulative: number}>} rows
 * @param {number} w
 * @param {number} h
 * @param {number=} pad
 * @return {{points: !Array<!Array<number>>, zeroY: number, lo: number,
 *     hi: number}}
 */
export function scaleSeries(rows, w, h, pad = 4) {
  const ys = [0, ...rows.map((r) => r.cumulative)];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i) => pad +
      (rows.length < 2 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (rows.length - 1));
  const y = (v) => pad + ((hi - v) * (h - 2 * pad)) / span;
  return {points: rows.map((r, i) => [x(i), y(r.cumulative)]), zeroY: y(0), lo, hi};
}

/**
 * Returns the query string for the tracker filters, dropping empty values.
 * @param {!Object<string, ?string>} filters
 * @return {string}
 */
export function filterQuery(filters) {
  return new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
}

/**
 * Returns why the Add-bet form cannot be submitted, or null when it is valid.
 * @param {{pick: string, odds: string, stake: string, closing_odds: ?string}} form
 * @return {?string}
 */
export function betFormError(form) {
  if (!String(form.pick ?? '').trim()) return 'Pick is required';
  if (!isAmericanOdds(form.odds)) return 'Odds must be +100 or more, or -100 or less';
  const stake = toNumber(form.stake);
  if (!(Number.isFinite(stake) && stake > 0)) return 'Stake must be more than 0';
  const closing = form.closing_odds;
  if (closing != null && String(closing).trim() !== '' && !isAmericanOdds(closing)) {
    return 'Closing odds must be +100 or more, or -100 or less';
  }
  return null;
}

/** Parses a form value as a number; blank is NaN, not 0. */
function toNumber(value) {
  return value == null || String(value).trim() === '' ? NaN : Number(value);
}

/** True for a finite American price: +100 or more, or -100 or less. */
function isAmericanOdds(value) {
  const odds = toNumber(value);
  return Number.isFinite(odds) && Math.abs(odds) >= 100;
}

/**
 * Returns the badge classes for a bet status.
 * @param {string} status
 * @return {string}
 */
export function statusClass(status) {
  return `badge ${status}`;
}

/**
 * Text for an average-CLV tile: the value, or why there is none.
 * @param {?number} value
 * @param {string} kind 'clv' or 'sharp'.
 * @return {string}
 */
export function clvTileText(value, kind) {
  if (value != null) return `${value.toFixed(1)}%`;
  return kind === 'sharp' ? 'Needs a sharp-book closing line' : 'Enter closing odds to see CLV';
}

/**
 * @param {!Array<*>} daily Daily rows.
 * @return {boolean} True when there are enough points to draw a line.
 */
export function chartReady(daily) {
  return daily.length >= 2;
}

/**
 * @param {!Array<*>} daily Daily rows.
 * @return {?string} A note shown in place of the chart, or null when it can be drawn.
 */
export function chartNote(daily) {
  return chartReady(daily) ? null : 'The profit chart appears once bets are settled on 2 days.';
}

/**
 * Returns the [year, 0-based month] the calendar should open on.
 * @param {!Array<{date: string}>} daily Daily rows in date order.
 * @param {string} today 'YYYY-MM-DD' fallback when there are no rows.
 * @return {!Array<number>}
 */
export function latestMonth(daily, today) {
  const date = daily.length ? daily[daily.length - 1].date : today;
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1];
}
