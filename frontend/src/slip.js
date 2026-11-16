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
