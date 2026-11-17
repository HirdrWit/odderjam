/**
 * @param {{window: number, low: number, high: number}} row A /api/middles row.
 * @return {string} The window with its unit and both lines, e.g. "1 point (226.5 to 227.5)".
 */
export function windowText(row) {
  const unit = row.window === 1 ? 'point' : 'points';
  return `${row.window} ${unit} (${row.low} to ${row.high})`;
}
