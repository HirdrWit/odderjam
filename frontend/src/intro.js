/**
 * @fileoverview Copy and dismissal storage for the per-tab intro banner (no
 * React), tested in intro.test.js. Storage access is wrapped in try/catch
 * because localStorage can be unavailable.
 */

/** @const {!Object<string, {what: string, how: string}>} */
export const INTRO_COPY = {
  'Odds Screen': {
    what: 'Compare every sportsbook\'s price on the same bet, with the best price highlighted.',
    how: 'Pick a sport or search a team, then look for the highlighted price to see where to bet.',
  },
  '+EV': {
    what: 'These bets pay more than their true odds say they should, which gives you an edge (+EV means positive expected value).',
    how: 'Sort by edge, then bet the suggested stake.',
  },
  'Arbitrage': {
    what: 'Bet both sides of a game at different books to lock in a profit whichever side wins.',
    how: 'Place every leg at the stake shown, and do it quickly before the prices move.',
  },
  'Tracker': {
    what: 'Log every bet you place, and the stats show whether you really beat the market or just got lucky.',
    how: 'Add each bet below, or click Track on any +EV or Arbitrage row, and fill in the closing odds once the game starts.',
  },
  'Alerts': {
    what: 'Get told when a good bet appears, so you do not have to keep watching the screen, and it never spends extra API credits.',
    how: 'Add a rule with the minimum percent you care about, and set a Discord webhook if you want messages there.',
  },
};

/**
 * @param {string} tab
 * @return {string} The localStorage key for the tab's dismissal.
 */
export function introKey(tab) {
  return `intro:${tab}`;
}

/**
 * @param {?Storage|undefined} storage
 * @param {string} tab
 * @return {boolean} True when the user dismissed this tab's banner.
 */
export function introDismissed(storage, tab) {
  try {
    return storage.getItem(introKey(tab)) === '1';
  } catch {
    return false;
  }
}

/**
 * @param {?Storage|undefined} storage
 * @param {string} tab
 * @param {boolean} dismissed
 */
export function setIntroDismissed(storage, tab, dismissed) {
  try {
    if (dismissed) {
      storage.setItem(introKey(tab), '1');
    } else {
      storage.removeItem(introKey(tab));
    }
  } catch {
    // Storage can be unavailable; the choice just is not remembered.
  }
}
