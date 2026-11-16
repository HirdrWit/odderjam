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
