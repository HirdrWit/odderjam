/**
 * @fileoverview Plain-English guidance for the Calculator tab (no React):
 * when to use each calculator, what its example shows, what each result row
 * means, and the question index. Tested in calcguide.test.js.
 */

/**
 * @const {!Object<string, {when: string, example: string, rows: !Object<string, string>}>}
 */
export const CALC_GUIDE = {
  'Expected value': {
    when: 'Use this when a book offers a price and you want to know if it is worth taking.',
    example: 'A +110 bet you think wins 50% of the time, $100 stake.',
    rows: {
      'Expected value': 'Your average profit per bet in dollars over many bets. Above $0 is good.',
      'EV %': 'Expected value as a share of your stake. Positive means an edge; 2% to 5% is solid.',
      'Profit if win': 'What you pocket if this one bet wins, before counting the risk of losing.',
      'Implied win %': 'The win chance the price asks for. You need to beat this to profit.',
      'Fair odds': 'The price your win % deserves. Take any price better than this.',
    },
  },
  'Kelly': {
    when: 'Use this when you have an edge and want to know how much to stake.',
    example: 'A $1,000 bankroll, +110 odds, a 52% win chance, quarter Kelly.',
    rows: {
      'Recommended stake': 'The bet size after applying your Kelly multiplier. Smaller is safer.',
      '% of bankroll': 'That stake as a share of your bankroll. Most bets land at 0.5% to 3%.',
      'Full Kelly': 'The maximum growth stake. It swings hard, so most people bet a fraction.',
      'EV %': 'Your edge on this bet. If it is not positive, Kelly says to skip the bet.',
    },
  },
  'No-vig fair odds': {
    when: 'Use this when you want the real chance of each outcome with the book\'s margin removed.',
    example: 'A two-way market priced -120 / +100.',
    rows: {
      'Outcome': 'Each possible result of the market, in the order you entered them.',
      'Implied': 'The chance the posted price suggests. These add to more than 100% because of the vig.',
      'Fair prob': 'The implied chance with the vig stripped out. These add to exactly 100%.',
      'Fair odds': 'The price with no margin. Compare it to other books to spot value.',
      'Hold': 'The book\'s built-in margin on this market. Lower is better for you.',
    },
  },
  'Odds converter': {
    when: 'Use this when odds are in a format you do not read and you want another one.',
    example: 'American odds of -110, shown in every format.',
    rows: {
      'American': 'US style: + shows profit on $100, - shows the stake needed to win $100.',
      'Decimal': 'Total return per $1 staked, stake included. 1.91 returns $1.91 per $1.',
      'Fractional': 'UK style: profit over stake. 10/11 wins $10 on an $11 stake.',
      'Implied %': 'The win chance the price implies. A fair coin flip is 50%.',
    },
  },
  'Implied probability': {
    when: 'Use this when you want to know what win chance a price is asking you to believe.',
    example: 'A -150 favourite against a +130 underdog.',
    rows: {
      'Outcome': 'Each side of the market, in the order you entered them.',
      'Implied probability': 'The win chance baked into the price. Shorter odds mean a higher chance.',
      'Total': 'All implied chances added up. Above 100% means the book is charging a margin.',
      'Overround': 'How far the total is above 100%. This is the margin you pay.',
    },
  },
  'Vig / hold': {
    when: 'Use this when you want to know how much a book charges on a market, or if it is an arb.',
    example: 'A standard -110 / -110 spread with $200 to stake.',
    rows: {
      'Hold (book margin)': 'The share of money the book keeps. About 4.5% is normal; under 2% is low.',
      'Overround (vig)': 'The implied chances above 100%. It is the same cost seen another way.',
      'Total implied': 'All implied chances added together. Under 100% means a guaranteed profit.',
    },
  },
  'Parlay': {
    when: 'Use this when you want the payout and fair value of a multi-leg bet.',
    example: 'Two -110 legs with a $10 stake.',
    rows: {
      'Parlay odds': 'The combined price of all legs. Every leg has to win.',
      'Payout': 'What you get back if every leg wins, stake included.',
      'Profit': 'Payout minus your stake.',
      'Implied prob': 'The chance of all legs winning that the price implies. It falls fast as legs are added.',
      'Fair prob': 'The real chance of every leg winning, from the fair win % you entered.',
      'EV': 'Average profit of the parlay. Negative is typical because the vig compounds.',
    },
  },
  'Round robin': {
    when: 'Use this when you like several picks but want to survive if one of them loses.',
    example: 'Three -110 legs, played as every 2-leg parlay at $10 each.',
    rows: {
      'Parlays': 'How many separate parlays the round robin creates.',
      'Total stake': 'Every parlay costs the stake, so this is stake times the parlay count.',
      'Max payout (all win)': 'What you collect if every pick wins.',
      'Max profit': 'The best case result after subtracting the total stake.',
    },
  },
  'Bonus bet': {
    when: 'Use this when a book gives you a free bet and you want to turn it into cash.',
    example: 'A $100 bonus bet at +250, hedged at -300 on another book.',
    rows: {
      'Exact hedge stake': 'The cash bet that locks the same profit either way, with the conversion rate.',
      'Rounded hedge stake': 'That stake rounded to a bet you can place. Use this number.',
      'Profit if bonus side wins': 'Your result if the free bet wins. It should be close to the other line.',
      'Profit if hedge side wins': 'Your result if the hedge wins. It should be close to the other line.',
      'Conversion (worst case)': 'Share of the bonus turned into cash. 60% to 80% is a good result.',
    },
  },
  'Arbitrage': {
    when: 'Use this when two books disagree and you want to bet both sides for a sure profit.',
    example: 'Odds of +110 and -105 on opposite sides, $100 total.',
    rows: {
      'Profit (exact stakes)': 'The locked-in gain as a % of your total stake. Above 0% is an arb.',
      'Payout (any outcome)': 'What you collect whichever side wins.',
    },
  },
  'Hedge': {
    when: 'Use this when you hold a bet that is now winning and want to lock in a profit.',
    example: 'A $100 bet at +300, hedged at -150.',
    rows: {
      'Hedge stake': 'How much to bet on the other side to even out the result.',
      'Locked profit (either outcome)': 'What you make whichever side wins. Above $0 is a sure gain.',
      'Unhedged: win / lose': 'What you would make or lose with no hedge. Compare it to the locked profit.',
    },
  },
  'Prediction market': {
    when: 'Use this when you see a contract price in cents and want to compare it with sportsbook odds.',
    example: 'A contract priced at 40¢ with no fee.',
    rows: {
      'Implied probability': 'The price in cents is the chance the market gives. 40¢ means 40%.',
      'American (after fee)': 'The same price as sportsbook odds, fee included.',
      'Decimal (after fee)': 'Total return per $1 staked, fee included.',
      'Break-even win %': 'The chance you need to win to come out even after the fee.',
    },
  },
  'Poisson': {
    when: 'Use this when you want over/under chances for a low-scoring count such as goals.',
    example: 'An average of 2.3 goals against a 1.5 line.',
    rows: {
      'Over': 'The chance the total lands above the line, with the fair odds in brackets.',
      'Under': 'The chance the total lands below the line, with the fair odds in brackets.',
      'Push': 'The chance the total lands exactly on a whole-number line and the bet is refunded.',
    },
  },
  'Half point': {
    when: 'Use this when a book lets you buy half a point and you want to know if it pays off.',
    example: 'An NFL spread moved across 3, from -110 to -130.',
    rows: {
      'EV at whole number': 'Your edge at the original line and price.',
      'EV after buying ½ point': 'Your edge after paying extra to move the line.',
      'Verdict': 'Buy if the second EV beats the first. Otherwise keep the original bet.',
    },
  },
  'Spread → moneyline': {
    when: 'Use this when you have a spread and want the matching moneyline price.',
    example: 'An NFL favourite at -3.',
    rows: {
      'Favourite fair ML': 'The no-vig moneyline for the favourite and its win chance.',
      'Underdog fair ML': 'The no-vig moneyline for the underdog and its win chance.',
    },
  },
};

/** @const {!Array<{question: string, calc: string}>} */
export const CALC_QUESTIONS = [
  {question: 'Is this bet good?', calc: 'Expected value'},
  {question: 'How much should I bet?', calc: 'Kelly'},
  {question: 'What is the real chance?', calc: 'No-vig fair odds'},
  {question: 'What does this price mean?', calc: 'Odds converter'},
  {question: 'How much is the book charging?', calc: 'Vig / hold'},
  {question: 'Can I lock in a profit?', calc: 'Arbitrage'},
  {question: 'How do I use a free bet?', calc: 'Bonus bet'},
  {question: 'What does a parlay pay?', calc: 'Parlay'},
];

/**
 * Returns the one-line explanation of a result row, or '' if there is none.
 * @param {string} calcName
 * @param {string} label
 * @return {string}
 */
export function explainRow(calcName, label) {
  const guide = Object.prototype.hasOwnProperty.call(CALC_GUIDE, calcName) ? CALC_GUIDE[calcName] : null;
  if (!guide || !Object.prototype.hasOwnProperty.call(guide.rows, label)) return '';
  return guide.rows[label];
}
