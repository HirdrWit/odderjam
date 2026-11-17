/**
 * @fileoverview Plain-English definitions for betting jargon (no React), tested
 * in glossary.test.js. Every `<Term id="...">` must have an entry here.
 */

/** @const {!Array<{id: string, label: string, definition: string, example: string}>} */
export const GLOSSARY = [
  {
    id: 'ev', label: '+EV',
    definition: 'Positive expected value: a bet that pays more than its true chance of winning says it should.',
    example: 'A bet that wins 50% of the time but pays +110 earns money over many bets.',
  },
  {
    id: 'edge', label: 'Edge',
    definition: 'How much better the price you get is than the true price, as a percent of your stake.',
    example: 'A 3% edge means you expect to win about $3 for every $100 staked.',
  },
  {
    id: 'fair-odds', label: 'Fair odds',
    definition: 'The odds with the sportsbook\'s margin removed: what the price would be if nobody took a cut.',
    example: 'A 50/50 coin flip has fair odds of +100, even if books offer -110.',
  },
  {
    id: 'devig', label: 'Devig (no-vig)',
    definition: 'Removing the sportsbook\'s margin from a set of prices to find the true chances.',
    example: '-110 on both sides adds up to 104.8%; devigged, each side is 50%.',
  },
  {
    id: 'vig', label: 'Vig',
    definition: 'Short for vigorish: the cut a sportsbook builds into its prices.',
    example: 'Betting -110 on both sides of a coin flip, the vig is about 4.5%.',
  },
  {
    id: 'hold', label: 'Hold',
    definition: 'The percentage a sportsbook keeps built into its prices. Lower is better for you.',
    example: 'A 4% hold means the book keeps about $4 of every $100 bet across both sides.',
  },
  {
    id: 'sharp-book', label: 'Sharp book',
    definition: 'A sportsbook with low margins that welcomes skilled bettors, so its prices are close to the truth.',
    example: 'If a sharp book prices a team at 55% and your book at 50%, your book is likely too generous.',
  },
  {
    id: 'kelly', label: 'Kelly',
    definition: 'A formula that sizes your bet by your edge and the odds. Many people bet a fraction of it to be safe.',
    example: 'Quarter Kelly on a full-Kelly stake of $40 is $10.',
  },
  {
    id: 'clv', label: 'CLV',
    definition: 'Closing line value: how your price compares to the final price before the game starts. Beating it is a good sign.',
    example: 'You bet +120 and the line closes at +105, so you beat the close.',
  },
  {
    id: 'hedge', label: 'Hedge',
    definition: 'Betting the other side to lock in a profit or cut your risk on an existing bet.',
    example: 'You hold a futures bet at +1000; a bet on the rival side guarantees a profit either way.',
  },
  {
    id: 'arb', label: 'Arb (arbitrage)',
    definition: 'Betting every outcome at different books so you win whichever outcome happens.',
    example: 'Team A at +110 at one book and Team B at +110 at another: bet both for a sure profit.',
  },
  {
    id: 'bettable-only', label: 'Bettable only',
    definition: 'A switch that hides bets with a risk flag: in-play, longshot, heavy favourite, too good to be true, fragile edge, sharps disagree, legs priced apart or longshot leg.',
    example: 'With it on, a +550 in-play bet at 20% edge is hidden and counted in the summary. Turn it off to see it with a warning badge.',
  },
  {
    id: 'middle', label: 'Middle',
    definition: 'Betting both sides of a line at different numbers so that both bets can win if the result lands between them.',
    example: 'Over 45.5 at one book and under 47.5 at another: a final total of 46 or 47 wins both.',
  },
  {
    id: 'american-odds', label: 'American odds',
    definition: 'Prices shown as +/- numbers: negative is what you stake to win $100, positive is what $100 wins.',
    example: '-150 means stake $150 to win $100; +150 means $100 wins $150.',
  },
  {
    id: 'decimal-odds', label: 'Decimal odds',
    definition: 'Prices shown as the total payout per $1 staked, stake included.',
    example: '2.50 means $10 returns $25, which is $15 profit.',
  },
  {
    id: 'closing-odds', label: 'Closing odds',
    definition: 'The final price on a bet just before the game starts. Enter it after the game starts to see if you beat the market (CLV).',
    example: 'You bet +120 and the line closed at +105: enter 105.',
  },
  {
    id: 'bonus-bet', label: 'Bonus bet',
    definition: 'A free bet from a sportsbook promo: the stake is not returned when you win, and a loss costs you $0.',
    example: 'A $50 bonus bet at +200 pays $100 profit if it wins, not $150.',
  },
  {
    id: 'sharp-clv', label: 'Sharp CLV',
    definition: 'CLV measured against the closing price of sharp books with their margin removed, the best guide to the true price.',
    example: 'You bet +120 and the sharp no-vig close is +105: your Sharp CLV is positive.',
  },
  {
    id: 'strategy', label: 'Strategy',
    definition: 'Why you made the bet, such as +EV, arbitrage or a promo. Stats are grouped by it so you can see what works.',
    example: 'Pick +EV for a bet from the +EV tab and Manual for a hunch.',
  },
  {
    id: 'min-percent', label: 'Min %',
    definition: 'The smallest edge (for +EV) or profit (for arbitrage) that triggers an alert. Higher means fewer, better alerts.',
    example: 'Min 3 on a +EV rule only alerts for bets with an edge of 3% or more.',
  },
  {
    id: 'discord-webhook', label: 'Discord webhook',
    definition: 'A private Discord link that lets odderjam post alerts to a channel. Optional: whoever runs the server creates one in Discord under Channel Settings, Integrations, Webhooks and adds it to the server setup.',
    example: 'https://discord.com/api/webhooks/...',
  },
];

/**
 * @param {string} id
 * @return {{id: string, label: string, definition: string, example: string}|undefined}
 */
export function findEntry(id) {
  return GLOSSARY.find((e) => e.id === id);
}

/** @return {!Array<{id: string, label: string, definition: string, example: string}>} Entries A to Z. */
export function sortedEntries() {
  return [...GLOSSARY].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Left edge for a tooltip centred on its anchor but kept inside the viewport.
 * @param {{left: number, width: number}} anchor Anchor rect.
 * @param {number} tipWidth
 * @param {number} viewportWidth
 * @param {number} margin Minimum gap to the viewport edge.
 * @return {number} Viewport x of the tooltip's left edge.
 */
export function tooltipLeft(anchor, tipWidth, viewportWidth, margin) {
  const centred = anchor.left + anchor.width / 2 - tipWidth / 2;
  const max = viewportWidth - tipWidth - margin;
  return Math.max(margin, Math.min(centred, max));
}
