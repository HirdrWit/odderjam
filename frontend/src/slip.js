/**
 * @fileoverview Pure helpers for parlay slip legs (no React, so node can test them).
 */
import {formatOdds, isProp, outcomeLabel} from './odds.js';

/**
 * Builds the slip leg for an outcome clicked at one book, or null for props.
 * The book and odds record the price the leg was added at; they are not part of
 * the leg's identity (see legKey in hooks.js).
 * @param {{id: string, home: string, away: string, sport: string}} event
 * @param {string} market
 * @param {{name: string, point: ?number, prices: !Object<string, number>}} outcome
 * @param {?string=} book
 * @return {?Object}
 */
export function slipLeg(event, market, outcome, book = null) {
  if (isProp(market)) return null;
  return {
    event_id: event.id,
    event: `${event.away} @ ${event.home}`,
    sport: event.sport,
    market,
    name: outcome.name,
    point: outcome.point,
    pick: outcomeLabel(outcome),
    book,
    odds: book == null ? null : outcome.prices[book] ?? null,
  };
}

/**
 * The price a slip leg was added at, e.g. "+150 @ DraftKings"; '' when unknown.
 * @param {{odds: ?number, book: ?string}} leg
 * @param {string=} format
 * @return {string}
 */
export function slipPriceText(leg, format = 'american') {
  if (leg.odds == null || !leg.book) return '';
  return `${formatOdds(leg.odds, format)} @ ${leg.book}`;
}

/**
 * Price text for a slip leg; says why when the price is unknown.
 * @param {{odds: ?number, book: ?string}} leg
 * @param {string=} format
 * @return {string}
 */
export function slipLegPriceText(leg, format = 'american') {
  return slipPriceText(leg, format) || 'no price saved (added without a book)';
}

/**
 * @param {?number} stake Suggested stake in dollars.
 * @return {?string} Explanation for a stake under $1, else null.
 */
export function tinyStakeNote(stake) {
  if (stake == null || !(stake > 0) || stake >= 1) return null;
  return 'Stake under $1 at your bankroll: the edge is small or the odds are long.';
}

/**
 * @param {number} legCount Legs on the slip.
 * @param {boolean} restored True when the slip was loaded from storage at page load.
 * @return {?string}
 */
export function restoredNote(legCount, restored) {
  if (!restored || legCount < 1) return null;
  return 'Restored from a previous session. Use Clear slip to start over.';
}

/**
 * @param {string} method Devig method key.
 * @return {string}
 */
export function devigLabel(method) {
  return `Removing the book's margin: ${method} method (change on the +EV tab)`;
}

/** @const {string} */
export const INDEPENDENT_NOTE =
    'Independent means one leg winning does not change the chance of another, so the chances multiply.';

/** Shown on a slip leg the odds feed can no longer price. */
export const MISSING_LEG_TEXT = 'No longer offered (game started or line pulled)';

/**
 * Per slip row: whether the backend could not price it, and its fair probability.
 * The backend's `legs` holds only the priced legs, in slip order; `missing` holds
 * the slip indexes it skipped.
 * @param {number} slipLength
 * @param {?Array<{index: number}>=} missing
 * @param {?Array<{fair_prob: ?number}>=} legs
 * @return {!Array<{missing: boolean, fair: (?number|undefined)}>}
 */
export function legFairProbs(slipLength, missing, legs) {
  const gone = new Set((missing || []).map((m) => m.index));
  let next = 0;
  return Array.from({length: slipLength}, (_, i) => {
    if (gone.has(i)) return {missing: true, fair: null};
    return {missing: false, fair: legs?.[next++]?.fair_prob};
  });
}
