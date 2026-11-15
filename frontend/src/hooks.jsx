import React, { useEffect, useState } from "react";

export { useApi, useStored } from "./hooks.js";

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
