import {useEffect, useRef, useState} from 'react';

import {loadState} from './api.js';
import {REFRESH_EVENT, currentSeconds, intervalMs, tickAllowed} from './refresh.js';
import {createPoller} from './visibility.js';

/** Reads a JSON value from localStorage, or `fallback` if absent. */
export function loadStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored == null ? fallback : JSON.parse(stored);
  } catch {
    // Storage can be unavailable or hold invalid JSON; use the fallback.
    return fallback;
  }
}

/**
 * Like useState, but the value is persisted to localStorage as JSON under
 * `key`.
 * @param {string} key
 * @param {*} initial Value used when nothing is stored.
 * @return {!Array} `[value, setValue]`.
 */
export function useStored(key, initial) {
  const [value, setValue] = useState(() => loadStored(key, initial));
  const update = (next) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage full or disabled; keep the in-memory value only.
    }
  };
  return [value, update, setValue];
}

/**
 * Returns JSON fetched from `url`, refetched every `every` ms and on the
 * 'data-changed' event. A falsy `url` fetches nothing.
 * @param {?string} url
 * @param {number=} every Poll period in ms; see useApiStatus.
 * @return {*} The parsed JSON, or null until it loads.
 */
export function useApi(url, every) {
  return useApiStatus(url, every).data;
}

/**
 * Like useApi, plus whether a fetch is in flight.
 * @param {?string} url
 * @param {number=} every Poll period in ms. Left out, the odds refresh interval chosen in Settings is used
 *     (Off: no timer); a hidden tab and a fetch still running skip the tick.
 * @return {{data: *, refreshing: boolean, error: ?string, retry: function()}} `refreshing` is true while a fetch
 *     runs after data has loaded; `error` is set when the request failed.
 */
export function useApiStatus(url, every) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const goodUrl = useRef(null);
  const [odds, setOdds] = useState(currentSeconds);
  useEffect(() => {
    const sync = () => setOdds(currentSeconds());
    window.addEventListener(REFRESH_EVENT, sync);
    return () => window.removeEventListener(REFRESH_EVENT, sync);
  }, []);
  const seconds = every === undefined ? odds : every / 1000;
  useEffect(() => {
    // No url (an invalid form, say): drop the previous result so old numbers never stay on screen.
    if (!url) {
      setData(null);
      setError(null);
      return undefined;
    }
    let live = true;
    let fetching = false;
    const load = () => {
      setRefreshing(true);
      fetching = true;
      return loadState(url).then((s) => {
        if (!live) return;
        if (s.error) {
          // Keep the last good data on a failed refresh of the same url. After a url change, drop it:
          // old rows must not sit under new inputs (a new stake or filter) as if they matched.
          if (goodUrl.current !== url) setData(null);
          setError(s.error);
        } else {
          goodUrl.current = url;
          setData(s.data);
          setError(null);
        }
      }).finally(() => {
        fetching = false;
        if (live) setRefreshing(false);
      });
    };
    // A tick is skipped while the tab is hidden or the last fetch is still running, so ticks never stack.
    const tick = () => {
      if (tickAllowed({hidden: document.hidden, fetching, seconds})) load();
    };
    load();
    const ms = intervalMs(seconds);
    const stopPolling = ms === null ? () => {} : createPoller(tick, ms);
    window.addEventListener('data-changed', load);
    return () => {
      live = false;
      stopPolling();
      window.removeEventListener('data-changed', load);
    };
  }, [url, attempt, seconds]);
  const retry = () => setAttempt((n) => n + 1);
  return {data, refreshing, error, retry};
}

// Parlay slip, shared across tabs through localStorage.
const SLIP_KEY = 'parlaySlip';

/**
 * Returns the stable identity of a slip leg.
 * @param {{event_id: string, market: string, name: string, point: ?number}} leg
 * @return {string}
 */
export function legKey(leg) {
  return `${leg.event_id}|${leg.market}|${leg.name}|${leg.point}`;
}

function readSlip() {
  try {
    return JSON.parse(localStorage.getItem(SLIP_KEY)) || [];
  } catch {
    // Storage can be unavailable or hold invalid JSON; start with an empty slip.
    return [];
  }
}

/**
 * Returns the parlay slip and helpers; every instance stays in sync via the
 * 'slip-changed' event.
 * @return {{slip: !Array<!Object>, has: function(!Object): boolean,
 *     toggle: function(!Object), clear: function()}}
 */
export function useSlip() {
  const [slip, setSlip] = useState(() => readSlip());
  useEffect(() => {
    const load = () => {
      setSlip(readSlip());
    };
    window.addEventListener('slip-changed', load);
    return () => {
      window.removeEventListener('slip-changed', load);
    };
  }, []);
  const save = (next) => {
    try {
      localStorage.setItem(SLIP_KEY, JSON.stringify(next));
    } catch {
      // Storage full or disabled; the slip is lost on reload.
    }
    window.dispatchEvent(new Event('slip-changed'));
  };
  const has = (leg) => slip.some((x) => legKey(x) === legKey(leg));
  const toggle = (leg) => {
    save(has(leg) ? slip.filter((x) => legKey(x) !== legKey(leg)) : [...readSlip(), leg]);
  };
  const clear = () => {
    save([]);
  };
  return {slip, has, toggle, clear};
}
