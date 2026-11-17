/**
 * @fileoverview Pure helpers for the +EV Track button (no React), tested in
 * track.test.js.
 */

/**
 * @param {{stake: (number|undefined)}} row
 * @return {?number} The stake the row shows, rounded to cents, or null when it
 *     is zero or missing (the user must then enter one).
 */
export function trackStake(row) {
  const stake = Math.round(Number(row.stake) * 100) / 100;
  return stake > 0 ? stake : null;
}

/**
 * @param {?string} text What the user typed into the stake prompt.
 * @return {?number} A positive amount, or null when it is blank or invalid.
 */
export function parseStakeInput(text) {
  if (text == null) return null;
  const n = Number(String(text).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * @param {{pick: string, book: string}} row
 * @param {number} stake The stake that was logged.
 * @return {{text: string, kind: string, action: !Object}}
 */
export function trackToast(row, stake) {
  return {
    text: `Logged in Tracker: ${row.pick} @ ${row.book}, $${stake.toFixed(2)}`,
    kind: 'ok',
    action: {label: 'Open Tracker', tab: 'Tracker'},
  };
}

/**
 * @param {boolean} tracked
 * @return {string} Label for the row's Track button.
 */
export function trackButtonLabel(tracked) {
  return tracked ? '✓ Tracked' : 'Track';
}

/**
 * @param {!Object} row
 * @return {string} Stable key for "this row was already tracked".
 */
export function trackKey(row) {
  return [row.event_id, row.market, row.pick, row.point ?? '', row.book].join('|');
}

/**
 * @param {boolean} inSlip
 * @return {string} Label for the row's slip button.
 */
export function slipButtonLabel(inSlip) {
  return inSlip ? '✓ In slip' : '+ Slip';
}

/**
 * @param {string} kind 'bet', 'track' or 'slip'.
 * @param {boolean} on True when the row is tracked or in the slip.
 * @param {{pick: string, book: string}} row
 * @return {string} Accessible name that states the action and the on state in words.
 */
export function rowActionAria(kind, on, row) {
  const what = `${row.pick} at ${row.book}`;
  if (kind === 'bet') return `Bet ${what}, opens the sportsbook`;
  if (kind === 'track') return on ? `Already tracked: ${what}` : `Track ${what} in the Tracker`;
  return on ? `In slip, remove from slip: ${what}` : `Add ${what} to slip`;
}
