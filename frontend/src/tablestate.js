/**
 * @fileoverview Which view a table tab shows (no React), tested in
 * tablestate.test.js: skeleton rows on first load, one empty-state block
 * (no header) when there are no rows, and a loading class during a refresh.
 */

/** Number of placeholder rows shown on first load. */
export const SKELETON_ROWS = 5;

/**
 * @param {{data: *, rows: (!Array|undefined), emptyText: ?string, refreshing: boolean,
 *     error: (?string|undefined), what: (string|undefined)}} args
 *     `rows` overrides `data` when the list is nested in the response.
 * @return {{kind: string, showHead: boolean, className: string, text: ?string, rows: number}}
 */
export function tableView({data, rows, emptyText, refreshing, error, what = 'this data'}) {
  const list = rows !== undefined ? rows : data;
  const className = refreshing ? 'tablewrap loading' : 'tablewrap';
  const base = {className, text: emptyText ?? null, rows: SKELETON_ROWS};
  if (error && list == null) {
    return {...base, kind: 'failed', showHead: false, text: `Couldn't load ${what}. ${error}`};
  }
  if (list == null) return {...base, kind: 'skeleton', showHead: true};
  if (!Array.isArray(list)) return {...base, kind: 'error', showHead: false};
  if (list.length === 0) return {...base, kind: 'empty', showHead: false};
  return {...base, kind: 'table', showHead: true};
}

/**
 * @param {{data: *, error: (?string|undefined), what: string}} args
 * @return {?string} "Couldn't load <what>. <error>" when the load failed with nothing to show, else null.
 */
export function failedText({data, error, what}) {
  return error && data == null ? `Couldn't load ${what}. ${error}` : null;
}
