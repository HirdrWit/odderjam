/**
 * @fileoverview Column header help and "how to read this row" examples for the
 * tool tabs (no React), tested in columns.test.js. A column with a `glossary`
 * id reuses that glossary definition; the rest carry their own `text`.
 */

import {findEntry} from './glossary.js';
import {windowText} from './middles.js';

/** @const {!Object<string, !Array<{label: string, glossary: (string|undefined), text: (string|undefined)}>>} */
export const COLUMNS = {
  '+EV': [
    {label: 'EV%', glossary: 'edge'},
    {label: 'Pick', text: 'The side of the bet to take.'},
    {label: 'Market', text: 'The kind of bet, such as moneyline, spread or total.'},
    {label: 'Event', text: 'The game, and a LIVE tag if it has started.'},
    {label: 'Book', text: 'The sportsbook that offers this price.'},
    {label: 'Worst EV', glossary: 'worst-ev'},
    {label: 'Odds', glossary: 'american-odds'},
    {label: 'Fair', glossary: 'fair-odds'},
    {label: 'Win %', glossary: 'win-probability'},
    {label: 'Sharps (hold)', text: 'The sharp books used to find the fair price, each with its hold (the margin it keeps).'},
    {label: 'Stake', glossary: 'kelly'},
  ],
  'Odds Screen': [
    {label: 'Win %', glossary: 'win-probability'},
  ],
  'Tracker': [
    {label: 'Implied %', text: 'The chance your logged odds assume, with the sportsbook\'s margin included. 1 divided by the decimal odds.'},
  ],
  'Low Hold': [
    {label: 'Hold', glossary: 'hold'},
    {label: 'Event', text: 'The game, and its sport.'},
    {label: 'Market', text: 'The kind of bet, such as moneyline, spread or total.'},
    {label: 'Legs', text: 'The bets to place, each at its best book, with the stake for your total.'},
    {label: 'Exp. loss', text: 'What you expect to lose on average if you bet every leg at these stakes. Negative is a profit.'},
  ],
  'Middles': [
    {label: 'EV%', glossary: 'edge'},
    {label: 'Hit %', text: 'The estimated chance that the result lands inside the window.'},
    {label: 'Event', text: 'The game, and its sport.'},
    {label: 'Market', text: 'Spread or total.'},
    {label: 'Window', text: 'The range of results where both bets win, in points, with the two lines.'},
    {label: 'Legs', text: 'The two bets to place, each at its book, with the stake for $100 total.'},
    {label: 'Worst case', text: 'Your result if the game misses the window on either side. Usually a small loss.'},
    {label: 'Win both', text: 'Your profit if the result lands inside the window and both bets win.'},
  ],
  'Sharp Money': [
    {label: 'Event', text: 'The game, and its sport.'},
    {label: 'Side', text: 'The outcome the burst of trading backed.'},
    {label: 'Exchange', text: 'The betting exchange where the trades happened.'},
    {label: 'Volume', text: 'Contracts traded in the burst, and the number of trades.'},
    {label: '× usual', text: 'How many times the normal trading rate this burst was. "new" means there was no earlier trading to compare.'},
    {label: 'Spike price', text: 'The average price paid in the burst, as odds and in cents per contract.'},
    {label: 'Books paying more', text: 'Sportsbooks offering a better price than the exchange, with the edge you get.'},
  ],
};

/**
 * @param {string} tab
 * @param {string} label
 * @return {string} The tooltip text, or '' when unknown.
 */
export function columnTip(tab, label) {
  const column = (COLUMNS[tab] || []).find((c) => c.label === label);
  if (!column) return '';
  if (column.glossary) return findEntry(column.glossary)?.definition ?? '';
  return column.text ?? '';
}

const LEAD = 'How to read this row: ';

/**
 * Why a +EV row shows no stake: a positive edge whose stake rounded to zero.
 * @param {!Object} row A +EV row from the API.
 * @return {string} A short reason, or '' when the stake is above zero or there is no edge.
 */
export function zeroStakeReason(row) {
  if (!(row.ev_pct > 0) || row.stake > 0) return '';
  return 'Suggested stake rounds to under $1';
}

/**
 * @param {!Object} row A +EV row from the API.
 * @return {string} '<$1' when the stake rounded below a dollar, else ''.
 */
export function stakeCellText(row) {
  return zeroStakeReason(row) ? '<$1' : '';
}

/**
 * The one note shown above the +EV table when any stake rounds below $1.
 * @param {?Array<!Object>} rows
 * @return {string} The note, or '' when no row is affected.
 */
export function zeroStakeNote(rows) {
  if (!Array.isArray(rows) || !rows.some((r) => zeroStakeReason(r))) return '';
  return 'Some stakes round below $1. Raise your bankroll or lower Round to in Bankroll & staking';
}

/**
 * @param {!Object} l A leg.
 * @return {string}
 */
function legText(l) {
  return `${l.pick} @ ${l.book}`;
}

/**
 * @param {string} tab
 * @param {!Object} row One result row from the API.
 * @param {{odds: function(number): string, money: function(number): string}} fmt
 * @return {string} A one-line reading of the row, or '' for an unknown tab.
 */
export function rowExample(tab, row, fmt) {
  switch (tab) {
    case '+EV': {
      const reason = zeroStakeReason(row);
      return `${LEAD}${row.pick} at ${row.book} pays ${fmt.odds(row.odds)}, but the fair price is ` +
          `${fmt.odds(row.fair_odds)}. That is a ${row.ev_pct.toFixed(1)}% edge, ` +
          (reason ? `but there is no suggested stake. ${reason}.` : `so the suggested stake is ${fmt.money(row.stake)}.`);
    }
    case 'Arbitrage':
      return `${LEAD}place ${row.legs.map((l) => `${legText(l)} for ${fmt.money(l.stake)}`).join(' and ')}. ` +
          `Whichever side wins, you lock in ${row.profit_pct.toFixed(1)}% profit.`;
    case 'Low Hold':
      return `${LEAD}the books together keep only ${row.hold_pct.toFixed(1)}% on this market. ` +
          `Bet ${row.legs.map(legText).join(' and ')} to ${row.expected_loss <= 0 ? 'expect a profit' :
            `expect to lose ${fmt.money(row.expected_loss)}`}.`;
    case 'Middles':
      return `${LEAD}if the result lands in ${row.low === undefined ? row.window : windowText(row)}, both bets win and you make ${fmt.money(row.win_both)}. ` +
          `That happens about ${(row.hit_prob * 100).toFixed(1)}% of the time; otherwise your result is ` +
          `${fmt.money(row.worst_case)}.`;
    case 'Sharp Money':
      return `${LEAD}trading on ${row.outcome} at ${row.exchange} ran ` +
          `${row.ratio === null ? 'with no earlier trading to compare' : `${row.ratio.toFixed(1)}× the usual rate`}` +
          `, which may mean informed money. Check whether a book still pays more.`;
    default:
      return '';
  }
}
