// Pure helpers for the odds screen (no React), tested in odds.test.js.
import { americanToDecimal, americanToProb, probToAmerican, multiplicative, hold } from "./calc.js";

export const FORMATS = { american: "American", decimal: "Decimal", prob: "Implied %" };

/** Format an American price in the chosen odds format. */
export function formatOdds(american, format = "american") {
  if (american == null || !Number.isFinite(american)) return "";
  if (format === "decimal") return americanToDecimal(american).toFixed(2);
  if (format === "prob") return `${(americanToProb(american) * 100).toFixed(1)}%`;
  const a = Math.round(american);
  return a > 0 ? `+${a}` : `${a}`;
}

const pt = (p, total) => (p == null ? "" : total ? `${p}` : p > 0 ? `+${p}` : `${p}`);
export const outcomeLabel = (o) =>
  `${o.name}${o.point == null ? "" : ` ${pt(o.point, o.name === "Over" || o.name === "Under")}`}`;

/** Mirror of backend/engine/markets.py line_key: one shared perspective per line. */
function lineKey(market, o, home) {
  if (o.point == null || market === "moneyline") return null;
  if (market === "spreads" && o.name !== home) return -o.point;
  return o.point;
}

function requiredNames(market, outcomes, home, away) {
  if (market === "totals") return ["Over", "Under"];
  if (market === "moneyline" || market === "spreads") {
    const names = [home, away];
    if (market === "moneyline" && outcomes.some((o) => o.name === "Draw")) names.push("Draw");
    return names;
  }
  return null; // unknown market (props etc.): group by line, take whatever sides exist
}

/**
 * Group a market's outcomes into lines: [{point, outcomes, complete}].
 * `complete` lines have every mutually exclusive side, so hold and fair price apply.
 */
export function lineGroups(market, outcomes, home, away) {
  const names = requiredNames(market, outcomes, home, away);
  const byLine = new Map();
  for (const o of outcomes) {
    if (names && !names.includes(o.name)) continue;
    const k = lineKey(market, o, home);
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(o);
  }
  const groups = [...byLine.entries()].map(([point, outs]) => {
    const order = names || [...new Set(outs.map((o) => o.name))];
    const sorted = order.map((n) => outs.find((o) => o.name === n)).filter(Boolean);
    return { point, outcomes: sorted, complete: !!names && sorted.length === names.length };
  });
  return groups.sort((a, b) => (a.point == null) - (b.point == null) || (a.point ?? 0) - (b.point ?? 0));
}

/** Best (highest) price for an outcome among the given books: {book, price} or null. */
export function bestPrice(outcome, books) {
  let best = null;
  for (const b of books) {
    const p = outcome.prices[b];
    if (p != null && (!best || americanToDecimal(p) > americanToDecimal(best.price))) best = { book: b, price: p };
  }
  return best;
}

/**
 * Stats for a line group among the given books:
 * best price per outcome, hold at those best prices, and no-vig fair price per outcome
 * (multiplicative devig of each book that prices every side, then averaged).
 */
export function groupStats(group, books) {
  const best = group.outcomes.map((o) => bestPrice(o, books));
  const out = { best, holdPct: null, fair: group.outcomes.map(() => null), bookCount: 0 };
  if (!group.complete) return out;
  if (best.every(Boolean)) out.holdPct = hold(best.map((b) => b.price)).hold_pct;
  const full = books.filter((b) => group.outcomes.every((o) => o.prices[b] != null));
  out.bookCount = full.length;
  if (full.length) {
    const sums = group.outcomes.map(() => 0);
    for (const b of full) multiplicative(group.outcomes.map((o) => americanToProb(o.prices[b]))).forEach((p, i) => (sums[i] += p));
    out.fair = sums.map((s) => probToAmerican(s / full.length));
  }
  return out;
}

/** The line most books hang (the "main" line), for the collapsed event summary. */
export function mainGroup(groups, books) {
  const count = (g) => books.filter((b) => g.outcomes.every((o) => o.prices[b] != null)).length;
  return groups.reduce((a, g) => (!a || count(g) > count(a) ? g : a), null);
}

/** Filter by team search and sort events by start time. */
export function filterEvents(events, query = "") {
  const q = query.trim().toLowerCase();
  return events
    .filter((e) => !q || e.home.toLowerCase().includes(q) || e.away.toLowerCase().includes(q))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/** All books that appear anywhere in the events, in first-seen order. */
export function allBooks(events) {
  const s = new Set();
  for (const e of events) for (const outs of Object.values(e.markets)) for (const o of outs) Object.keys(o.prices).forEach((b) => s.add(b));
  return [...s];
}
