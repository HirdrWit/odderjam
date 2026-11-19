/**
 * @fileoverview Exchange liquidity text for table rows (no React), tested in liquidity.test.js.
 */

/**
 * @param {?number|undefined} dollars Dollars resting at the shown price; null or undefined when the book gives no size.
 * @return {string} "Liquidity $68,000", or '' when unknown (no cell is shown).
 */
export function fmtLiquidity(dollars) {
  if (dollars == null || !Number.isFinite(dollars)) return '';
  return `Liquidity $${Math.round(dollars).toLocaleString('en-US')}`;
}
