import {useState} from 'react';

import {TabIntro} from './TabIntro.jsx';
import {postJson, toast, useApi, useStored} from './hooks.jsx';
import {formatTable, parseTableText} from './pickem.js';

const SIZES = [2, 3, 4, 5, 6];
const BLANK = {player: '', market: '', point: '', side: ''};

/** Formats a 0-1 probability as a percentage. */
function pct(p) {
  return Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '—';
}

/** Returns the CSS class for a positive or negative value. */
function signClass(v) {
  if (v > 0) return 'best';
  return v < 0 ? 'bad' : '';
}

/** Describes a leg as "Player Side Line". */
function legLabel(leg) {
  return [leg.player, leg.side, leg.point].filter((x) => x != null && x !== '').join(' ');
}

/** The pick'em slip optimizer tab. */
export function Pickem() {
  const [lines, setLines] = useStored('pickem.lines', []);
  const [payout, setPayout] = useStored('pickem.payout', 'power');
  const [sizes, setSizes] = useStored('pickem.sizes', [2, 3]);
  const [importText, setImportText] = useState('');
  const [parseErrors, setParseErrors] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [edited, setEdited] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const defaults = useApi('/api/pickem/payouts', 3600000);

  const defaultText = defaults && defaults[payout] ? formatTable(defaults[payout]) : '';
  const tableText = edited == null ? defaultText : edited;
  let tableError = '';
  let override = null;
  try {
    override = edited == null ? null : parseTableText(edited);
  } catch (e) {
    tableError = e.message;
  }

  const importLines = async () => {
    const r = await postJson('/api/pickem/parse', {text: importText});
    if (!r.ok) return toast('Could not parse lines', 'err');
    const data = await r.json();
    setLines([...lines, ...data.lines]);
    setParseErrors(data.errors);
    if (!data.errors.length) setImportText('');
  };

  const addLine = () => {
    const point = Number(form.point);
    if (!form.player.trim() || !form.market.trim() || form.point === '' || !Number.isFinite(point)) {
      return toast('Player, market and a numeric line are required', 'err');
    }
    setLines([...lines, {player: form.player.trim(), market: form.market.trim(), point, side: form.side || null}]);
    setForm(BLANK);
  };

  const toggleSize = (n) => {
    setSizes(sizes.includes(n) ? sizes.filter((s) => s !== n) : [...sizes, n].sort());
  };

  const build = async () => {
    setBusy(true);
    try {
      const body = {lines, payout, sizes, method: 'multiplicative', top: 3};
      if (override) body.payouts = override;
      const r = await postJson('/api/pickem', body);
      if (!r.ok) {
        const detail = await r.json().then((d) => d.detail, () => null);
        return toast(typeof detail === 'string' ? detail : 'Could not build slips', 'err');
      }
      setResult(await r.json());
    } finally {
      setBusy(false);
    }
  };

  const setField = (k) => (e) => setForm({...form, [k]: e.target.value});
  const ranked = result ? [...result.legs].sort((a, b) => (b.matched - a.matched) || ((b.prob || 0) - (a.prob || 0))) : [];

  return (
    <>
      <TabIntro tab="Pick'em" />
      <h3>Lines</h3>
      <textarea rows={4} cols={60} value={importText} onChange={(e) => setImportText(e.target.value)}
        placeholder="player, market, line[, over|under] (one per row)" />
      <div className="bar">
        <button onClick={importLines} disabled={!importText.trim()}>Import lines</button>
      </div>
      {parseErrors.map((e) => <p key={e.row} className="bad">Row {e.row}: {e.error} ({e.text})</p>)}
      <div className="bar">
        <input placeholder="Player" value={form.player} onChange={setField('player')} />
        <input placeholder="Market" value={form.market} onChange={setField('market')} />
        <input placeholder="Line" size={5} value={form.point} onChange={setField('point')} />
        <select value={form.side} onChange={setField('side')}>
          <option value="">Best side</option>
          <option>Over</option>
          <option>Under</option>
        </select>
        <button onClick={addLine}>Add</button>
      </div>
      {lines.length > 0 && (
        <table className="odds">
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.player}</td><td>{l.market}</td><td>{l.point}</td><td>{l.side || 'either'}</td>
                <td><button className="x" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Payouts</h3>
      <div className="bar">
        <select value={payout} onChange={(e) => {
          setPayout(e.target.value);
          setEdited(null);
        }}>
          <option value="power">Power</option>
          <option value="flex">Flex</option>
        </select>
        {SIZES.map((n) => (
          <label key={n}>
            <input type="checkbox" checked={sizes.includes(n)} onChange={() => toggleSize(n)} /> {n}-pick
          </label>
        ))}
      </div>
      <textarea rows={6} cols={40} value={tableText} onChange={(e) => setEdited(e.target.value)} />
      <div className="bar">
        <button onClick={() => setEdited(null)} disabled={edited == null}>Reset to default</button>
        {tableError && <span className="bad">{tableError}</span>}
      </div>
      <div className="bar">
        <button className="primary" onClick={build} disabled={busy || !lines.length || !sizes.length || !!tableError}>
          {busy ? 'Building…' : 'Build slips'}
        </button>
      </div>

      {result && (
        <>
          <h3>Legs</h3>
          <table className="odds">
            <thead>
              <tr><th>Player</th><th>Market</th><th>Line</th><th>Side</th><th>Hit %</th><th>Source</th><th>Event</th></tr>
            </thead>
            <tbody>
              {ranked.map((l, i) => (
                <tr key={i} style={l.matched ? undefined : {opacity: 0.5}}>
                  <td>{l.player}</td><td>{l.market}</td><td>{l.point}</td>
                  <td>{l.matched ? l.side : '—'}</td>
                  <td>{l.matched ? pct(l.prob) : 'no match'}</td>
                  <td className="mut">{l.matched ? l.source : ''}</td>
                  <td className="mut">{l.event || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {Object.keys(result.slips).sort().map((size) => (
            <div key={size}>
              <h3>{size}-pick slips</h3>
              <p className="mut">Break-even: {pct(result.breakeven[size])} per leg</p>
              {result.slips[size].length === 0 && <p className="mut">No eligible slips.</p>}
              <table className="odds">
                <tbody>
                  {result.slips[size].map((s, i) => (
                    <tr key={i}>
                      <td>{s.legs.map(legLabel).join(' + ')}</td>
                      <td>{pct(s.win_prob)}</td>
                      <td>{s.expected_return.toFixed(2)}x</td>
                      <td className={signClass(s.ev_pct)}>{s.ev_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="mut">
            Legs are assumed independent. Same-player and single-game slips are excluded.
            Lines match only at the exact sportsbook point.
          </p>
        </>
      )}
    </>
  );
}
