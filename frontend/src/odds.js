/**
 * @fileoverview Pure helpers for the odds screen (no React), tested in
 * odds.test.js.
 */

import {
  americanToDecimal,
  americanToProb,
  hold,
  multiplicative,
  probToAmerican,
} from './calc.js';

/**
 * Odds display formats: key -> label.
 * @const {!Object<string, string>}
 */
export const FORMATS = {american: 'American', decimal: 'Decimal', prob: 'Implied %'};

/**
 * Formats an American price in the chosen odds format.
 * @param {?number} american
 * @param {string=} format One of the FORMATS keys.
 * @return {string} The formatted price, or '' if there is no price.
 */
export function formatOdds(american, format = 'american') {
  if (american == null || !Number.isFinite(american)) return '';
  if (format === 'decimal') return americanToDecimal(american).toFixed(2);
  if (format === 'prob') return `${(americanToProb(american) * 100).toFixed(1)}%`;
  const rounded = Math.round(american);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** Formats a spread or total line; spreads get a leading sign. */
function formatPoint(point, isTotal) {
  if (point == null) return '';
  if (isTotal) return `${point}`;
  return point > 0 ? `+${point}` : `${point}`;
}

/**
 * Returns true for player prop markets (mirror of backend/engine/markets.py
 * is_prop).
 * @param {string} market
 * @return {boolean}
 */
export function isProp(market) {
  return /^(player|batter|pitcher)_/.test(market);
}

/**
 * Labels an outcome, e.g. "Lakers -3.5", "Over 220.5" or "LeBron James Over
 * 25.5".
 * @param {{name: string, point: ?number, player: (?string|undefined)}} outcome
 * @return {string}
 */
export function outcomeLabel(outcome) {
  const isTotal = outcome.name === 'Over' || outcome.name === 'Under';
  const point = outcome.point == null ? '' : ` ${formatPoint(outcome.point, isTotal)}`;
  const text = `${outcome.name}${point}`;
  return outcome.player ? `${outcome.player} ${text}` : text;
}

/** Mirror of backend/engine/markets.py line_key: one shared perspective per line. */
function lineKey(market, outcome, home) {
  if (outcome.point == null || market === 'moneyline') return null;
  if (market === 'spreads' && outcome.name !== home) return -outcome.point;
  return outcome.point;
}

function requiredNames(market, outcomes, home, away) {
  if (market === 'totals' || isProp(market)) return ['Over', 'Under'];
  if (market === 'moneyline' || market === 'spreads') {
    const names = [home, away];
    if (market === 'moneyline' && outcomes.some((o) => o.name === 'Draw')) {
      names.push('Draw');
    }
    return names;
  }
  return null; // Unknown market: group by line, take whatever sides exist.
}

/**
 * Groups a market's outcomes into lines. Props are grouped per player as well
 * as per line. `complete` lines have every mutually exclusive side, so hold
 * and fair price apply.
 * @param {string} market
 * @param {!Array<!Object>} outcomes
 * @param {string} home
 * @param {string} away
 * @return {!Array<{player: ?string, point: ?number, outcomes: !Array<!Object>,
 *     complete: boolean}>}
 */
export function lineGroups(market, outcomes, home, away) {
  const names = requiredNames(market, outcomes, home, away);
  const byLine = new Map();
  for (const o of outcomes) {
    if (names && !names.includes(o.name)) continue;
    const player = o.player ?? null;
    const point = lineKey(market, o, home);
    const key = JSON.stringify([player, point]);
    if (!byLine.has(key)) byLine.set(key, {player, point, outs: []});
    byLine.get(key).outs.push(o);
  }
  const groups = [...byLine.values()].map(({player, point, outs}) => {
    const order = names || [...new Set(outs.map((o) => o.name))];
    const sorted = order.map((n) => outs.find((o) => o.name === n)).filter((x) => x != null);
    return {
      player,
      point,
      outcomes: sorted,
      complete: Boolean(names) && sorted.length === names.length,
    };
  });
  return groups.sort((a, b) => (a.player ?? '').localeCompare(b.player ?? '') ||
      (a.point == null) - (b.point == null) || (a.point ?? 0) - (b.point ?? 0));
}

/** Best-price hold below this is impossible for a real market (mirror of backend/engine/suspect.py). */
export const HOLD_FLOOR_PCT = -10;
/** |American odds| above this on a spread or total is a stale or mismatched price. */
export const ODDS_CAP = 5000;

/**
 * True when a line's prices look stale or mismatched: the hold at the best
 * prices is below the floor, or a spread/total price is beyond the cap. The
 * Odds Screen uses this; backend/engine/suspect.py is the scanners' copy.
 * @param {string} market
 * @param {{outcomes: !Array<!Object>}} group
 * @param {!Array<string>=} books Books to look at; all books when omitted.
 * @return {boolean}
 */
export function isSuspectMarket(market, group, books) {
  const sides = group.outcomes.map((o) => Object.entries(o.prices)
      .filter(([book, p]) => p != null && (!books || books.includes(book)))
      .map(([, p]) => p));
  if ((market === 'spreads' || market === 'totals') &&
      sides.some((side) => side.some((p) => Math.abs(p) > ODDS_CAP))) {
    return true;
  }
  if (sides.length && sides.every((side) => side.length)) {
    return hold(sides.map((side) => Math.max(...side))).holdPct < HOLD_FLOOR_PCT;
  }
  return false;
}

/**
 * Returns the best (highest) price for an outcome among the given books.
 * @param {{prices: !Object<string, number>}} outcome
 * @param {!Array<string>} books
 * @return {?{book: string, price: number}}
 */
export function bestPrice(outcome, books) {
  let best = null;
  for (const book of books) {
    const price = outcome.prices[book];
    if (price != null &&
        (!best || americanToDecimal(price) > americanToDecimal(best.price))) {
      best = {book, price};
    }
  }
  return best;
}

/**
 * Returns stats for a line group among the given books: best price per
 * outcome, hold at those best prices, and no-vig fair price per outcome
 * (multiplicative devig of each book that prices every side, then averaged).
 * @param {{outcomes: !Array<!Object>, complete: boolean}} group
 * @param {!Array<string>} books
 * @return {{best: !Array<?{book: string, price: number}>, holdPct: ?number,
 *     fair: !Array<?number>, bookCount: number}}
 */
export function groupStats(group, books, market = null) {
  const suspect = market != null && isSuspectMarket(market, group, books);
  const best = suspect ? group.outcomes.map(() => null) : group.outcomes.map((o) => bestPrice(o, books));
  const out = {best, holdPct: null, fair: group.outcomes.map(() => null), bookCount: 0, suspect};
  if (suspect || !group.complete) return out;
  if (best.every((b) => b != null)) out.holdPct = hold(best.map((b) => b.price)).holdPct;
  const full = books.filter((b) => group.outcomes.every((o) => o.prices[b] != null));
  out.bookCount = full.length;
  if (full.length) {
    const sums = group.outcomes.map(() => 0);
    for (const book of full) {
      const probs = group.outcomes.map((o) => americanToProb(o.prices[book]));
      multiplicative(probs).forEach((p, i) => {
        sums[i] += p;
      });
    }
    out.fair = sums.map((s) => probToAmerican(s / full.length));
  }
  return out;
}

/**
 * Returns the line most books hang (the "main" line), for the collapsed event
 * summary.
 * @param {!Array<{outcomes: !Array<!Object>}>} groups
 * @param {!Array<string>} books
 * @return {?Object}
 */
export function mainGroup(groups, books) {
  const count = (g) => books.filter((b) => g.outcomes.every((o) => o.prices[b] != null)).length;
  return groups.reduce((a, g) => (!a || count(g) > count(a) ? g : a), null);
}

/**
 * Filters events by team search and sorts them by start time.
 * @param {!Array<!Object>} events
 * @param {string=} query
 * @return {!Array<!Object>}
 */
export function filterEvents(events, query = '') {
  const needle = query.trim().toLowerCase();
  return events
      .filter((e) => !needle || e.home.toLowerCase().includes(needle) ||
          e.away.toLowerCase().includes(needle))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/**
 * Returns all books that appear anywhere in the events, in first-seen order.
 * @param {!Array<!Object>} events
 * @return {!Array<string>}
 */
export function allBooks(events) {
  const books = new Set();
  for (const e of events) {
    for (const outs of Object.values(e.markets)) {
      for (const o of outs) {
        for (const book of Object.keys(o.prices)) {
          books.add(book);
        }
      }
    }
  }
  return [...books];
}

/** Compact price age, e.g. "12s", "4m", "1.5h"; "—" when unknown. */
export function ageText(seconds) {
  if (seconds == null) return '—';
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Splits events into {live, upcoming} by their live flag, keeping order. */
export function splitLive(events) {
  return {live: events.filter((e) => e.live), upcoming: events.filter((e) => !e.live)};
}
