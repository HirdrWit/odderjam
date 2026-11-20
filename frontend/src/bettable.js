/**
 * @fileoverview "Bettable only" mode for the +EV tab: filter rows by their risk
 * flags, summarise what was hidden, badge flagged rows and persist the toggle
 * (no React), tested in bettable.test.js.
 */

/** localStorage key for the global toggle. */
export const BETTABLE_KEY = 'bettableOnly.v2';

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
  leg_skew: {
    badge: 'Legs priced apart', summary: 'legs priced apart',
    tip: 'Legs priced apart: the books last updated these prices more than 20 seconds apart, so the profit may already be gone.',
  },
  longshot_leg: {
    badge: 'Longshot leg', summary: 'longshot leg',
    tip: 'Longshot leg: one leg pays more than +1000, where small price errors look like big edges.',
  },
  sharps_disagree: {
    badge: 'Sharps disagree', summary: 'sharps disagree',
    tip: 'Sharps disagree: the sharp books do not agree on the true price, so the edge is unreliable.',
  },
  sharp_counterparty: {
    badge: 'Large order against', summary: 'large order on the other side',
    tip: 'Large order on the other side: likely a sharp bettor. Someone resting a big order against you probably has a strong view.',
  },
};

/**
 * @param {?Storage|undefined} storage
 * @return {boolean} The saved choice; OFF unless the v2 key holds "true". The old
 *     `bettableOnly` key is ignored so its stored default does not keep hiding rows.
 */
export function readBettable(storage = globalThis.localStorage) {
  try {
    return storage.getItem(BETTABLE_KEY) === 'true';
  } catch {
    // Storage can be missing or throw; the default is OFF (show every row).
    return false;
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

/**
 * @param {{flags: (!Array<string>|undefined)}} leg A parlay slip leg.
 * @param {boolean} on
 * @return {string} Warning naming each flag on the leg; '' when the mode is off or the leg is clean.
 */
export function legWarning(leg, on) {
  if (!on) return '';
  const labels = badgesFor(leg).map((b) => b.label.toLowerCase());
  return labels.length ? `Flagged: ${labels.join(', ')}. This leg's price is less reliable.` : '';
}

/**
 * @param {!Array<{flags: (!Array<string>|undefined)}>} slip
 * @param {boolean} on
 * @return {{flagged: number, summary: string, showStake: boolean}} The parlay result's flag state;
 *     the suggested stake is hidden while any leg is flagged.
 */
export function parlayFlagState(slip, on) {
  const flagged = on ? slip.filter((l) => l.flags?.length).length : 0;
  if (!flagged) return {flagged: 0, summary: '', showStake: true};
  return {flagged, summary: `${flagged} ${flagged === 1 ? 'leg' : 'legs'} flagged`, showStake: false};
}

/**
 * @param {{flags: (!Array<string>|undefined)}} leg A Pick'em leg.
 * @param {boolean} on
 * @return {string} e.g. "In-play, Stale: left out of suggested slips"; '' when off or unflagged.
 */
export function pickemLegMark(leg, on) {
  if (!on) return '';
  const labels = badgesFor(leg).map((b) => b.label);
  return labels.length ? `${labels.join(', ')}: left out of suggested slips` : '';
}

/**
 * @param {{flags: (!Array<string>|undefined)}} row
 * @return {{label: string, reasons: !Array<string>}} "Bettable" for an unflagged row, otherwise
 *     "Not bettable" with each flag's tip.
 */
export function bettableStatus(row) {
  const reasons = badgesFor(row).map((b) => b.tip);
  return reasons.length ? {label: 'Not bettable', reasons} : {label: 'Bettable', reasons: []};
}

/**
 * @param {{flags: (!Array<string>|undefined)}} row
 * @return {number} Sort key for the Status column: 0 for Bettable, 1 for Not bettable.
 */
export function bettableRank(row) {
  return row.flags?.length ? 1 : 0;
}
