/**
 * @fileoverview Pure helpers for the pick'em tab (no React), tested in
 * pickem.test.js.
 */

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
    if (!Number.isInteger(legs) || legs < 1) fail('bad leg count');
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
