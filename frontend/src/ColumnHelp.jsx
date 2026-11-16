import {columnTip, rowExample} from './columns.js';

/**
 * A table header cell with a plain-English tooltip and a small "i" marker.
 * @param {{tab: string, label: string}} props label is the column's header text.
 */
export function Th({tab, label}) {
  const tip = columnTip(tab, label);
  return (
    <th title={tip || undefined}>
      {label}{tip && <span className="info" aria-hidden="true"> ⓘ</span>}
    </th>
  );
}

/**
 * One line under the first result that explains how to read it.
 * @param {{tab: string, row: ?Object, fmt: !Object}} props
 */
export function RowExample({tab, row, fmt}) {
  if (!row) return null;
  const text = rowExample(tab, row, fmt);
  return text ? <div className="mut small row-example">{text}</div> : null;
}
