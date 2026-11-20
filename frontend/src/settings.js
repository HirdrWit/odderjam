/**
 * @fileoverview Settings dialog helpers (no React), tested in settings.test.js.
 */

/** @const {string} Label of the sidebar item that opens the Settings dialog. */
export const SETTINGS_LABEL = 'Settings';

/**
 * Settings is a dialog opened from the nav, not a tab, so every tab reaches it.
 * @param {string} tab Tab name.
 * @return {boolean} True when the Settings entry is available on the tab.
 */
export function settingsReachable(tab) {
  return typeof tab === 'string' && tab.length > 0;
}

/** @const {!Array<{label: string, panel: string}>} Links to the +EV panels. */
export const SETTINGS_LINKS = [
  {label: 'Bankroll & staking', panel: 'staking'},
  {label: 'Model settings', panel: 'model'},
];

/** @const {string} Event telling a mounted +EV tab to open a panel. */
export const PANEL_EVENT = 'odderjam:panel';

let pendingPanel = null;

/**
 * Asks the +EV tab to open a panel, whether or not it is mounted yet.
 * @param {string} panel Panel id.
 */
export function requestPanel(panel) {
  pendingPanel = panel;
}

/** @return {?string} The requested panel, once; then null. */
export function takePanel() {
  const panel = pendingPanel;
  pendingPanel = null;
  return panel;
}

/** @const {string} Event fired when the Browser alerts choice changes. */
export const ALERTS_EVENT = 'odderjam:alerts';

/** @const {string} Label of the control that opens the Bettable rules. */
export const RULES_BUTTON = 'Change these rules';

/** @const {string} DOM id of the Bettable mode fieldset in Model settings. */
export const RULES_FIELDSET_ID = 'bettable-mode';

/**
 * Asks the +EV tab to open Model settings scrolled to the Bettable mode fieldset.
 * @return {{panel: string, scrollTo: string}}
 */
export function requestRules() {
  requestPanel('model');
  return {panel: 'model', scrollTo: RULES_FIELDSET_ID};
}
