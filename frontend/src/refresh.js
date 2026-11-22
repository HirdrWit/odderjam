/**
 * @fileoverview Auto-refresh interval helpers (no React), tested in refresh.test.js.
 * The chosen interval is saved on the server; this module holds the copy the pollers read.
 */

/** @const {!Array<number>} Seconds between refreshes; 0 is Off. */
export const CHOICES = [0, 1, 5, 10, 30, 60, 300, 900, 1800, 3600, 7200];

/** @const {string} Event fired when the interval changes. */
export const REFRESH_EVENT = 'odderjam:refresh-interval';

/** @const {number} Used until the server answers: the old fixed pace (60s poll, 120m cache). */
const FALLBACK_SECONDS = 60;

let current = null;

/**
 * @param {number} seconds Choice in seconds.
 * @return {string} "Off", "30s", "5m".
 */
export function choiceLabel(seconds) {
  if (seconds === 0) return 'Off';
  return seconds > 60 ? `${seconds / 60}m` : `${seconds}s`;
}

function leftText(hours) {
  const minutes = hours * 60;
  if (minutes < 1) return `~${Math.max(1, Math.round(minutes * 60))} s left`;
  if (minutes < 60) return `~${Math.round(minutes)} min left`;
  if (hours < 48) return `~${Math.round(hours)} h left`;
  return `~${Math.round(hours / 24)} days left`;
}

/**
 * @param {{seconds: number, credits_per_hour: number, hours_left: ?number}} option From /api/refresh-interval.
 * @return {string} "30s · 720 credits/h · ~11 min left"; without the last part when remaining is unknown.
 */
export function optionText(option) {
  const label = choiceLabel(option.seconds);
  if (option.seconds === 0) return `${label} · 0 credits/h`;
  const perHour = Math.round(option.credits_per_hour);
  const text = `${label} · ${perHour} credits/h`;
  return option.hours_left == null ? text : `${text} · ${leftText(option.hours_left)}`;
}

/**
 * @param {?number=} seconds Chosen interval.
 * @return {?number} Milliseconds between timer ticks, or null for Off or an unknown value.
 */
export function intervalMs(seconds) {
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * @param {{hidden: boolean, fetching: boolean, seconds: ?number}} state
 * @return {boolean} True when a timer tick may start a fetch.
 */
export function tickAllowed({hidden, fetching, seconds}) {
  return !hidden && !fetching && intervalMs(seconds) !== null;
}

/** @return {number} Seconds between odds refetches (0 = Off). */
export function currentSeconds() {
  return current ?? FALLBACK_SECONDS;
}

/** @param {number} seconds New interval; tells the mounted pollers. */
export function setCurrentSeconds(seconds) {
  if (seconds === current) return;
  current = seconds;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT));
}

/** Loads the saved interval from the server. A failure keeps the fallback pace. */
export function loadInterval() {
  return fetch('/api/refresh-interval').then((r) => {
    if (!r.ok) throw new Error('bad status');
    return r.json();
  }).then((body) => setCurrentSeconds(body.seconds)).catch(() => {});
}
