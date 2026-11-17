/**
 * @fileoverview Sharp Money filter bar: defaults, field labels, chips and the
 * one-line hint (no React), tested in barfilters.test.js.
 */

/** @const {{windowMin: number, baselineMin: number, k: number, minVolume: number}} */
export const SHARP_DEFAULTS = {windowMin: 10, baselineMin: 120, k: 3, minVolume: 500};

/** @const {!Array<{key: string, label: string, step: number, min: number}>} */
export const SHARP_FIELDS = [
  {key: 'windowMin', label: 'Spike window (min)', step: 1, min: 1},
  {key: 'baselineMin', label: 'Prior period (min)', step: 10, min: 1},
  {key: 'k', label: 'Times usual rate', step: 0.5, min: 0.5},
  {key: 'minVolume', label: 'Min contracts', step: 100, min: 0},
];

/** @return {!Object} A fresh copy of the default filters. */
export function sharpReset() {
  return {...SHARP_DEFAULTS};
}

const CHIP_LABELS = {
  windowMin: (v) => `Window: ${v} min`,
  baselineMin: (v) => `Prior: ${v} min`,
  k: (v) => `Rate: ${v}×`,
  minVolume: (v) => `Min contracts: ${v}`,
};

/**
 * @param {!Object} filters Current filters.
 * @return {!Array<{key: string, label: string}>} One chip per non-default filter.
 */
export function sharpChips(filters) {
  return Object.keys(SHARP_DEFAULTS)
      .filter((key) => filters[key] !== SHARP_DEFAULTS[key])
      .map((key) => ({key, label: CHIP_LABELS[key](filters[key])}));
}

/**
 * The backend keeps spikes strictly above k times the baseline rate and with
 * at least min_volume contracts, so the hint says exactly that.
 * @param {!Object} f Current filters.
 * @return {string} One line describing what the four fields mean together.
 */
export function sharpHint({windowMin, baselineMin, k, minVolume}) {
  return `Spikes in the last ${windowMin} min vs the prior ${baselineMin} min: more than ${k} times the usual rate, ` +
      `at least ${minVolume} contracts.`;
}
