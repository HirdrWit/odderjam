/** Columns and sort accessors for the odds-band and EV-band tables on the Tracker. */

/** @type {!Array<!Array<string>>} `[id, label, defaultDir]`. */
export const BAND_COLUMNS = [
  ['name', 'Band', 'asc'], ['bets', 'Bets', 'desc'], ['staked', 'Staked', 'desc'],
  ['profit', 'Profit', 'desc'], ['expected', 'Expected', 'desc'], ['roi', 'ROI', 'desc'],
  ['clv', 'Avg CLV', 'desc'], ['beat', 'Beat close', 'desc'],
];

/** Band labels in range order, so the Band column sorts by range, not alphabetically. */
const BAND_ORDER = [
  '-inf..-200', '-200..-110', '-110..+110', '+110..+200', '+200..+400', '+400..inf',
  '0-2', '2-4', '4-6', '6-10', '10+',
];

export const BAND_SORT = {
  name: (g) => {
    const i = BAND_ORDER.indexOf(g.name);
    return i < 0 ? BAND_ORDER.length : i;
  }, bets: (g) => g.bets, staked: (g) => g.staked, profit: (g) => g.profit,
  expected: (g) => g.expected_profit, roi: (g) => g.roi_pct,
  clv: (g) => g.avg_clv ?? null, beat: (g) => g.beat_close_pct ?? null,
};
