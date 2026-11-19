/**
 * @fileoverview Win % / Implied % cell values for the +EV, Odds Screen and
 * Tracker tables (no React, so they run under node --test).
 */

import {impliedPercent, probPercent} from './fmt.js';

/** @return {{win: string, implied: string}} +EV Win % (fair_prob) and Implied % of the price. */
export function evWinCell(row) {
  return {win: probPercent(row.fair_prob), implied: impliedPercent(row.odds)};
}

/** @return {?number} Sort key for the +EV Win % column. */
export function winSortKey(row) {
  return row.fair_prob;
}

/** @param {?number} fairAmerican @return {string} Win % of a fair price, or '—'. */
export function sideWinText(fairAmerican) {
  return impliedPercent(fairAmerican);
}
