/**
 * @fileoverview Visibility-aware polling (no React), tested in visibility.test.js.
 * A hidden tab must not poll, because polls can lead to Odds API fetches that spend credits.
 */

/**
 * Runs `fn` every `ms` while the document is visible; stops the timer while hidden.
 * @param {function()} fn
 * @param {number} ms
 * @param {{doc: !Object, setInterval: function(), clearInterval: function()}=} env For tests.
 * @param {function()=} onShow Called each time the document becomes visible again.
 * @return {function()} Stop function.
 */
export function createPoller(fn, ms, env = {doc: document, setInterval: (...a) => window.setInterval(...a),
  clearInterval: (...a) => window.clearInterval(...a)}, onShow = undefined) {
  let timer = null;
  const start = () => {
    if (timer == null) timer = env.setInterval(fn, ms);
  };
  const stop = () => {
    if (timer != null) env.clearInterval(timer);
    timer = null;
  };
  const onChange = () => {
    if (env.doc.visibilityState === 'hidden') {
      stop();
    } else {
      start();
      if (onShow) onShow();
    }
  };
  if (env.doc.visibilityState !== 'hidden') start();
  env.doc.addEventListener('visibilitychange', onChange);
  return () => {
    stop();
    env.doc.removeEventListener('visibilitychange', onChange);
  };
}

/**
 * @param {?number} ageSeconds Age of the cached data; null when unknown.
 * @param {?number} ttlSeconds Refresh interval; null when auto-refresh is Off.
 * @return {boolean} True when a tab that just became visible should ask for fresh data. Never when Off.
 */
export function shouldRefreshOnShow(ageSeconds, ttlSeconds) {
  if (ttlSeconds === null) return false;
  return ageSeconds == null || ageSeconds > ttlSeconds;
}
