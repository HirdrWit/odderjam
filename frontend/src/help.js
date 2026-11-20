/**
 * @fileoverview Help page content and the odds converter (no React), tested in
 * help.test.js. Keep every sentence short and define each term.
 */

import {decimalToAmerican, decimalToFractional, toDecimal} from './calc.js';
import {formatOdds} from './odds.js';

/** Window event name a banner fires to ask the app to open a tab. */
export const GOTO_EVENT = 'odderjam:goto';

/** Name of the Help tab. */
export const HELP_TAB = 'Help';

/**
 * Sections of the Help page. `risk` is a note shown at the end of a guide.
 * @const {!Array<{id: string, title: string, paragraphs: !Array<string>,
 *     steps: (!Array<string>|undefined), risk: (string|undefined),
 *     items: (!Array<{q: string, a: string}>|undefined)}>}
 */
export const HELP_SECTIONS = [
  {
    id: 'how-it-works',
    title: 'How Odderjam works',
    paragraphs: [
      'Odderjam compares the prices that sportsbooks offer on the same bet.',
      'A price is the odds a book pays. The "edge" is how much better a price is than the true chance of winning.',
      'Here is one example, from price to logged bet.',
    ],
    steps: [
      'Open the Odds Screen. You see Lakers moneyline at +150 at Book A and +130 at Book B.',
      'Book A has the best price, so it is highlighted.',
      'Open +EV. Odderjam says the fair price is +135, so +150 has a positive edge. "+EV" means positive expected value, or a bet that wins money on average.',
      'Place the stake shown at Book A. A stake is the money you risk.',
      'Click Track on that row. The bet is now logged in Tracker.',
      'After the game, mark the result. Tracker shows your profit and how your prices compared with the closing price.',
    ],
  },
  {
    id: 'odds-formats',
    title: 'Odds formats',
    paragraphs: [
      'American odds use a plus or minus sign. +150 means a $100 bet wins $150. -200 means you must bet $200 to win $100.',
      'Decimal odds show the total return for each $1. 2.50 means a $1 bet returns $2.50, which includes your stake.',
      'Fractional odds show profit over stake. 3/2 means you win $3 for each $2 bet.',
      'Implied probability is the chance the odds suggest. +150 implies 40%.',
      'Type a price below to see it in every format.',
    ],
  },
  {
    id: 'ev',
    title: 'Guide: +EV betting',
    paragraphs: [
      'A +EV bet pays more than its true odds say it should.',
      'One bet can still lose. The edge shows up over many bets.',
      'Bet the suggested stake and log every bet in Tracker.',
    ],
    risk: 'Risk: books may cut your limits if you win. A limit is the most a book lets you bet. A book can void a bet, which means it cancels the bet and refunds you. Some prices are errors, and a book may void those.',
  },
  {
    id: 'bettable-only',
    title: 'Bettable only',
    paragraphs: [
      'Bettable only hides bets that look good but carry extra risk. It sits in the bar at the top of every price tab and is off by default, so every bet shows.',
      'With it on, the +EV tab says how many bets are hidden and why. Press "Show anyway" to see them. Flagged bets carry a badge. Hover a badge to read why. The +EV Status column marks each bet Bettable or Not bettable, and "Change these rules" opens the thresholds in Model settings.',
      'In-play: the game is live, so the price may be stale. Longshot: small errors look like big edges. Heavy favourite: you risk a lot to win a little. Too good to be true: the edge is so big it is probably a bad line. Fragile edge: the bet is +EV only under one way of removing the margin. Sharps disagree: the sharp books do not agree on the true price. Legs priced apart: the legs were updated over 20 seconds apart. Longshot leg: one leg pays over +1000. Large order against: a big resting order on an exchange is on the other side, so it is likely a sharp bettor.',
      'When the mode is off, a "Bettable only: off" chip shows. Click it to turn the mode on.',
    ],
  },
  {
    id: 'arbitrage',
    title: 'Guide: arbitrage',
    paragraphs: [
      'An arbitrage bet covers every outcome at different books. You lock in a profit whichever side wins.',
      'Place every leg fast. A leg is one of the bets. Prices move quickly.',
    ],
    risk: 'Risk: if one leg moves or is refused, you hold an open bet. Books limit arbitrage players fast. A void on one leg breaks the hedge. A price error is a common cause, so check the odds twice.',
  },
  {
    id: 'middles',
    title: 'Guide: middles',
    paragraphs: [
      'A middle is two bets on the same game with a gap between the lines. If the result lands in the gap, both bets win.',
      'If it does not, you lose a small amount on one side.',
    ],
    risk: 'Risk: the gap often does not hit, so you pay a small cost many times. Books can limit you. A void on one side leaves you exposed. A line that is an error may be voided too.',
  },
  {
    id: 'promos',
    title: 'Guide: promo conversion',
    paragraphs: [
      'A promo is a bonus bet from a book. A bonus bet pays only the profit, not your stake.',
      'Promo conversion means hedging the bonus bet at another book. You turn the bonus into cash.',
      'Pick long odds for the bonus bet. The Promos tab shows the best choice.',
    ],
    risk: 'Risk: promo terms differ, so read them. A book may limit you or void the bonus if you break a rule. An odds error can void a bet, and you can lose the hedge side.',
  },
  {
    id: 'exchange-setup',
    title: 'Connect an exchange (Sharp Money)',
    paragraphs: [
      'Sharp Money watches trades on a betting exchange. An exchange is a market where people bet against each other. It needs one setting before it can work.',
    ],
    steps: [
      'Open the .env file in the Odderjam folder.',
      'Add the line EXCHANGES=Kalshi. Kalshi is the exchange with a public trade feed.',
      'Save the file and restart Odderjam.',
      'Open the Sharp Money tab. It now says which exchange it is watching.',
    ],
  },
  {
    id: 'faq',
    title: 'FAQ',
    paragraphs: [],
    items: [
      {
        q: 'Why did a bet disappear?',
        a: 'The price moved or the book took the line down. Prices change often. Press Refresh to load the latest data.',
      },
      {
        q: 'What is the Refresh box?',
        a: 'It reloads odds from the data provider. It also shows how many API credits you have left.',
      },
      {
        q: 'What are API credits?',
        a: 'The data provider charges one credit per request. Each refresh spends credits. When they run out, new prices stop loading.',
      },
      {
        q: 'Why is a book missing?',
        a: 'The provider may not cover that book in your region. The book may also have no price on that bet right now. Check your book filter too.',
      },
    ],
  },
];

/**
 * Converts a price from one format to all formats.
 * @param {string|number} value
 * @param {string} format One of 'american', 'decimal', 'fractional'.
 * @return {?{american: string, decimal: string, fractional: string,
 *     prob: string}} The price in each format, or null if invalid.
 */
export function convertOdds(value, format) {
  const dec = toDecimal(value, format);
  if (!Number.isFinite(dec) || dec <= 1) return null;
  const american = decimalToAmerican(dec);
  const [num, den] = decimalToFractional(dec);
  if (num < 1) return null;
  return {
    american: formatOdds(american, 'american'),
    decimal: dec.toFixed(2),
    fractional: `${num}/${den}`,
    prob: `${(100 / dec).toFixed(1)}%`,
  };
}
