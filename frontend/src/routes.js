/**
 * @fileoverview Hash routes: tab <-> `#/slug?filters` (no React), tested in
 * routes.test.js.
 */

/** @const {!Object<string, string>} Tab name to URL slug. */
export const TAB_SLUGS = {
  'Odds Screen': 'odds',
  '+EV': 'ev',
  'Parlay': 'parlay',
  'Arbitrage': 'arbitrage',
  'Low Hold': 'lowhold',
  'Middles': 'middles',
  'Sharp Money': 'sharp',
  'Promos': 'promos',
  'Pick\'em': 'pickem',
  'Calculator': 'calculator',
  'Tracker': 'tracker',
  'Alerts': 'alerts',
  'Help': 'help',
};

const SLUG_TABS = {...Object.fromEntries(Object.entries(TAB_SLUGS).map(([t, s]) => [s, t])), glossary: 'Help'};

/**
 * @param {string} hash Location hash, e.g. `#/ev?min=2`.
 * @return {{tab: ?string, params: !Object<string, string>}} Tab (null if unknown) and filters.
 */
export function parseHash(hash) {
  const m = /^#\/([^?]*)(?:\?(.*))?$/.exec(hash || '');
  if (!m) return {tab: null, params: {}};
  const tab = Object.hasOwn(SLUG_TABS, m[1]) ? SLUG_TABS[m[1]] : null;
  return {tab, params: Object.fromEntries(new URLSearchParams(m[2] || ''))};
}

/**
 * @param {string} tab Tab name.
 * @param {!Object<string, string>} params Filters; empty values are dropped.
 * @return {string} The hash for the tab and filters.
 */
export function buildHash(tab, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== '' && v != null) q.set(k, String(v));
  const s = q.toString();
  return `#/${TAB_SLUGS[tab]}${s ? `?${s}` : ''}`;
}

/**
 * @param {!Object<string, string>} params URL params.
 * @param {{book: string, minEv: number}} defaults Fallback filters.
 * @return {{book: string, minEv: number}} +EV filters from the URL.
 */
export function evParamsToFilters(params, defaults) {
  const min = params.min == null || params.min === '' ? NaN : Number(params.min);
  return {
    book: params.book ?? defaults.book,
    minEv: Number.isFinite(min) ? min : defaults.minEv,
  };
}

/**
 * @param {{book: string, minEv: number}} f +EV filters.
 * @return {!Object<string, string>} URL params.
 */
export function evFiltersToParams(f) {
  return {book: f.book, min: String(f.minEv)};
}
