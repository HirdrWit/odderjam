/**
 * @fileoverview Pure helpers for the Promos table (no React), tested in promos.test.js.
 */

/** @const {!Array<!Array<string>>} Column id, header label and first-click direction. */
export const PROMO_COLUMNS = [
  ['conversion', 'Conversion %', 'desc'], ['locked', 'Locked $', 'desc'],
  ['event', 'Event'], ['bonus', 'Bonus leg'], ['hedge', 'Hedge leg'],
];

export const PROMO_NUM = new Set(['conversion', 'locked']);

export const PROMO_DEFAULT_SORT = {key: 'conversion', dir: 'desc'};

/**
 * @param {!Object} row A /api/promo row.
 * @return {{bonus: !Object, hedge: !Object}} The promo leg and the other leg.
 */
export function promoLegs(row) {
  const bonus = row.legs.find((l) => l.promo) ?? row.legs[0];
  return {bonus, hedge: row.legs.find((l) => l !== bonus)};
}

/**
 * @param {?Object} leg
 * @return {string} "pick @ book", or '' for a missing leg.
 */
function legLabel(leg) {
  return leg ? `${leg.pick} @ ${leg.book}` : '';
}

export const PROMO_SORT = {
  conversion: (r) => r.conversion_pct,
  locked: (r) => r.profit,
  event: (r) => r.event,
  bonus: (r) => legLabel(promoLegs(r).bonus),
  hedge: (r) => legLabel(promoLegs(r).hedge),
};
