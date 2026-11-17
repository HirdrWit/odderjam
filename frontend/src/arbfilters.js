/**
 * @fileoverview Arbitrage filter bar: defaults, chips, staking note and table
 * columns (no React), tested in barfilters.test.js.
 */

/** @const {{min: number, props: string, total: (number|string)}} */
export const ARB_DEFAULTS = {min: 0, props: 'include', total: ''};

/** @return {!Object} A fresh copy of the default filters. */
export function arbReset() {
  return {...ARB_DEFAULTS};
}

const CHIP_LABELS = {
  min: (v) => `Min profit: ${v}%`,
  props: (v) => (v === 'mainlines' ? 'Game lines only' : 'Game lines and props'),
  total: (v) => `Total: $${v}`,
};

/**
 * @param {!Object} filters Current filters.
 * @return {!Array<{key: string, label: string}>} One chip per non-default filter.
 */
export function arbChips(filters) {
  return Object.keys(ARB_DEFAULTS)
      .filter((key) => filters[key] !== ARB_DEFAULTS[key])
      .map((key) => ({key, label: CHIP_LABELS[key](filters[key])}));
}

/**
 * @param {{round: number, max: (number|string)}} s Shared staking settings.
 * @return {string} Read-only note of the rounding and cap Arbitrage uses.
 */
export function arbStakingNote({round, max}) {
  const rounding = round ? `Round to $${round}` : 'Round to cents';
  const cap = Number(max) > 0 ? `max $${max} per side` : 'no cap per side';
  return `${rounding} · ${cap}`;
}

/**
 * @param {?{current: number}} bank Bankroll from the server.
 * @return {string} Placeholder for the total box: the bankroll it defaults to.
 */
export function arbTotalPlaceholder(bank) {
  return bank ? bank.current.toFixed(0) : 'bankroll';
}

/** @const {!Array<!Array>} Sortable columns: id, label, default direction. */
export const ARB_COLUMNS = [
  ['profit', 'Profit %', 'desc'], ['event', 'Event'], ['stake', 'Total stake', 'desc'],
];

/** @const {!Object<string, function(!Object): *>} */
export const ARB_SORT = {profit: (r) => r.profit_pct, event: (r) => r.event, stake: (r) => r.total_stake};
