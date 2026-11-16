/**
 * @fileoverview Pure helpers for parlay slip legs (no React, so node can test them).
 */

/**
 * Builds the slip leg for an outcome clicked at one book, or null for props.
 * @param {{id: string, home: string, away: string, sport: string}} event
 * @param {string} market
 * @param {{name: string, point: ?number, prices: !Object<string, number>}} outcome
 * @param {?string=} book
 * @return {?Object}
 */
export function slipLeg(event, market, outcome, book = null) {
  return null;
}

/**
 * The price a slip leg was added at, e.g. "+150 @ DraftKings"; '' when unknown.
 * @param {{odds: ?number, book: ?string}} leg
 * @param {string=} format
 * @return {string}
 */
export function slipPriceText(leg, format = 'american') {
  return '';
}
