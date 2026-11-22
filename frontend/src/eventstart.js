// Tracker event start (odderjam-142): the Event column text, the passed / upcoming flag and the form value.
import {eventTime} from './fmt.js';

const DAY_MS = 86400000;

/** @return {?number} Epoch ms for a start time, or null when missing or unparseable. */
function startMs(start) {
  if (start == null || start === '') return null;
  const ms = new Date(start).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function dayStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Relative distance to a future start: "in 40m", "in 3h", "tomorrow", "in 3d". */
function untilLabel(ms, now) {
  const days = Math.round((dayStart(ms) - dayStart(now.getTime())) / DAY_MS);
  if (days === 1) return 'tomorrow';
  if (days >= 2) return `in ${days}d`;
  const minutes = Math.max(1, Math.round((ms - now.getTime()) / 60000));
  return minutes < 60 ? `in ${minutes}m` : `in ${Math.round(minutes / 60)}h`;
}

/**
 * What the Event cell shows for a bet.
 * @param {?string} start The bet's event_start.
 * @param {string} status The bet's status.
 * @param {!Date=} now
 * @return {{state: string, text: string, label: string, title: string}} state is
 *     'unknown', 'passed' (pending, start in the past), 'upcoming' (pending, future) or 'settled'.
 */
export function eventStartInfo(start, status, now = new Date()) {
  const ms = startMs(start);
  if (ms == null) return {state: 'unknown', text: '—', label: '', title: 'Start time unknown'};
  const text = eventTime(new Date(ms), now);
  if (status !== 'pending') return {state: 'settled', text, label: '', title: ''};
  if (ms <= now.getTime()) {
    return {state: 'passed', text, label: 'Passed', title: 'The event has started or finished and this bet is not settled yet'};
  }
  return {state: 'upcoming', text, label: untilLabel(ms, now), title: ''};
}

/** Sort key for the Event start column: epoch ms, or null (sorted last) when unknown. */
export function eventStartSortKey(bet) {
  return startMs(bet.event_start);
}

/** Converts a datetime-local form value to an ISO string for the API; blank or invalid is null. */
export function eventStartToIso(value) {
  const ms = startMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}
