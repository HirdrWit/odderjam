/**
 * @fileoverview Bettable mode thresholds for the Model settings panel (no React),
 * tested in thresholds.test.js.
 */

/** @const {!Object} Defaults; they match backend/engine/bettable.py DEFAULT_PROFILE. */
export const BETTABLE_DEFAULTS = {
  oddsMin: -250, oddsMax: 250, evCeiling: 8, propEvCeiling: 12, maxSkewSeconds: 20, maxSharpSpread: 3,
  requireConservative: true,
};

/** @const {!Array<{key: string, label: string, help: string, step: number}>} */
export const BETTABLE_FIELDS = [
  {key: 'oddsMin', label: 'Lowest odds', step: 10,
    help: 'Bets priced below this (a heavy favourite, such as -300) are flagged. Default: -250.'},
  {key: 'oddsMax', label: 'Highest odds', step: 10,
    help: 'Bets priced above this (a longshot, such as +400) are flagged. Default: +250.'},
  {key: 'evCeiling', label: 'Max EV, game lines (%)', step: 0.5,
    help: 'Game-line edges above this are flagged as too good to be true. Default: 8.'},
  {key: 'propEvCeiling', label: 'Max EV, props (%)', step: 0.5,
    help: 'Player-prop edges above this are flagged as too good to be true. Default: 12.'},
  {key: 'maxSkewSeconds', label: 'Max price gap, in-play (s)', step: 1,
    help: 'A live game is only trusted when the book and sharp prices updated this close together. Default: 20.'},
  {key: 'maxSharpSpread', label: 'Max sharp disagreement (pts)', step: 0.5,
    help: 'When two sharp books differ by more than this many percentage points, the fair price is flagged. Default: 3.'},
  {key: 'requireConservative', label: 'Require conservative devig', step: 0,
    help: 'Flag a bet whose edge disappears under the cautious Worst case devig. Default: on.'},
];

const NUMERIC = BETTABLE_FIELDS.filter((f) => f.key !== 'requireConservative').map((f) => f.key);

/** @return {!Object} A fresh copy of the defaults. */
export function bettableReset() {
  return {...BETTABLE_DEFAULTS};
}

/**
 * @param {*} v A field value (number or typed text).
 * @return {number} The number, or NaN when blank or not numeric.
 */
function toNumber(v) {
  if (typeof v === 'string' && v.trim() === '') return NaN;
  return typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
}

/**
 * @param {!Object} values Field values, numbers or typed text.
 * @return {!Object<string, string>} Inline error text per invalid field; empty when all are valid.
 */
export function validateBettable(values) {
  const errors = {};
  for (const key of NUMERIC) {
    const n = toNumber(values[key]);
    if (!Number.isFinite(n)) errors[key] = 'Enter a number';
    else if (key !== 'oddsMin' && key !== 'oddsMax' && n < 0) errors[key] = 'Must be 0 or more';
  }
  if (!errors.oddsMin && !errors.oddsMax && toNumber(values.oddsMin) > toNumber(values.oddsMax)) {
    errors.oddsMin = 'Lowest odds must not be above highest odds';
  }
  return errors;
}

/**
 * The query-string part (starting with "&") that carries the thresholds to /api/ev.
 * Invalid values are never sent: the last valid ones (or the defaults) go instead.
 * @param {!Object} values Current field values.
 * @param {!Object=} lastValid Values to send when `values` are invalid.
 * @return {string} The params.
 */
export function bettableQuery(values, lastValid = BETTABLE_DEFAULTS) {
  const v = Object.keys(validateBettable(values)).length ? lastValid : values;
  const n = (key) => toNumber(v[key]);
  return `&bettable_odds_min=${n('oddsMin')}&bettable_odds_max=${n('oddsMax')}` +
      `&ev_ceiling=${n('evCeiling')}&prop_ev_ceiling=${n('propEvCeiling')}` +
      `&max_skew_seconds=${n('maxSkewSeconds')}&max_sharp_spread=${Number((n('maxSharpSpread') / 100).toFixed(6))}` +
      `&require_conservative=${v.requireConservative !== false}`;
}
