/**
 * @fileoverview Copy for the per-tab error boundary (no React), tested in errors.test.js.
 */

/**
 * @param {string} tab
 * @return {string}
 */
export function boundaryMessage(tab) {
  return `${tab} hit an error. Reload to try again.`;
}
