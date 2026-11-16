/**
 * @fileoverview Plain-English copy and helpers for the +EV filter bar (no
 * React), tested in evbar.test.js.
 */

/** @const {string} The devig method the app starts with. */
export const DEFAULT_METHOD = 'multiplicative';

/** @const {!Object<string, string>} API method code to readable name. */
export const DEVIG_METHODS = {
  multiplicative: 'Multiplicative',
  additive: 'Additive',
  power: 'Power',
  shin: 'Shin',
  worst_case: 'Worst case',
};

/**
 * @param {string} code API devig method code.
 * @return {string} Readable name; the default is marked.
 */
export function methodLabel(code) {
  const name = DEVIG_METHODS[code];
  if (!name) return code;
  return code === DEFAULT_METHOD ? `${name} (default)` : name;
}

/** @const {!Object<string, string>} */
export const FILTER_HELP = {
  bankroll: 'Start is the money you began with. Current is start plus your tracked profit or loss. Stakes are sized from it.',
  devig: 'How the sharp books\' margin is removed to find the true odds. Recommended: Multiplicative (the default); try Worst case to be cautious.',
  kelly: 'What share of the full Kelly stake to bet. Smaller is safer. Recommended: 0.25 (quarter Kelly, the default).',
  sharpWeights: 'How much to trust each sharp book when working out the true odds. 0 ignores a book. Default: 1 for the main sharp book.',
  maxHold: 'Ignore sharp prices from books whose margin (hold) is above this. Lower means stricter. Default: set by the server, about 5.',
};

/** @const {!Object<string, string>} */
export const ROW_ACTION_TIPS = {
  bet: 'Open this bet at the sportsbook to place it',
  track: 'Log this bet in the Tracker at the suggested stake',
  slip: 'Add this bet to your parlay slip to combine it with others',
};

/**
 * @param {(number|string)} typed Value in the start box.
 * @param {number} saved Start bankroll the server holds.
 * @return {string} A pending note, or '' when nothing is waiting to save.
 */
export function pendingStartText(typed, saved) {
  if (typed === '' || Number(typed) === saved) return '';
  return 'Saving…';
}
