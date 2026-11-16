import {useEffect, useState} from 'react';

/** Reads a JSON value from localStorage, or `fallback` if absent. */
function loadStored(key, fallback) {
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
  return [value, update];
}

/**
 * Returns JSON fetched from `url`, refetched every `every` ms and on the
 * 'data-changed' event. A falsy `url` fetches nothing.
 * @param {?string} url
 * @param {number=} every
 * @return {*} The parsed JSON, or null until it loads.
 */
export function useApi(url, every = 60000) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    const load = () => fetch(url).then((r) => r.json()).then((d) => {
      if (live) setData(d);
    });
    load();
    const timer = setInterval(load, every);
    window.addEventListener('data-changed', load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('data-changed', load);
    };
  }, [url]);
  return data;
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
