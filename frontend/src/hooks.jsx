import React, { useEffect, useState } from "react";

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

/** Show a short inline notice. kind: "ok" | "err". */
export const toast = (text, kind = "ok") => window.dispatchEvent(new CustomEvent("toast", { detail: { text, kind } }));

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let n = 0;
    const add = (e) => {
      const id = ++n;
      setItems((xs) => [...xs, { id, ...e.detail }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500);
    };
    window.addEventListener("toast", add);
    return () => window.removeEventListener("toast", add);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.kind === "err" ? "⚠ " : "✓ "}{t.text}</div>)}
    </div>
  );
}

export const postJson = (url, body, method = "POST") =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
