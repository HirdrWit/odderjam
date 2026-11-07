import {useState} from 'react';

import * as calc from './calc.js';

/** Formats American odds with a leading sign, or a dash if invalid. */
function formatAmerican(odds) {
  if (!Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds.toFixed(0)}` : odds.toFixed(0);
}

/** Formats a dollar amount, or a dash if invalid. */
function formatUsd(amount) {
  if (!Number.isFinite(amount)) return '—';
  return `${amount < 0 ? '-' : ''}$${Math.abs(amount).toFixed(2)}`;
}

/** Formats a percentage, or a dash if invalid. */
function formatPct(value, digits = 2) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : '—';
}

/** Returns the CSS class for a positive, negative or zero value. */
function signClass(value) {
  if (value > 0) return 'best';
  if (value < 0) return 'bad';
  return '';
}

/** Returns true if `odds` are valid American odds. */
function isValidAmerican(odds) {
  return Number.isFinite(odds) && Math.abs(odds) >= 100;
}

function allValidAmerican(odds) {
  return odds.every((o) => isValidAmerican(o));
}

/** Returns true if the stored value names one of the options. */
function isOption(options, value) {
  return value != null && Object.prototype.hasOwnProperty.call(options, value);
}

/** Number input with a label. Empty input is kept as ''. */
function Num({label, value, set, step = 1, ...rest}) {
  const onChange = (e) => {
    set(e.target.value === '' ? '' : Number(e.target.value));
  };
  return (
    <label className="fld">
      {label}
      <input type="number" step={step} value={value} onChange={onChange} {...rest} />
    </label>
  );
}

/** Two-column table of `[label, value, className]` result rows. */
function Out({rows}) {
  return (
    <table className="out">
      <tbody>
        {rows.map(([label, value, cls]) => (
          <tr key={label}><td className="mut">{label}</td><td className={cls}>{value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** Editable list of American odds (n legs / outcomes). */
function OddsList({odds, setOdds, min = 2, max = 12, label = 'Leg', extra, onRemove}) {
  const update = (index, value) => {
    setOdds(odds.map((o, j) => (j === index ? value : o)));
  };
  const remove = (index) => {
    setOdds(odds.filter((_, j) => j !== index));
    onRemove?.(index);
  };
  return (
    <div className="legs">
      {odds.map((o, i) => (
        <div className="bar" key={i}>
          <Num label={`${label} ${i + 1} odds`} value={o} set={(v) => {
            update(i, v);
          }} />
          {extra && extra(i)}
          {odds.length > min && <button className="x" onClick={() => {
            remove(i);
          }}>✕</button>}
        </div>
      ))}
      {odds.length < max && <button className="track" onClick={() => {
        setOdds([...odds, -110]);
      }}>+ Add {label.toLowerCase()}</button>}
    </div>
  );
}

function ExpectedValue() {
  const [stake, setStake] = useState(100);
  const [odds, setOdds] = useState(110);
  const [win, setWin] = useState(50);
  const prob = win / 100;
  const valid = isValidAmerican(odds) && prob > 0 && prob < 1;
  const ev = valid ? calc.evPct(prob, odds) : NaN;
  const profit = valid ? stake * (calc.americanToDecimal(odds) - 1) : NaN;
  const implied = isValidAmerican(odds) ? calc.americanToProb(odds) * 100 : NaN;
  return (
    <>
      <div className="bar">
        <Num label="Stake $" value={stake} set={setStake} />
        <Num label="Odds" value={odds} set={setOdds} />
        <Num label="Win %" value={win} set={setWin} step={0.5} />
      </div>
      <Out rows={[
        ['Expected value', formatUsd(stake * ev / 100), signClass(ev)],
        ['EV %', formatPct(ev), signClass(ev)],
        ['Profit if win', formatUsd(profit)],
        ['Implied win %', formatPct(implied)],
        ['Fair odds', formatAmerican(valid ? calc.probToAmerican(prob) : NaN)],
      ]} />
    </>
  );
}

function Kelly() {
  const [bank, setBank] = useState(1000);
  const [odds, setOdds] = useState(110);
  const [win, setWin] = useState(52);
  const [mult, setMult] = useState(0.25);
  const prob = win / 100;
  const valid = isValidAmerican(odds) && prob > 0 && prob < 1;
  const full = valid ? calc.kellyFraction(prob, odds, 1) : NaN;
  const fraction = full * mult;
  const ev = valid ? calc.evPct(prob, odds) : NaN;
  return (
    <>
      <div className="bar">
        <Num label="Bankroll $" value={bank} set={setBank} />
        <Num label="Odds" value={odds} set={setOdds} />
        <Num label="Win %" value={win} set={setWin} step={0.5} />
        <Num label="Kelly multiplier" value={mult} set={setMult} step={0.05} />
      </div>
      <Out rows={[
        ['Recommended stake', formatUsd(bank * fraction), 'best'],
        ['% of bankroll', formatPct(fraction * 100)],
        ['Full Kelly', `${formatPct(full * 100)} (${formatUsd(bank * full)})`],
        ['EV %', formatPct(ev), signClass(valid ? ev : 0)],
      ]} />
      {full === 0 && <p className="mut">No edge at these odds — Kelly says don't bet.</p>}
    </>
  );
}

function NoVig() {
  const [odds, setOdds] = useState([-120, 100]);
  const [method, setMethod] = useState('multiplicative');
  const valid = allValidAmerican(odds);
  const implied = valid ? odds.map((o) => calc.americanToProb(o)) : [];
  const fair = valid ? calc.DEVIG[method](implied) : [];
  return (
    <>
      <div className="bar">
        Method <select value={method} onChange={(e) => {
          setMethod(e.target.value);
        }}>
          {Object.keys(calc.DEVIG).map((m) => <option key={m}>{m}</option>)}
        </select>
        <span className="mut">Add a third outcome for 3-way (e.g. soccer draw).</span>
      </div>
      <OddsList odds={odds} setOdds={setOdds} max={3} label="Outcome" />
      {valid && (
        <table>
          <thead>
            <tr><th>Outcome</th><th>Odds</th><th>Implied</th><th>Fair prob</th><th>Fair odds</th></tr>
          </thead>
          <tbody>
            {odds.map((o, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{formatAmerican(o)}</td>
                <td>{formatPct(implied[i] * 100)}</td>
                <td>{formatPct(fair[i] * 100)}</td>
                <td className="best">{formatAmerican(calc.probToAmerican(fair[i]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {valid && <p className="mut">Hold {formatPct(calc.hold(odds).holdPct)}</p>}
    </>
  );
}

const FORMATS = {
  american: 'American',
  decimal: 'Decimal',
  fractional: 'Fractional',
  prob: 'Implied %',
};

function Converter() {
  const [format, setFormat] = useState('american');
  const [value, setValue] = useState('-110');
  const decimal = calc.toDecimal(value, format);
  const ok = Number.isFinite(decimal) && decimal > 1;
  const [num, den] = ok ? calc.decimalToFractional(decimal) : [];
  const shown = {
    american: formatAmerican(ok ? calc.decimalToAmerican(decimal) : NaN),
    decimal: ok ? decimal.toFixed(3) : '—',
    fractional: ok ? `${num}/${den}` : '—',
    prob: formatPct(ok ? 100 / decimal : NaN),
  };
  return (
    <>
      <div className="bar">
        Enter as <select value={format} onChange={(e) => {
          setFormat(e.target.value);
        }}>
          {Object.entries(FORMATS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <input value={value} onChange={(e) => {
          setValue(e.target.value);
        }} />
      </div>
      <Out rows={Object.entries(FORMATS).map(
          ([key, label]) => [label, shown[key], key === format ? '' : 'best'])} />
      {!ok && (
        <p className="bad">
          Enter valid odds (American ≥ 100 or ≤ -100, decimal &gt; 1, fraction like 5/2, % between 0
          and 100).
        </p>
      )}
    </>
  );
}

function Implied() {
  const [odds, setOdds] = useState([-150, 130]);
  const valid = allValidAmerican(odds);
  const result = valid ? calc.hold(odds) : null;
  return (
    <>
      <OddsList odds={odds} setOdds={setOdds} min={1} label="Outcome" />
      {valid && (
        <table>
          <thead><tr><th>Outcome</th><th>Odds</th><th>Implied probability</th></tr></thead>
          <tbody>
            {odds.map((o, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{formatAmerican(o)}</td>
                <td className="best">{formatPct(calc.americanToProb(o) * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && odds.length > 1 && (
        <p className="mut">
          Total {formatPct(result.totalImplied * 100)} — overround {formatPct(result.overroundPct)}
        </p>
      )}
    </>
  );
}

function Hold() {
  const [odds, setOdds] = useState([-110, -110]);
  const result = allValidAmerican(odds) ? calc.hold(odds) : null;
  return (
    <>
      <OddsList odds={odds} setOdds={setOdds} label="Outcome" />
      {result && <Out rows={[
        ['Hold (book margin)', formatPct(result.holdPct), result.holdPct <= 0 ? 'best' : ''],
        ['Overround (vig)', formatPct(result.overroundPct)],
        ['Total implied', formatPct(result.totalImplied * 100)],
      ]} />}
      {result && result.holdPct < 0 && <p className="best">Negative hold — this is an arbitrage.</p>}
    </>
  );
}

function Parlay() {
  const [odds, setOdds] = useState([-110, -110]);
  const [fair, setFair] = useState(['', '']);
  const [stake, setStake] = useState(10);
  const setLegs = (legs) => {
    setOdds(legs);
    if (legs.length > fair.length) setFair([...fair, '']);
  };
  const valid = allValidAmerican(odds);
  const fairProbs = fair.every((f) => f !== '' && f > 0 && f < 100) ?
      fair.map((f) => f / 100) :
      null;
  const result = valid ? calc.parlay(odds, fairProbs) : null;
  const fairInput = (i) => (
    <Num label="Fair win % (optional)" value={fair[i] ?? ''} step={0.5} set={(v) => {
      setFair(fair.map((f, j) => (j === i ? v : f)));
    }} />
  );
  const rows = result && [
    ['Parlay odds', `${formatAmerican(result.american)} (${result.decimal.toFixed(3)})`],
    ['Payout', formatUsd(stake * result.decimal)],
    ['Profit', formatUsd(stake * (result.decimal - 1)), 'best'],
    ['Implied prob', formatPct(100 / result.decimal)],
    ...(fairProbs ? [
      ['Fair prob', formatPct(result.fairProb * 100)],
      [
        'EV',
        `${formatPct(result.evPct)} (${formatUsd(stake * result.evPct / 100)})`,
        signClass(result.evPct),
      ],
    ] : []),
  ];
  return (
    <>
      <Num label="Stake $" value={stake} set={setStake} />
      <OddsList odds={odds} setOdds={setLegs} label="Leg" extra={fairInput} onRemove={(i) => {
        setFair(fair.filter((_, j) => j !== i));
      }} />
      {result && <Out rows={rows} />}
    </>
  );
}

function RoundRobin() {
  const [odds, setOdds] = useState([-110, -110, -110]);
  const [stake, setStake] = useState(10);
  const [sizes, setSizes] = useState([2]);
  const valid = allValidAmerican(odds);
  const available = sizes.filter((k) => k <= odds.length);
  const result = valid && available.length ? calc.roundRobin(odds, available, stake) : null;
  const toggle = (k) => {
    setSizes(sizes.includes(k) ?
        sizes.filter((x) => x !== k) :
        [...sizes, k].sort((x, y) => x - y));
  };
  const sizeOptions = Array.from({length: odds.length - 1}, (_, i) => i + 2);
  return (
    <>
      <div className="bar">
        <Num label="Stake per parlay $" value={stake} set={setStake} />
        By {sizeOptions.map((k) => (
          <label key={k} className="chk">
            <input type="checkbox" checked={sizes.includes(k)} onChange={() => {
              toggle(k);
            }} />
            {k}s
          </label>
        ))}
      </div>
      <OddsList odds={odds} setOdds={setOdds} min={3} max={8} label="Leg" />
      {result && <Out rows={[
        ['Parlays', result.count],
        ['Total stake', formatUsd(result.totalStake)],
        ['Max payout (all win)', formatUsd(result.maxPayout)],
        ['Max profit', formatUsd(result.maxProfit), 'best'],
      ]} />}
      {result && (
        <table>
          <thead><tr><th>Legs</th><th>Odds</th><th>Payout</th></tr></thead>
          <tbody>
            {result.parlays.map((p) => (
              <tr key={p.legs.join()}>
                <td>{p.legs.map((i) => i + 1).join(' + ')}</td>
                <td>{formatAmerican(calc.decimalToAmerican(p.decimal))}</td>
                <td>{formatUsd(stake * p.decimal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Bonus() {
  const [bonus, setBonus] = useState(100);
  const [oddsBonus, setOddsBonus] = useState(250);
  const [oddsHedge, setOddsHedge] = useState(-300);
  const valid = isValidAmerican(oddsBonus) && isValidAmerican(oddsHedge) && bonus > 0;
  const result = valid ? calc.bonusBetHedge(bonus, oddsBonus, oddsHedge) : null;
  return (
    <>
      <div className="bar">
        <Num label="Bonus bet $" value={bonus} set={setBonus} />
        <Num label="Bonus side odds" value={oddsBonus} set={setOddsBonus} />
        <Num label="Hedge side odds (cash)" value={oddsHedge} set={setOddsHedge} />
      </div>
      {result && <Out rows={[
        ['Hedge stake', formatUsd(result.hedgeStake)],
        ['Guaranteed profit', formatUsd(result.profit), signClass(result.profit)],
        ['Conversion', formatPct(result.conversionPct, 1), 'best'],
      ]} />}
      <p className="mut">
        Bonus bet stake is not returned on a win. Longer odds on the bonus side usually convert
        better.
      </p>
    </>
  );
}

function Arb() {
  const [odds, setOdds] = useState([110, -105]);
  const [total, setTotal] = useState(100);
  const result = allValidAmerican(odds) ? calc.arb(odds, total) : null;
  return (
    <>
      <Num label="Total stake $" value={total} set={setTotal} />
      <OddsList odds={odds} setOdds={setOdds} max={3} label="Outcome" />
      {result && (
        <>
          <Out rows={[
            [
              'Profit',
              `${formatPct(result.profitPct)} (${formatUsd(result.payout - total)})`,
              signClass(result.profitPct),
            ],
            ['Payout (any outcome)', formatUsd(result.payout)],
          ]} />
          <table>
            <thead><tr><th>Outcome</th><th>Odds</th><th>Stake</th></tr></thead>
            <tbody>
              {odds.map((o, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{formatAmerican(o)}</td>
                  <td>{formatUsd(result.stakes[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function Hedge() {
  const [stake, setStake] = useState(100);
  const [oddsOrig, setOddsOrig] = useState(300);
  const [oddsHedge, setOddsHedge] = useState(-150);
  const valid = isValidAmerican(oddsOrig) && isValidAmerican(oddsHedge);
  const result = valid ? calc.hedge(stake, oddsOrig, oddsHedge) : null;
  return (
    <>
      <div className="bar">
        <Num label="Original stake $" value={stake} set={setStake} />
        <Num label="Original odds" value={oddsOrig} set={setOddsOrig} />
        <Num label="Hedge odds" value={oddsHedge} set={setOddsHedge} />
      </div>
      {result && <Out rows={[
        ['Hedge stake', formatUsd(result.hedgeStake)],
        ['Locked profit (either outcome)', formatUsd(result.profit), signClass(result.profit)],
        [
          'Unhedged: win / lose',
          `${formatUsd(result.unhedgedWin)} / ${formatUsd(result.unhedgedLoss)}`,
        ],
      ]} />}
    </>
  );
}

function Prediction() {
  const [cents, setCents] = useState(40);
  const [fee, setFee] = useState(0);
  const result = calc.predictionMarket(Number(cents), Number(fee) || 0);
  return (
    <>
      <div className="bar">
        <Num label="Price (¢)" value={cents} set={setCents} />
        <Num label="Fee per contract (¢)" value={fee} set={setFee} step={0.1} />
      </div>
      {result ? (
        <Out rows={[
          ['Implied probability', formatPct(result.prob * 100)],
          ['American (after fee)', formatAmerican(result.american), 'best'],
          ['Decimal (after fee)', result.decimal.toFixed(3)],
          ['Break-even win %', formatPct(result.breakeven * 100)],
        ]} />
      ) : (
        <p className="bad">Price plus fee must be between 0¢ and 100¢.</p>
      )}
      <p className="mut">Kalshi / Polymarket contracts pay 100¢ if they resolve Yes.</p>
    </>
  );
}

function Poisson() {
  const [mean, setMean] = useState(2.3);
  const [line, setLine] = useState(1.5);
  const ok = mean > 0 && line >= 0;
  const result = ok ? calc.poissonOverUnder(mean, line) : null;
  const top = ok ? Math.max(Math.ceil(mean * 2.5), Math.ceil(line) + 2) : 0;
  const withOdds = (prob) => `${formatPct(prob * 100)} (${formatAmerican(calc.probToAmerican(prob))})`;
  return (
    <>
      <div className="bar">
        <Num label="Mean (λ)" value={mean} set={setMean} step={0.1} />
        <Num label="Line" value={line} set={setLine} step={0.5} />
      </div>
      {result && <Out rows={[
        ['Over', withOdds(result.over)],
        ['Under', withOdds(result.under)],
        ...(result.push > 0 ? [['Push', formatPct(result.push * 100)]] : []),
      ]} />}
      {result && (
        <table>
          <thead><tr><th>Exactly</th><th>Probability</th></tr></thead>
          <tbody>
            {Array.from({length: top + 1}, (_, k) => (
              <tr key={k}><td>{k}</td><td>{formatPct(calc.poissonPmf(mean, k) * 100)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function HalfPoint() {
  const [sport, setSport] = useState('NFL');
  const [keyNumber, setKeyNumber] = useState(3);
  const [whole, setWhole] = useState(-110);
  const [half, setHalf] = useState(-130);
  const [winNoPush, setWinNoPush] = useState(50);
  const [push, setPush] = useState(calc.PUSH_RATES.NFL[3]);
  const pick = (nextSport, nextNumber) => {
    const rates = calc.PUSH_RATES[nextSport];
    const number = Object.prototype.hasOwnProperty.call(rates, nextNumber) ?
        nextNumber :
        Number(Object.keys(rates)[0]);
    setSport(nextSport);
    setKeyNumber(number);
    setPush(rates[number]);
  };
  const valid = isValidAmerican(whole) && isValidAmerican(half);
  const result = valid ? calc.halfPoint(whole, half, Number(push), winNoPush / 100) : null;
  return (
    <>
      <div className="bar">
        Sport <select value={sport} onChange={(e) => {
          pick(e.target.value, keyNumber);
        }}>
          {Object.keys(calc.PUSH_RATES).map((s) => <option key={s}>{s}</option>)}
        </select>
        Key number <select value={keyNumber} onChange={(e) => {
          pick(sport, Number(e.target.value));
        }}>
          {Object.keys(calc.PUSH_RATES[sport]).map((n) => <option key={n}>{n}</option>)}
        </select>
        <Num label="Push rate %" value={push} set={setPush} step={0.1} />
      </div>
      <div className="bar">
        <Num label="Odds at whole number" value={whole} set={setWhole} />
        <Num label="Odds after buying ½" value={half} set={setHalf} />
        <Num label="Win % if no push" value={winNoPush} set={setWinNoPush} step={0.5} />
      </div>
      {result && <Out rows={[
        ['EV at whole number', formatPct(result.evWholePct), signClass(result.evWholePct)],
        ['EV after buying ½ point', formatPct(result.evHalfPct), signClass(result.evHalfPct)],
        [
          'Verdict',
          result.worthIt ? 'Buy the half point' : 'Don\'t buy',
          result.worthIt ? 'best' : 'bad',
        ],
      ]} />}
      <p className="mut">
        Push rates are rough historical estimates — edit them to match your own data.
      </p>
    </>
  );
}

function SpreadMoneyline() {
  const [sport, setSport] = useState('NFL');
  const [spread, setSpread] = useState(-3);
  const [sd, setSd] = useState(calc.MARGIN_SD.NFL);
  const result = sd > 0 ? calc.spreadToMoneyline(Number(spread), sd) : null;
  const pickSport = (nextSport) => {
    setSport(nextSport);
    setSd(calc.MARGIN_SD[nextSport]);
  };
  return (
    <>
      <div className="bar">
        Sport <select value={sport} onChange={(e) => {
          pickSport(e.target.value);
        }}>
          {Object.keys(calc.MARGIN_SD).map((s) => <option key={s}>{s}</option>)}
        </select>
        <Num label="Favourite spread" value={spread} set={setSpread} step={0.5} />
        <Num label="Margin std dev" value={sd} set={setSd} step={0.5} />
      </div>
      {result && <Out rows={[
        [
          'Favourite fair ML',
          `${formatAmerican(result.favAmerican)} (${formatPct(result.favProb * 100)})`,
          'best',
        ],
        [
          'Underdog fair ML',
          `${formatAmerican(result.dogAmerican)} (${formatPct(result.dogProb * 100)})`,
        ],
      ]} />}
      <p className="mut">
        Assumes the final margin is normally distributed around the spread; fair (no-vig) prices.
        Ignores key numbers.
      </p>
    </>
  );
}

const CALCS = {
  'Expected value': ExpectedValue,
  'Kelly': Kelly,
  'No-vig fair odds': NoVig,
  'Odds converter': Converter,
  'Implied probability': Implied,
  'Vig / hold': Hold,
  'Parlay': Parlay,
  'Round robin': RoundRobin,
  'Bonus bet': Bonus,
  'Arbitrage': Arb,
  'Hedge': Hedge,
  'Prediction market': Prediction,
  'Poisson': Poisson,
  'Half point': HalfPoint,
  'Spread → moneyline': SpreadMoneyline,
};

const DEFAULT_CALC = 'Expected value';

function loadCalcName() {
  try {
    const name = localStorage.getItem('calc');
    return isOption(CALCS, name) ? name : DEFAULT_CALC;
  } catch {
    // Storage can be unavailable (e.g. private browsing); use the default.
    return DEFAULT_CALC;
  }
}

/** Calculator tab: a sub-navigation of every calculator. */
export function Calculators() {
  const [name, setName] = useState(() => loadCalcName());
  const go = (next) => {
    setName(next);
    try {
      localStorage.setItem('calc', next);
    } catch {
      // Storage can be unavailable; the choice just is not remembered.
    }
  };
  const Page = CALCS[name];
  return (
    <>
      <div className="subnav">
        {Object.keys(CALCS).map((n) => (
          <button key={n} className={n === name ? 'on' : ''} onClick={() => {
            go(n);
          }}>{n}</button>
        ))}
      </div>
      <div className="card calc"><h2>{name}</h2><Page /></div>
    </>
  );
}
