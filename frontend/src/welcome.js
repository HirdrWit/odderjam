/**
 * @fileoverview First-visit welcome banner state (no React), tested in
 * welcome.test.js. Every storage call is guarded: storage can be missing or
 * throw (private mode, blocked cookies).
 */

export const WELCOME_KEY = 'welcomeDismissed';

/**
 * @param {?Storage=} storage Defaults to localStorage.
 * @return {boolean} True until the visitor has dismissed the banner.
 */
export function shouldShowWelcome(storage = globalThis.localStorage) {
  try {
    return storage.getItem(WELCOME_KEY) == null;
  } catch {
    // Storage unavailable; treat as a first visit.
    return true;
  }
}

/**
 * Remembers that the visitor dismissed the banner.
 * @param {?Storage=} storage Defaults to localStorage.
 */
export function dismissWelcome(storage = globalThis.localStorage) {
  try {
    storage.setItem(WELCOME_KEY, '1');
  } catch {
    // Storage unavailable; the banner just returns on the next visit.
  }
}
