/**
 * @fileoverview Pure helpers for sharp line movement on +EV rows (no React),
 * tested in linemove.test.js. `sharp_move` is the change, in percentage
 * points, of the sharps' fair probability for the row's side over 60 minutes.
 */

/** @const {number} Points of movement below which no arrow is shown. */
export const MOVE_MIN = 0.5;

/**
 * @param {?number} sharpMove The row's sharp_move.
 * @return {?{label: string, arrow: string, cls: string, tip: string}} Steam
 *     when the sharps moved toward this side, Fading when away, else null.
 */
export function moveLabel(sharpMove) {
  if (sharpMove == null || Math.abs(sharpMove) < MOVE_MIN) return null;
  const pts = Math.abs(sharpMove).toFixed(1);
  if (sharpMove > 0) {
    return {label: 'Steam', arrow: '▲', cls: 'good',
      tip: `Sharps moved ${pts} points toward this side in the last hour`};
  }
  return {label: 'Fading', arrow: '▼', cls: 'bad',
    tip: `Sharps moved ${pts} points away from this side in the last hour`};
}

/**
 * @param {?number} minutes The row's price_age_minutes.
 * @return {string} '12m' or '1h 25m'; '' when unknown.
 */
export function ageText(minutes) {
  if (minutes == null) return '';
  const m = Math.round(minutes);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * @param {{market: string, point: ?number, player: ?string}} row A +EV row.
 * @return {string} Query string for /api/history/{event_id}.
 */
export function historyQuery(row) {
  let q = `market=${encodeURIComponent(row.market)}`;
  if (row.point != null) q += `&point=${row.point}`;
  if (row.player) q += `&player=${encodeURIComponent(row.player)}`;
  return q;
}
