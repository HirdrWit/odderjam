/**
 * @fileoverview Sharp weights per market class (React-free), tested in sharpweights.test.js.
 */

/** @const {!Array<string>} Market classes; main lines and player props. */
export const CLASSES = ['main', 'props'];

/** @const {!Array<{value: string, label: string}>} Where the fair price comes from. */
export const FAIR_SOURCES = [
  {value: 'sharp', label: 'Sharp books'},
  {value: 'all_books', label: 'All books (market average)'},
];

/**
 * @param {!Object<string, !Object<string, number>>} weights Weights per class.
 * @return {string} The per-class SHARP_WEIGHTS spec; zero weights are left out.
 */
export function weightsSpec(weights) {
  return CLASSES.map((cls) => {
    const entries = Object.entries(weights[cls] || {}).filter(([, v]) => v > 0);
    return `${cls}:${entries.map(([b, v]) => `${b}:${v}`).join(',')}`;
  }).join(';');
}

/**
 * @param {!Object} weights Weights per class.
 * @param {string} cls Market class.
 * @param {string} book Sharp book.
 * @param {number} value New weight.
 * @return {!Object} A copy with one weight changed.
 */
export function setWeight(weights, cls, book, value) {
  return {...weights, [cls]: {...weights[cls], [book]: value}};
}

/**
 * @param {?Object} weights The user's weights, or null for the recommended ones.
 * @param {!Object} recommended The recommended weights.
 * @return {boolean} True when the weights differ from the recommended ones.
 */
export function isCustom(weights, recommended) {
  return weights != null && weightsSpec(weights) !== weightsSpec(recommended);
}
