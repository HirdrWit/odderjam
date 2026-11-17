/**
 * @fileoverview Pure helpers for the phone filter toggle (no React), tested in cards.test.js.
 */

/**
 * @param {!Object} filters Current filter values.
 * @param {!Object} defaults The value each filter has when inactive.
 * @return {number} How many filters differ from their default.
 */
export function filterCount(filters, defaults) {
  return Object.keys(defaults).filter((key) => filters[key] !== defaults[key]).length;
}

/**
 * @param {number} count
 * @return {string} Label for the Filters button.
 */
export function filtersLabel(count) {
  return count > 0 ? `Filters (${count})` : 'Filters';
}
