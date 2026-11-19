/**
 * @fileoverview "Must bet" badge, toggle and thresholds for +EV rows (no React), tested in mustbet.test.js.
 */

/** @const {!Object} Defaults; they match backend/engine/bettable.py DEFAULT_PROFILE (must_bet_*). */
export const MUSTBET_DEFAULTS = {minEv: 2, oddsMin: -200, oddsMax: 200, maxHold: 5};

/** @const {!Array<{key: string, label: string, help: string, step: number}>} */
export const MUSTBET_FIELDS = [
  {key: 'minEv', label: 'Min worst-case EV (%)', step: 0.5,
    help: 'The edge must survive every devig method and every sharp on its own. Default: 2.'},
  {key: 'oddsMin', label: 'Lowest odds', step: 10, help: 'Heavy favourites below this are not must bets. Default: -200.'},
  {key: 'oddsMax', label: 'Highest odds', step: 10, help: 'Longshots above this are not must bets. Default: +200.'},
  {key: 'maxHold', label: 'Max sharp hold (%)', step: 0.5,
    help: 'A sharp line with more hold than this is a vague price. Default: 5.'},
];

/** Help text under the Must bets only checkbox. */
export const MUSTBET_HELP = 'Only rows that pass every check: no flags, a solid worst-case edge, sensible odds, ' +
    'at least two sharps and a tight sharp line.';

/** @return {!Object} A fresh copy of the defaults. */
export function mustBetReset() {
  return {...MUSTBET_DEFAULTS};
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
export function validateMustBet(values) {
  const errors = {};
  for (const f of MUSTBET_FIELDS) {
    const n = toNumber(values[f.key]);
    if (!Number.isFinite(n)) errors[f.key] = 'Enter a number';
    else if ((f.key === 'minEv' || f.key === 'maxHold') && n < 0) errors[f.key] = 'Must be 0 or more';
  }
  if (!errors.oddsMin && !errors.oddsMax && toNumber(values.oddsMin) > toNumber(values.oddsMax)) {
    errors.oddsMin = 'Lowest odds must not be above highest odds';
  }
  return errors;
}

/**
 * @param {!Object} values Current field values.
 * @param {!Object=} lastValid Values to send when `values` are invalid.
 * @return {string} Query fragment (starting with "&") carrying the thresholds to /api/ev.
 */
export function mustBetQuery(values, lastValid = MUSTBET_DEFAULTS) {
  const v = Object.keys(validateMustBet(values)).length ? lastValid : values;
  return `&must_bet_min_ev=${toNumber(v.minEv)}&must_bet_odds_min=${toNumber(v.oddsMin)}` +
      `&must_bet_odds_max=${toNumber(v.oddsMax)}&must_bet_max_hold=${toNumber(v.maxHold)}`;
}

/**
 * @param {boolean} on Whether "Must bets only" is checked.
 * @return {string} Query fragment for /api/ev.
 */
export function mustBetParam(on) {
  return on ? '&must_bet=true' : '';
}

/**
 * @param {!Object} row A /api/ev row.
 * @param {boolean=} failedTip When true, return the first failed check for a row that is not a must bet.
 * @return {?{label: string, tip: string, strong: boolean}} The badge (or the failure tip), else null.
 */
export function mustBetBadge(row, failedTip = false) {
  const reasons = row.must_bet_reasons;
  if (row.must_bet) return {label: 'Must bet', tip: (reasons || []).join('\n'), strong: true};
  if (failedTip && reasons && reasons.length) return {label: '', tip: reasons[0], strong: false};
  return null;
}
