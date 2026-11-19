/**
 * @fileoverview Arb-backed +EV rows and per-leg EV on arbs (no React), tested
 * in arbbadge.test.js.
 */

/** @const {string} */
export const ARB_BACKED_TIP = 'The other side is priced so you could bet both for a guaranteed profit, ' +
    'so at least one side has an edge';

/**
 * @param {!Object} row A /api/ev row.
 * @return {?{label: string, tip: string}} The badge, or null when the row is not one leg of an arb.
 */
export function arbBackedBadge(row) {
  return row.arb_backed ? {label: 'Arb-backed', tip: ARB_BACKED_TIP} : null;
}

/**
 * @param {boolean} on Whether "Arb-backed only" is checked.
 * @return {string} Query string fragment for /api/ev.
 */
export function arbBackedParam(on) {
  return on ? '&arb_backed=true' : '';
}

/**
 * @param {!Object} leg An /api/arbs leg.
 * @return {string} 'EV +1.23%', or '' when the leg has no fair price.
 */
export function legEvText(leg) {
  if (leg.ev_pct == null) return '';
  return `EV ${leg.ev_pct < 0 ? '-' : '+'}${Math.abs(leg.ev_pct).toFixed(2)}%`;
}
