/**
 * @fileoverview Pure staleness logic for the freshness strip and stale rows
 * (no React), tested in freshness.test.js.
 */
import {ageText} from './odds.js';

export const STALE_PREGAME_SECONDS = 600;
export const STALE_LIVE_SECONDS = 60;

/** Tabs that show prices, and so show the freshness strip. */
export const PRICE_TABS = [
  'Odds Screen', '+EV', 'Parlay', 'Arbitrage', 'Low Hold', 'Middles', 'Sharp Money', 'Promos',
];

/**
 * @param {string} tab
 * @return {boolean}
 */
export function showsStrip(tab) {
  return PRICE_TABS.includes(tab);
}

/**
 * @param {?number=} seconds Price age.
 * @param {boolean} live True for an in-play game or live mode.
 * @return {boolean} True once the price is older than the threshold.
 */
export function isStale(seconds, live) {
  if (seconds == null) return false;
  return seconds > (live ? STALE_LIVE_SECONDS : STALE_PREGAME_SECONDS);
}

/**
 * @param {?number=} seconds
 * @return {string} Accessible description of the price age.
 */
export function ageLabel(seconds) {
  if (seconds == null) return 'Price age unknown';
  return `Prices are ${ageText(seconds)} old`;
}

/**
 * @param {{price_age_seconds: ?number, live: ?boolean}} row
 * @return {{stale: boolean, className: string, label: string}}
 */
export function rowFreshness(row) {
  const stale = isStale(row.price_age_seconds, !!row.live);
  const base = ageLabel(row.price_age_seconds);
  return {
    stale,
    className: stale ? 'stale' : '',
    label: stale ? `Stale: ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base,
  };
}

/**
 * @param {number} seconds
 * @return {string}
 */
function agoText(seconds) {
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${(seconds / 3600).toFixed(1)}h ago`;
}

/**
 * @param {{live: boolean, age_seconds: ?number}} info The /api/cache payload.
 * @param {boolean} liveMode True when live mode refreshes automatically.
 * @return {{stale: boolean, text: string, mock: boolean}}
 */
export function stripState(info, liveMode) {
  if (!info.live) return {stale: false, text: 'Mock data', mock: true};
  const age = info.age_seconds;
  return {
    stale: isStale(age, liveMode),
    text: `Live odds · updated ${age == null ? 'never' : agoText(age)}`,
    mock: false,
  };
}

/**
 * @param {?{status: ?number, at: number}=} err The provider's last failure; `at` is epoch seconds.
 * @return {?string} Text for the freshness strip, or null when the provider is fine.
 */
export function providerErrorText(err) {
  if (!err) return null;
  const since = new Date(err.at * 1000).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  let why = 'offline or timed out';
  if (err.status === 401 || err.status === 403) why = 'API key invalid or out of credits';
  else if (err.status === 429) why = 'rate limited';
  else if (err.status != null) why = `returned an error (${err.status})`;
  return `Odds provider: ${why} since ${since}. Prices may be out of date.`;
}

/**
 * @param {?{remaining: ?(string|number), last_cost: ?(string|number)}} info The /api/cache payload.
 * @return {?string} "134 credits left · last fetch 6", or null when the credits are unknown.
 */
export function creditsText(info) {
  const left = info?.remaining;
  if (left == null || left === '' || !Number.isFinite(Number(left))) return null;
  const n = Number(left);
  const text = `${n} credit${n === 1 ? '' : 's'} left`;
  const last = info.last_cost;
  if (last == null || last === '' || !Number.isFinite(Number(last))) return text;
  return `${text} · last fetch ${Number(last)}`;
}
