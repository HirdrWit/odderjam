/**
 * @fileoverview "Bettable only" mode for the +EV tab: filter rows by their risk
 * flags, summarise what was hidden, badge flagged rows and persist the toggle
 * (no React), tested in bettable.test.js.
 */

/** localStorage key for the global toggle. */
export const BETTABLE_KEY = 'bettableOnly';

/** Window event fired when the toggle changes, so every tab's hook updates. */
export const BETTABLE_EVENT = 'odderjam:bettable';

/**
 * Per-flag copy: `badge` is the row badge, `summary` the wording in the hidden
 * count, `tip` the plain-English tooltip. Order is the order shown.
 * @const {!Object<string, {badge: string, summary: string, tip: string}>}
 */
export const FLAGS = {
  in_play: {
    badge: 'In-play', summary: 'in-play',
    tip: 'In-play price may be stale: the game is live and prices move faster than this data.',
  },
  longshot: {
    badge: 'Longshot', summary: 'longshot',
    tip: 'Longshot: small errors look like big edges, and losing streaks are long.',
  },
  heavy_fav: {
    badge: 'Heavy favourite', summary: 'heavy favourite',
    tip: 'Heavy favourite: you risk a lot to win a little, so one loss erases many wins.',
  },
  too_good: {
    badge: 'Too good to be true', summary: 'too good to be true',
    tip: 'Too good to be true: an edge this big is usually a bad line or a mismatched market.',
  },
  fragile: {
    badge: 'Fragile edge', summary: 'fragile edge',
    tip: 'Fragile edge: the bet is only +EV under one way of removing the margin.',
  },
  sharps_disagree: {
    badge: 'Sharps disagree', summary: 'sharps disagree',
    tip: 'Sharps disagree: the sharp books do not agree on the true price, so the edge is unreliable.',
  },
};

/**
 * @param {?Storage|undefined} storage
 * @return {boolean} The saved choice; ON when nothing usable is saved.
 */
export function readBettable(storage = globalThis.localStorage) {
  try {
    return storage.getItem(BETTABLE_KEY) === 'false' ? false : true;
  } catch {
    // Storage can be missing or throw; the safe default is ON.
    return true;
  }
}

/**
 * @param {?Storage|undefined} storage
 * @param {boolean} on
 */
export function writeBettable(storage, on) {
  try {
    storage.setItem(BETTABLE_KEY, String(on));
  } catch {
    // Storage full or disabled; the choice lasts for this page only.
  }
}

/**
 * @param {!Array<{flags: (!Array<string>|undefined)}>} rows
 * @param {boolean} on
 * @return {{shown: !Array, hidden: !Array}} With the mode on, flagged rows are hidden.
 */
export function filterBettable(rows, on) {
  if (!on) return {shown: rows, hidden: []};
  const shown = [];
  const hidden = [];
  for (const row of rows) (row.flags?.length ? hidden : shown).push(row);
  return {shown, hidden};
}

/**
 * @param {!Array<{flags: !Array<string>}>} hidden Rows hidden by the mode.
 * @return {string} e.g. "14 hidden: 8 in-play, 4 longshot"; '' when none.
 */
export function hiddenSummary(hidden) {
  if (!hidden.length) return '';
  const counts = {};
  for (const row of hidden) for (const f of row.flags) counts[f] = (counts[f] || 0) + 1;
  const known = Object.keys(FLAGS).filter((f) => counts[f]);
  const unknown = Object.keys(counts).filter((f) => !FLAGS[f]);
  const parts = [...known.map((f) => `${counts[f]} ${FLAGS[f].summary}`),
    ...unknown.map((f) => `${counts[f]} ${f.replace(/_/g, ' ')}`)];
  return `${hidden.length} hidden: ${parts.join(', ')}`;
}

/**
 * @param {{flags: (!Array<string>|undefined)}} row
 * @return {!Array<{flag: string, label: string, tip: string}>} One badge per flag.
 */
export function badgesFor(row) {
  return (row.flags || []).map((flag) => {
    const info = FLAGS[flag];
    const label = info ? info.badge : flag.replace(/_/g, ' ');
    return {flag, label, tip: info ? info.tip : `${label}: this price carries extra risk.`};
  });
}

/**
 * @param {boolean} on
 * @return {?{label: string}} The filter chip, only while the mode is off.
 */
export function bettableChip(on) {
  return on ? null : {label: 'Bettable only: off'};
}

/** @return {boolean} The mode value after "Show anyway". */
export function showAnyway() {
  return false;
}
