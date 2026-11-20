/**
 * @fileoverview Everyday +EV filters: defaults, removable chips and reset (no
 * React), tested in evfilters.test.js.
 */

/** @const {{books: !Array<string>, minEv: number, sport: string, props: string, oddsMin: (number|string), oddsMax: (number|string)}} */
export const DEFAULT_FILTERS = {books: ['DraftKings'], minEv: 1, sport: '', props: 'include', oddsMin: '', oddsMax: ''};

/** @return {!Object} A fresh copy of the default filters. */
export function resetFilters() {
  return {...DEFAULT_FILTERS};
}

/**
 * @param {!Object} filters Current filters.
 * @param {string} key Filter to put back to its default.
 * @return {!Object} New filters.
 */
export function clearFilter(filters, key) {
  if (key === 'odds') return {...filters, oddsMin: '', oddsMax: ''};
  if (key === 'books') return {...filters, books: []};
  return {...filters, [key]: DEFAULT_FILTERS[key]};
}

/** @const {!Array<string>} Books the +EV filter can pick; empty selection means all. */
export const EV_BOOK_NAMES = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'bet365', 'BetRivers', 'Fanatics', 'ESPN BET',
  'Hard Rock Bet', 'Kalshi', 'Polymarket', 'Novig', 'ProphetX',
];

/** @return {boolean} True when the filter differs from its default. */
function isChanged(key, value) {
  const d = DEFAULT_FILTERS[key];
  if (Array.isArray(d)) return value.length !== d.length || value.some((x, i) => x !== d[i]);
  return value !== d;
}

/**
 * @param {*} list Candidate book names.
 * @return {!Array<string>} Known book names only, in EV_BOOK_NAMES order, no duplicates.
 */
export function knownBooks(list) {
  return EV_BOOK_NAMES.filter((b) => list.includes(b));
}

/** @param {!Array<string>} books Selection; empty means all. @return {string} Query fragment for /api/ev. */
export function booksParam(books) {
  return books.length ? `&books=${encodeURIComponent(books.join(','))}` : '';
}

/**
 * @param {?string} stored localStorage value: null, '' (all), one book name, or a JSON list.
 * @return {!Array<string>} The selection.
 */
export function loadBooks(stored) {
  if (stored == null) return [...DEFAULT_FILTERS.books];
  if (stored.startsWith('[')) {
    try {
      const v = JSON.parse(stored);
      if (Array.isArray(v)) return knownBooks(v);
    } catch {
      return [...DEFAULT_FILTERS.books];
    }
  }
  return knownBooks([stored]);
}

/** @param {!Array<string>} books Selection. @return {string} Value to store. */
export function serializeBooks(books) {
  return JSON.stringify(books);
}

const CHIP_LABELS = {
  books: (v) => (v.length === 0 ? 'Book: All books' : `${v.length === 1 ? 'Book' : 'Books'}: ${v.join(', ')}`),
  minEv: (v) => `Min EV: ${v}%`,
  sport: (v) => `Sport: ${v}`,
  props: (v) => (v === 'mainlines' ? 'Game lines only' : 'Game lines and props'),
};

/**
 * @param {!Object} filters Current filters.
 * @return {!Array<{key: string, label: string}>} One chip per non-default filter.
 */
export function activeChips(filters) {
  const chips = Object.keys(CHIP_LABELS)
      .filter((key) => isChanged(key, filters[key]))
      .map((key) => ({key, label: CHIP_LABELS[key](filters[key])}));
  const odds = oddsChip(filters.oddsMin, filters.oddsMax);
  return odds ? [...chips, {key: 'odds', label: odds}] : chips;
}

/** @param {*} v Odds field value. @return {boolean} True when the field is filled in. */
function isSet(v) {
  return v !== '' && v != null;
}

/** @param {number} n @return {string} American odds with an explicit sign. */
function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

/** @return {string} Chip text for the odds range, or '' when neither side is set. */
function oddsChip(min, max) {
  if (isSet(min) && isSet(max)) return `Odds ${signed(Number(min))} to ${signed(Number(max))}`;
  if (isSet(min)) return `Odds ≥ ${signed(Number(min))}`;
  if (isSet(max)) return `Odds ≤ ${signed(Number(max))}`;
  return '';
}

/**
 * @param {!Object} filters Current filters.
 * @return {number} Filters that differ from default; the odds range counts once.
 */
export function evFilterCount(filters) {
  const plain = Object.keys(CHIP_LABELS).filter((key) => isChanged(key, filters[key])).length;
  return plain + (oddsChip(filters.oddsMin, filters.oddsMax) ? 1 : 0);
}

/**
 * @param {(number|string)} v One odds field.
 * @return {string} Error message, or '' when blank or valid.
 */
function oddsError(v) {
  if (!isSet(v)) return '';
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'Enter a number';
  if (Math.abs(n) < 100) return 'American odds must be -100 or lower, or +100 or higher';
  return '';
}

/**
 * @param {(number|string)} min
 * @param {(number|string)} max
 * @return {{min: (string|undefined), max: (string|undefined)}} Error per invalid field.
 */
export function validateOdds(min, max) {
  const errors = {};
  const lo = oddsError(min);
  const hi = oddsError(max);
  if (lo) errors.min = lo;
  if (hi) errors.max = hi;
  if (!lo && !hi && isSet(min) && isSet(max) && Number(min) > Number(max)) {
    errors.max = 'Max odds must not be below min odds';
  }
  return errors;
}

/**
 * @param {(number|string)} min
 * @param {(number|string)} max
 * @return {string} Query fragment for /api/ev; blank sides are left out.
 */
export function oddsParam(min, max) {
  return (isSet(min) ? `&odds_min=${Number(min)}` : '') + (isSet(max) ? `&odds_max=${Number(max)}` : '');
}

/**
 * @param {string} sport Sport code, or '' for any.
 * @return {string} Query fragment for /api/ev.
 */
export function sportsParam(sport) {
  return sport ? `&sports=${encodeURIComponent(sport)}` : '';
}
