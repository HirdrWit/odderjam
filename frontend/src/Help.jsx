import {useState} from 'react';

import {HELP_SECTIONS, convertOdds} from './help.js';

const FORMATS = {american: 'American', decimal: 'Decimal', fractional: 'Fractional'};

/** Quick odds converter: type a price, see every format. */
function Converter() {
  const [value, setValue] = useState('+150');
  const [format, setFormat] = useState('american');
  const result = convertOdds(value, format);
  return (
    <div className="help-converter">
      <label>Price <input value={value} aria-label="Price" onChange={(e) => {
        setValue(e.target.value);
      }} /></label>
      <label>Format <select value={format} aria-label="Format" onChange={(e) => {
        setFormat(e.target.value);
      }}>
        {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></label>
      {result ? (
        <table>
          <tbody>
            <tr><th>American</th><td>{result.american}</td></tr>
            <tr><th>Decimal</th><td>{result.decimal}</td></tr>
            <tr><th>Fractional</th><td>{result.fractional}</td></tr>
            <tr><th>Implied chance</th><td>{result.prob}</td></tr>
          </tbody>
        </table>
      ) : <p className="mut">Enter a valid price, such as +150, 2.5 or 3/2.</p>}
    </div>
  );
}

/** Help tab: walkthrough, odds formats, guides and FAQ. */
export function Help() {
  return (
    <div className="help">
      <h2>Help</h2>
      <nav className="help-toc" aria-label="Help sections">
        {HELP_SECTIONS.map((s) => <a key={s.id} href={`#help-${s.id}`}>{s.title}</a>)}
      </nav>
      {HELP_SECTIONS.map((s) => (
        <section key={s.id} id={`help-${s.id}`}>
          <h3>{s.title}</h3>
          {s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          {s.steps && <ol>{s.steps.map((p, i) => <li key={i}>{p}</li>)}</ol>}
          {s.id === 'odds-formats' && <Converter />}
          {s.risk && <p className="help-risk">{s.risk}</p>}
          {s.items && <dl>{s.items.map((i) => (
            <div key={i.q}><dt>{i.q}</dt><dd>{i.a}</dd></div>
          ))}</dl>}
        </section>
      ))}
    </div>
  );
}
