/** Columns and sort accessors for the odds-band and EV-band tables on the Tracker. */

/** @type {!Array<!Array<string>>} `[id, label, defaultDir]`. */
export const BAND_COLUMNS = [
  ['name', 'Band', 'asc'], ['bets', 'Bets', 'desc'], ['staked', 'Staked', 'desc'],
  ['profit', 'Profit', 'desc'], ['expected', 'Expected', 'desc'], ['roi', 'ROI', 'desc'],
  ['clv', 'Avg CLV', 'desc'], ['beat', 'Beat close', 'desc'],
];

export const BAND_SORT = {
  name: (g) => g.name, bets: (g) => g.bets, staked: (g) => g.staked, profit: (g) => g.profit,
  expected: (g) => g.expected_profit, roi: (g) => g.roi_pct,
  clv: (g) => g.avg_clv ?? null, beat: (g) => g.beat_close_pct ?? null,
};
