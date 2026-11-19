/**
 * @fileoverview Win % / Implied % cell values for the +EV, Odds Screen and
 * Tracker tables (no React, so they run under node --test).
 */

/** @return {{win: string, implied: string}} +EV Win % (fair_prob) and Implied % of the price. */
export function evWinCell(row) {
  return {win: '', implied: ''};
}

/** @return {?number} Sort key for the +EV Win % column. */
export function winSortKey(row) {
  return null;
}

/** @param {?number} fairAmerican @return {string} Win % of a fair price, or '—'. */
export function sideWinText(fairAmerican) {
  return '';
}
