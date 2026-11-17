import {tableView} from './tablestate.js';

/**
 * Shared empty-state block: the reason and what to do next.
 * @param {{text: ?string}} props
 */
export function EmptyState({text}) {
  return text ? <div className="mut empty-state">{text}</div> : null;
}

/**
 * Wraps a table. No rows: the table (and its header) is replaced by the
 * empty-state text. First load: `skeleton` placeholder rows. Refresh: the
 * `loading` class dims the old rows.
 * @param {{data: *, rows: (!Array|undefined), emptyText: ?string, refreshing: boolean,
 *     columns: number, children: !Object}} props
 */
export function TableShell({data, rows, emptyText, refreshing = false, columns = 4, children}) {
  const view = tableView({data, rows, emptyText, refreshing});
  if (view.kind === 'error') return null;
  if (view.kind === 'empty') return <div className={view.className}><EmptyState text={view.text} /></div>;
  if (view.kind === 'skeleton') {
    return (
      <div className={view.className} aria-busy="true">
        {Array.from({length: view.rows}, (_, i) => (
          <div key={i} className="skeleton" style={{'--cols': columns}} />
        ))}
      </div>
    );
  }
  return <div className={view.className} aria-busy={refreshing || undefined}>{children}</div>;
}
