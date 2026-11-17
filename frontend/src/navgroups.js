/**
 * @fileoverview Sidebar grouping and one-line subtitles for each tab (no
 * React), tested in navgroups.test.js.
 */

/** @const {!Array<{title: string, tabs: !Array<string>}>} */
export const NAV_GROUPS = [
  {title: 'Compare prices', tabs: ['Odds Screen']},
  {
    title: 'Find bets',
    tabs: ['+EV', 'Arbitrage', 'Middles', 'Low Hold', 'Sharp Money', 'Parlay', 'Promos', 'Pick\'em'],
  },
  {title: 'Size and track', tabs: ['Calculator', 'Tracker', 'Alerts', 'Help']},
];

/** @const {!Object<string, string>} */
export const NAV_SUBTITLES = {
  'Odds Screen': 'Every book\'s price side by side',
  '+EV': 'Bets priced better than fair',
  'Arbitrage': 'Guaranteed profit',
  'Middles': 'Win both sides with a gap',
  'Low Hold': 'Markets with a tiny book edge',
  'Sharp Money': 'Where the pros are betting',
  'Parlay': 'Combine legs, see the true price',
  'Promos': 'Turn bonuses into profit',
  'Pick\'em': 'Check player-prop picks',
  'Calculator': 'Work out the right stake',
  'Tracker': 'Log bets and see results',
  'Alerts': 'Get notified of new edges',
  'Help': 'How it works, odds, glossary and FAQ',
};

/** @return {!Array<string>} Every tab name, in nav order. */
export function navTabs() {
  return NAV_GROUPS.flatMap((g) => g.tabs);
}

/**
 * @param {string} tab Tab name.
 * @param {number} slipCount Legs on the parlay slip.
 * @return {string} The nav label; Parlay shows its leg count.
 */
export function navLabel(tab, slipCount) {
  return tab === 'Parlay' && slipCount > 0 ? `Parlay (${slipCount})` : tab;
}

/** @const {!Array<string>} Tabs on the mobile bottom bar; the rest sit under More. */
export const MOBILE_TABS = ['Odds Screen', '+EV', 'Arbitrage', 'Tracker'];

/** @return {!Array<string>} Tabs listed under More on mobile. */
export function moreTabs() {
  return navTabs().filter((t) => !MOBILE_TABS.includes(t));
}
