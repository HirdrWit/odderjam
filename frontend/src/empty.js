/**
 * @fileoverview Empty-state messages for list tabs (no React), tested in
 * empty.test.js.
 */

/**
 * @param {*} data The API response.
 * @param {number} min Min profit %.
 * @return {?string}
 */
export function arbsEmptyText(data, min) {
  return null;
}

/**
 * @param {*} data The API response.
 * @param {number} maxHold Max hold %.
 * @return {?string}
 */
export function lowHoldEmptyText(data, maxHold) {
  return null;
}

/**
 * @param {*} data The API response.
 * @param {number} k Spike multiple.
 * @param {number} windowMin Window in minutes.
 * @return {?string}
 */
export function sharpEmptyText(data, k, windowMin) {
  return null;
}
