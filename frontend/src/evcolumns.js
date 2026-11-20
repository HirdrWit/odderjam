/**
 * @fileoverview Column list for the +EV table (no React), tested in evcolumns.test.js.
 * Each entry is [id, label, defaultSortDir?].
 */

import {bettableRank} from './bettable.js';

/** @const {!Array<!Array<string>>} */
export const EV_COLUMNS = [
  ['ev', 'EV%', 'desc'], ['status', 'Status', 'asc'], ['pick', 'Pick'], ['market', 'Market'], ['event', 'Event'],
  ['book', 'Book'], ['worst', 'Worst EV', 'desc'], ['odds', 'Odds', 'desc'], ['fair', 'Fair', 'desc'],
  ['win', 'Win %', 'desc'], ['sharps', 'Sharps (hold)'], ['stake', 'Stake', 'desc'],
];

/** Sort key for the Status column: Bettable rows first when ascending. */
export const statusSortKey = bettableRank;

/**
 * @param {string} label "Bettable" or "Not bettable".
 * @return {string} Icon shown beside the label, so colour is not the only cue.
 */
export function statusIcon(label) {
  return label === 'Bettable' ? '✓' : '⚠';
}
