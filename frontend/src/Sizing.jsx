import {useStored} from './hooks.js';

/**
 * Rounding steps offered in the sizing bar, in dollars; 0 means cents.
 * @const {!Array<number>}
 */
export const INCREMENTS = [0, 1, 5, 10];

/** Converts a number input's text to a number, keeping '' for an empty input. */
function numberOrBlank(text) {
  return text === '' ? '' : Number(text);
}

/**
 * Returns the stake-sizing settings shared by +EV, Arbitrage and the
 * calculators (stored in localStorage).
 * @return {{total: (number|string), setTotal: function((number|string)),
 *     round: number, setRound: function(number), max: (number|string),
 *     setMax: function((number|string)), maxSide: ?number, bad: boolean}}
 */
export function useSizing() {
  const [total, setTotal] = useStored('sizeArbTotal', '');
  const [round, setRound] = useStored('sizeRound', 1);
  const [max, setMax] = useStored('sizeMaxSide', '');
  const maxSide = max > 0 ? Number(max) : null;
  // A cap below one increment is impossible to honour; fall back to no cap and say so.
  const bad = maxSide != null && maxSide < (round || 0.01);
  return {total, setTotal, round, setRound, max, setMax, maxSide: bad ? null : maxSide, bad};
}

/** Rounding, per-side cap and (optionally) arb total inputs for `useSizing` settings. */
export function SizingBar({s, showTotal = false, totalHint = 'bankroll'}) {
  return (
    <span className="sizing">
      {showTotal && (
        <>
          Arb total $<input className="mini" type="number" min="0" placeholder={totalHint}
            value={s.total} onChange={(e) => {
              s.setTotal(numberOrBlank(e.target.value));
            }} />
        </>
      )}
      Round to <select value={s.round} onChange={(e) => {
        s.setRound(Number(e.target.value));
      }}>
        {INCREMENTS.map((n) => <option key={n} value={n}>{n ? `$${n}` : 'cents'}</option>)}
      </select>
      Max per side $<input className="mini" type="number" min="0" placeholder="none" value={s.max}
        onChange={(e) => {
          s.setMax(numberOrBlank(e.target.value));
        }} />
      {s.bad && <span className="bad">max is below the rounding step — ignored</span>}
    </span>
  );
}

/**
 * Returns the sizing query string for /api/ev and /api/arbs.
 * @param {{round: number, maxSide: ?number, total: (number|string)}} s
 * @param {boolean=} withTotal
 * @return {string}
 */
export function sizingQuery(s, withTotal = false) {
  const maxSide = s.maxSide ? `&max_side=${s.maxSide}` : '';
  const total = withTotal && s.total > 0 ? `&total=${s.total}` : '';
  return `&round_to=${s.round}${maxSide}${total}`;
}
