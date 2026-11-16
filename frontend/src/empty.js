/**
 * @fileoverview Empty-state messages for list tabs (no React), tested in
 * empty.test.js. Each helper returns text only once the API has answered
 * with an empty list: null while loading (`null`), on an error body
 * (`{detail}`, shown by ApiError) and when there are rows.
 */

/**
 * @param {*} data The API response.
 * @return {boolean} True when data is a loaded, empty list.
 */
function isEmptyList(data) {
  return Array.isArray(data) && data.length === 0;
}

/**
 * @param {*} data The /api/arbs response.
 * @param {number} min Min profit %.
 * @return {?string}
 */
export function arbsEmptyText(data, min) {
  if (!isEmptyList(data)) return null;
  return `No arbs at >= ${min}% right now. Lower Min profit % or refresh odds.`;
}

/**
 * @param {*} data The /api/lowhold response.
 * @param {number} maxHold Max hold %.
 * @return {?string}
 */
export function lowHoldEmptyText(data, maxHold) {
  if (!isEmptyList(data)) return null;
  return `No markets with hold <= ${maxHold}% right now. Raise Max hold %, widen the book or market ` +
      'filter, or refresh odds.';
}

/**
 * @param {*} data The /api/sharp-money response.
 * @param {number} k Spike multiple.
 * @param {number} windowMin Window in minutes.
 * @return {?string}
 */
export function sharpEmptyText(data, k, windowMin) {
  if (!isEmptyList(data)) return null;
  return `No exchange volume spike above ${k}× the usual rate in the last ${windowMin} min. ` +
      'Lower Spike × or Min contracts, or check back later.';
}

/**
 * @param {*} data The /api/ev response.
 * @param {number} minEv Min EV %.
 * @return {?string}
 */
export function evEmptyText(data, minEv) {
  if (!isEmptyList(data)) return null;
  return `No bets with an edge of ${minEv}% or more right now. Lower Min EV %, pick All books, or refresh odds.`;
}

/**
 * @param {*} data The /api/middles response.
 * @param {number} minWindow Min window.
 * @param {(number|string)} maxCost Max cost %, '' for any.
 * @return {?string}
 */
export function middlesEmptyText(data, minWindow, maxCost) {
  if (!isEmptyList(data)) return null;
  const cost = maxCost === '' ? '' : ` and cost at most ${maxCost}%`;
  return `No middles (two bets that can both win) with a window of at least ${minWindow}${cost} right now. ` +
      'Lower Min window, raise Max cost %, or refresh odds.';
}

/**
 * @param {*} data The unfiltered /api/bets response.
 * @return {?string}
 */
export function trackerEmptyText(data) {
  if (!isEmptyList(data)) return null;
  return 'No bets yet. Add one below, or click Track on any +EV or Arbitrage row.';
}

/**
 * @param {*} feed The /api/alerts response.
 * @return {?string}
 */
export function alertsEmptyText(feed) {
  if (!feed || !Array.isArray(feed.items) || feed.items.length > 0) return null;
  return 'No alerts yet. Add a rule above.';
}
