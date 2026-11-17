/**
 * @fileoverview Pure helpers for the +EV Track button (no React), tested in
 * track.test.js.
 */

/**
 * @param {{stake: (number|undefined)}} row
 * @return {?number} The stake the row shows, rounded to cents, or null when it
 *     is zero or missing (the user must then enter one).
 */
export function trackStake(row) {
  const stake = Math.round(Number(row.stake) * 100) / 100;
  return stake > 0 ? stake : null;
}

/**
 * @param {{stake: (number|undefined)}} leg
 * @return {?number} The leg's stake rounded to cents, or null when it has none.
 *     Never a made-up default: a leg with no stake is refused, not logged as $1.
 */
export function legStake(leg) {
  const stake = Math.round(Number(leg.stake) * 100) / 100;
  return stake > 0 ? stake : null;
}

/**
 * Logs each leg in order and stops at the first one that fails, so the user is
 * told exactly which leg was not saved.
 * @param {!Array<{pick: string, stake: (number|undefined)}>} legs
 * @param {function(!Object): !Promise<{ok: boolean}>} post Saves one leg.
 * @return {!Promise<{ok: boolean, logged: number, failed: ?Object, message: string}>}
 */
export async function trackLegs(legs, post) {
  const missing = legs.find((leg) => legStake(leg) == null);
  if (missing) {
    return {ok: false, logged: 0, failed: missing,
      message: `No stake worked out for ${missing.pick}. Nothing was logged.`};
  }
  let logged = 0;
  for (const leg of legs) {
    let ok = false;
    try {
      ok = (await post(leg)).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      const some = logged ? ` ${logged} earlier leg${logged === 1 ? ' is' : 's are'} already in the Tracker; check it.` : '';
      return {ok: false, logged, failed: leg, message: `Could not log ${leg.pick}.${some}`};
    }
    logged += 1;
  }
  return {ok: true, logged, failed: null, message: ''};
}

/**
 * @param {?string} text What the user typed into the stake prompt.
 * @return {?number} A positive amount, or null when it is blank or invalid.
 */
export function parseStakeInput(text) {
  if (text == null) return null;
  const n = Number(String(text).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * @param {{pick: string, book: string}} row
 * @param {number} stake The stake that was logged.
 * @return {{text: string, kind: string, action: !Object}}
 */
export function trackToast(row, stake) {
  return {
    text: `Logged in Tracker: ${row.pick} @ ${row.book}, $${stake.toFixed(2)}`,
    kind: 'ok',
    action: {label: 'Open Tracker', tab: 'Tracker'},
  };
}

/**
 * @param {boolean} tracked
 * @return {string} Label for the row's Track button.
 */
export function trackButtonLabel(tracked) {
  return tracked ? '✓ Tracked' : 'Track';
}

/**
 * @param {!Object} row
 * @return {string} Stable key for "this row was already tracked".
 */
export function trackKey(row) {
  return [row.event_id, row.market, row.pick, row.point ?? '', row.book].join('|');
}

/**
 * @param {boolean} inSlip
 * @return {string} Label for the row's slip button.
 */
export function slipButtonLabel(inSlip) {
  return inSlip ? '✓ In slip' : '+ Slip';
}

/**
 * @param {string} kind 'bet', 'track' or 'slip'.
 * @param {boolean} on True when the row is tracked or in the slip.
 * @param {{pick: string, book: string}} row
 * @return {string} Accessible name that states the action and the on state in words.
 */
export function rowActionAria(kind, on, row) {
  const what = `${row.pick} at ${row.book}`;
  if (kind === 'bet') return `Bet ${what}, opens the sportsbook`;
  if (kind === 'track') return on ? `Already tracked: ${what}` : `Track ${what} in the Tracker`;
  return on ? `In slip, remove from slip: ${what}` : `Add ${what} to slip`;
}
