/**
 * @fileoverview Everyday +EV filters: defaults, removable chips and reset (no
 * React), tested in evfilters.test.js.
 */

/** @const {{book: string, minEv: number, sport: string, props: string}} */
export const DEFAULT_FILTERS = {book: 'DraftKings', minEv: 1, sport: '', props: 'include'};

/** @return {!Object} A fresh copy of the default filters. */
export function resetFilters() {
  return {...DEFAULT_FILTERS};
}

/**
 * @param {!Object} filters Current filters.
 * @param {string} key Filter to put back to its default.
 * @return {!Object} New filters.
 */
export function clearFilter(filters, key) {
  return {...filters, [key]: DEFAULT_FILTERS[key]};
}

const CHIP_LABELS = {
  book: (v) => `Book: ${v || 'All books'}`,
  minEv: (v) => `Min EV: ${v}%`,
  sport: (v) => `Sport: ${v}`,
  props: (v) => (v === 'mainlines' ? 'Game lines only' : 'Game lines and props'),
};

/**
 * @param {!Object} filters Current filters.
 * @return {!Array<{key: string, label: string}>} One chip per non-default filter.
 */
export function activeChips(filters) {
  return Object.keys(DEFAULT_FILTERS)
      .filter((key) => filters[key] !== DEFAULT_FILTERS[key])
      .map((key) => ({key, label: CHIP_LABELS[key](filters[key])}));
}

/**
 * @param {string} sport Sport code, or '' for any.
 * @return {string} Query fragment for /api/ev.
 */
export function sportsParam(sport) {
  return sport ? `&sports=${encodeURIComponent(sport)}` : '';
}
