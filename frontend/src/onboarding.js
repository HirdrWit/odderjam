/**
 * @fileoverview Which onboarding box shows (no React), tested in
 * onboarding.test.js. The welcome box belongs to one tab and never sits above
 * a tab intro; a dismissed intro collapses to a "?" control.
 */

import {shouldShowWelcome} from './welcome.js';

/**
 * @param {string} tab The tab opened first.
 * @param {?Storage=} storage
 * @return {?string} The tab the welcome shows on, or null once dismissed.
 */
export function initialWelcome(tab, storage) {
  return shouldShowWelcome(storage) ? tab : null;
}

/**
 * @param {?string} welcomeTab
 * @param {string} next The tab being opened.
 * @return {?string} The welcome tab after navigating; leaving it closes the welcome.
 */
export function afterNavigate(welcomeTab, next) {
  return welcomeTab === next ? welcomeTab : null;
}

/**
 * @param {?string} welcomeTab
 * @param {boolean} collapsed True when the user dismissed this tab's intro.
 * @return {boolean} True when the full intro banner shows.
 */
export function introShown(welcomeTab, collapsed) {
  return welcomeTab == null && !collapsed;
}

/**
 * @param {boolean} collapsed
 * @return {?{label: string}} The "?" control for a collapsed intro, else null.
 */
export function introToggle(collapsed) {
  return collapsed ? {label: 'About this tab'} : null;
}
