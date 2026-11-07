import { useEffect, useState } from "react";

export function useStored(key, init) {
  const [v, setV] = useState(() => { try { const x = localStorage.getItem(key); return x == null ? init : JSON.parse(x); } catch { return init; } });
  return [v, (n) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch {} }];
}

export function useApi(url, every = 60000) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch(url).then((r) => r.json()).then((d) => live && setData(d));
    load();
    const t = setInterval(load, every);
    window.addEventListener("data-changed", load);
    return () => { live = false; clearInterval(t); window.removeEventListener("data-changed", load); };
  }, [url]);
  return data;
}
