/** @fileoverview One-line text for the shared staking settings (no React). */

/**
 * @param {{kelly: number, round: number, max: (number|string)}} s
 * @return {string}
 */
export function stakingSummary({kelly, round, max}) {
  const rounding = round ? `round to $${round}` : 'round to cents';
  const cap = Number(max) > 0 ? `max $${max} per side` : 'no cap';
  return `Kelly ${kelly} · ${rounding} · ${cap}`;
}
