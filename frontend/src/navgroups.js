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
  {title: 'Size and track', tabs: ['Calculator', 'Tracker', 'Alerts']},
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
};

/** @return {!Array<string>} Every tab name, in nav order. */
export function navTabs() {
  return NAV_GROUPS.flatMap((g) => g.tabs);
}
