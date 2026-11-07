// Pure helpers for the Tracker charts (no React, so they run under node --test).

// Diverging P/L scale: blue = profit, red = loss, gray midpoint. Validated for CVD on the dark surface.
export const PROFIT = "#3b82f6", LOSS = "#e5534b", NEUTRAL = "#383835";

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;

/** Cell color for a day's profit, scaled against the largest absolute daily P/L. */
export function plColor(profit, maxAbs) {
  if (!profit || !maxAbs) return NEUTRAL;
  const t = 0.3 + 0.7 * Math.min(1, Math.abs(profit) / maxAbs); // never fade all the way to gray
  const [a, b] = [rgb(NEUTRAL), rgb(profit > 0 ? PROFIT : LOSS)];
  return hex(a.map((x, i) => x + (b[i] - x) * t));
}

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Weeks (Sun..Sat) for a month (0-based), each cell {date, day} or null for padding. */
export function calendarWeeks(year, month) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => ({ date: iso(year, month, i + 1), day: i + 1 }))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Scale daily rows [{date, cumulative}] to SVG points inside w x h (with pad). Includes the 0 line. */
export function scaleSeries(rows, w, h, pad = 4) {
  const ys = [0, ...rows.map((r) => r.cumulative)];
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const x = (i) => pad + (rows.length < 2 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (rows.length - 1));
  const y = (v) => pad + ((hi - v) * (h - 2 * pad)) / span;
  return { points: rows.map((r, i) => [x(i), y(r.cumulative)]), zeroY: y(0), lo, hi };
}

/** Query string for the tracker filters, dropping empty values. */
export const filterQuery = (f) => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
