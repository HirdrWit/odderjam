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
