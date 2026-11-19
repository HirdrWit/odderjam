import {useState} from 'react';

import {columnTip} from './columns.js';
import {ariaSort, arrow, loadSort, nextSort, saveSort, sortRows} from './sorttable.js';

/**
 * Per-tab sort state, kept in localStorage.
 * @param {string} tab
 * @param {{key: string, dir: string}} fallback The default sort.
 * @return {!Array} `[sort, onSort(key, defaultDir), sorted(rows, accessors)]`.
 */
export function useSort(tab, fallback) {
  const [sort, setSort] = useState(() => loadSort(localStorage, tab, fallback));
  const onSort = (key, defaultDir) => {
    const next = nextSort(sort, key, defaultDir);
    setSort(next);
    saveSort(localStorage, tab, next);
  };
  const sorted = (rows, accessors) => {
    const accessor = accessors[sort.key];
    return accessor ? sortRows(rows, accessor, sort.dir) : rows;
  };
  return [sort, onSort, sorted];
}

/**
 * A column header that sorts when clicked. Pass `children` to add a glossary
 * Term for the label; it is kept outside the button so its own click still works.
 * @param {{tab: string, label: string, id: string, sort: !Object, onSort: function(string, string=), defaultDir: (string|undefined)}} props
 */
export function SortTh({tab, label, id, sort, onSort, defaultDir, num = false, children}) {
  // `children` (for example a glossary Term) sits beside the sort button, never inside it.
  const tip = tab ? columnTip(tab, label) : '';
  return (
    <th className={num ? 'num' : undefined} aria-sort={ariaSort(sort, id)} title={tip || undefined}>
      <button type="button" className="sort" onClick={() => {
        onSort(id, defaultDir);
      }}>
        {label}{tip && !children && <span className="info" aria-hidden="true"> ⓘ</span>}
        <span className="arrow" aria-hidden="true"> {arrow(sort, id)}</span>
      </button>
      {children && <> {children}</>}
    </th>
  );
}

/** A row of sort buttons for card lists (Arbitrage). */
export function SortBar({options, sort, onSort}) {
  return (
    <div className="bar" role="group" aria-label="Sort by">
      Sort by {options.map(({id, label, defaultDir}) => (
        <button key={id} type="button" className="sort" aria-pressed={sort.key === id} onClick={() => {
          onSort(id, defaultDir);
        }}>{label} {arrow(sort, id)}</button>
      ))}
    </div>
  );
}
