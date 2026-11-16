/**
 * @fileoverview Pure helpers for the Odds Screen game row (no React), tested in
 * oddsrow.test.js.
 */

/**
 * @param {boolean} isOpen
 * @return {string} The chevron shown on a game row.
 */
export function chevron(isOpen) {
  return isOpen ? '▾' : '▸';
}

/**
 * @param {boolean} added True when a price was added, false when removed.
 * @return {{text: string, kind: string, action: (!Object|undefined)}}
 */
export function slipToast(added) {
  if (!added) return {text: 'Removed from slip', kind: 'ok'};
  return {
    text: 'Added to slip',
    kind: 'ok',
    action: {label: 'Open Parlay', tab: 'Parlay'},
  };
}

/**
 * @param {number} shown Books currently shown.
 * @param {number} total Books available.
 * @return {string} Plain-English meaning of "Books (shown/total)".
 */
export function booksHelp(shown, total) {
  return `Showing ${shown} of ${total} sportsbooks. Click to hide books you do not use.`;
}

/**
 * @param {boolean} welcomeShown
 * @return {boolean} False while the welcome banner is showing, so only one banner shows at a time.
 */
export function introVisible(welcomeShown) {
  return !welcomeShown;
}
