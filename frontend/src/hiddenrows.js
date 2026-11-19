/**
 * @fileoverview Pure helpers for hidden +EV rows (no React), tested in
 * hiddenrows.test.js. The server marks each row `hidden`: 'hidden' (the user
 * hid it), 'tracked' (already in the Tracker) or null.
 */

/**
 * @param {*} rows The /api/ev?show_hidden=true response.
 * @param {boolean} show Whether hidden rows stay in the table.
 * @return {{visible: !Array<!Object>, hidden: number, tracked: number}}
 */
export function splitHidden(rows, show) {
  const all = Array.isArray(rows) ? rows : [];
  const marked = all.filter((r) => r.hidden);
  return {
    visible: show ? all : all.filter((r) => !r.hidden),
    hidden: marked.length,
    tracked: marked.filter((r) => r.hidden === 'tracked').length,
  };
}

/**
 * @param {{hidden: number, tracked: number}} counts
 * @return {string} 'N hidden (M already tracked)', or '' when nothing is hidden.
 */
export function hiddenSummary({hidden, tracked}) {
  if (!hidden) return '';
  return tracked ? `${hidden} hidden (${tracked} already tracked)` : `${hidden} hidden`;
}
