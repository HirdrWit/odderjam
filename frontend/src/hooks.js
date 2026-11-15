import { useEffect, useState } from 'react';

/** Returns [value, setter] for state persisted to localStorage as JSON under key. */
export function useStored(key, init) {
  const [v, setV] = useState(() => {
    try {
      const x = localStorage.getItem(key);
      return x == null ? init : JSON.parse(x);
    } catch {
      return init;
    }
  });
  return [v, (n) => {
    setV(n);
    try {
      localStorage.setItem(key, JSON.stringify(n));
    } catch {
      // Storage full or disabled; keep the in-memory value only.
    }
  }];
}

/** Returns JSON fetched from url, refetched every `every` ms and on the data-changed event. */
export function useApi(url, every = 60000) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    const load = () => fetch(url).then((r) => r.json()).then((d) => {
      if (live) setData(d);
    });
    load();
    const t = setInterval(load, every);
    window.addEventListener('data-changed', load);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener('data-changed', load);
    };
  }, [url]);
  return data;
}

// Parlay slip, shared across tabs through localStorage.
const SLIP_KEY = 'parlaySlip';

/** Stable identity of a slip leg. */
export const legKey = (l) => `${l.event_id}|${l.market}|${l.name}|${l.point}`;

function readSlip() {
  try {
    return JSON.parse(localStorage.getItem(SLIP_KEY)) || [];
  } catch {
    return [];
  }
}

/** Returns the parlay slip and helpers; every instance stays in sync via the slip-changed event. */
export function useSlip() {
  const [slip, setSlip] = useState(readSlip);
  useEffect(() => {
    const load = () => setSlip(readSlip());
    window.addEventListener('slip-changed', load);
    return () => window.removeEventListener('slip-changed', load);
  }, []);
  const save = (n) => {
    try {
      localStorage.setItem(SLIP_KEY, JSON.stringify(n));
    } catch {
      // Storage full or disabled; the slip is lost on reload.
    }
    window.dispatchEvent(new Event('slip-changed'));
  };
  const has = (l) => slip.some((x) => legKey(x) === legKey(l));
  const toggle = (l) => save(has(l) ? slip.filter((x) => legKey(x) !== legKey(l)) : [...readSlip(), l]);
  return { slip, has, toggle, clear: () => save([]) };
}
