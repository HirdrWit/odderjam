/**
 * @fileoverview Pure helpers for the pick'em tab (no React), tested in
 * pickem.test.js.
 */

/** Slip sizes the backend accepts. */
const MIN_LEGS = 2;
const MAX_LEGS = 6;

/**
 * Formats a payout table {legs: {hits: multiplier}} as editable text.
 * @param {!Object<string, !Object<string, number>>} table
 * @return {string}
 */
export function formatTable(table) {
  return Object.keys(table)
      .sort((a, b) => Number(a) - Number(b))
      .map((size) => {
        const hits = Object.keys(table[size])
            .sort((a, b) => Number(b) - Number(a))
            .map((h) => `${h}=${String(table[size][h])}`);
        return `${size}: ${hits.join(', ')}`;
      })
      .join('\n');
}

/**
 * Parses text written by formatTable back into a payout table.
 * @param {string} text
 * @return {!Object<string, !Object<string, number>>}
 * @throws {Error} With the 1-based row number if a row is malformed.
 */
export function parseTableText(text) {
  const table = {};
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const fail = (why) => {
      throw new Error(`row ${i + 1}: ${why}`);
    };
    const head = line.match(/^(\d+)\s*:\s*(.+)$/);
    if (!head) fail('expected "legs: hits=multiplier, ..."');
    const legs = Number(head[1]);
    if (legs < MIN_LEGS || legs > MAX_LEGS) fail(`slips have ${MIN_LEGS} to ${MAX_LEGS} legs`);
    const row = {};
    for (const part of head[2].split(',')) {
      const pair = part.trim().match(/^(\d+)\s*=\s*(\S+)$/);
      if (!pair) fail(`bad entry "${part.trim()}"`);
      const hits = Number(pair[1]);
      const mult = Number(pair[2]);
      if (!Number.isFinite(mult)) fail(`bad multiplier "${pair[2]}"`);
      if (mult < 0) fail('negative multiplier');
      if (hits > legs) fail(`${hits} hits exceeds ${legs} legs`);
      row[String(hits)] = mult;
    }
    table[String(legs)] = row;
  });
  return table;
}

/** Sample line shown (not sent to the backend) until the user adds real lines. */
export const EXAMPLE_LINE = {player: 'LeBron James', market: 'Points', point: 24.5, side: null, example: true};

/**
 * Explains why a line has no Hit %.
 * @param {{matched: boolean, point: number}} leg
 * @return {string}
 */
export function noMatchReason(leg) {
  if (leg.matched) return '';
  return `No sportsbook has this player and market at exactly ${leg.point}. Check the spelling and the line.`;
}

/**
 * Explains why a slip size has no slips.
 * @param {number} size
 * @param {!Array<{matched: boolean}>} legs
 * @return {string}
 */
export function noSlipsReason(size, legs) {
  const matched = legs.filter((l) => l.matched).length;
  if (!matched) return 'No lines matched a sportsbook line, so there is nothing to build slips from.';
  if (matched < size) {
    return `Only ${matched} of ${legs.length} lines matched; a ${size}-pick slip needs ${size} matched lines.`;
  }
  return 'Enough lines matched, but slips cannot use two lines from the same player or the same game.';
}
