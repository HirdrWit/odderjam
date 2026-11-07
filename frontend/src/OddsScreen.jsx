import React, { useState } from "react";
import { useStored, useApi } from "./hooks.js";
import { FORMATS, formatOdds, outcomeLabel, lineGroups, groupStats, mainGroup, filterEvents, allBooks } from "./odds.js";

const MARKET_LABELS = { moneyline: "Moneyline", spreads: "Spread", totals: "Total" };
const ORDER = Object.keys(MARKET_LABELS);
const marketLabel = (k) => MARKET_LABELS[k] || k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const holdText = (h) => (h == null ? "—" : `${h.toFixed(2)}%`);
const holdClass = (h) => (h == null ? "" : h <= 0 ? "best" : h > 5 ? "bad" : "");

function LineTable({ group, books, format }) {
  const s = groupStats(group, books);
  return (
    <table className="odds">
      <thead><tr><th>Line</th><th>Best</th><th>Fair</th>{books.map((b) => <th key={b}>{b}</th>)}</tr></thead>
      <tbody>
        {group.outcomes.map((o, i) => (
          <tr key={`${o.name}${o.point}`}>
            <td>{outcomeLabel(o)}</td>
            <td className="best">{s.best[i] ? <>{formatOdds(s.best[i].price, format)} <span className="mut small">{s.best[i].book}</span></> : "—"}</td>
            <td className="mut">{formatOdds(s.fair[i], format) || "—"}</td>
            {books.map((b) => (
              <td key={b} className={o.prices[b] != null && s.best[i] && o.prices[b] === s.best[i].price ? "best" : ""}>
                {formatOdds(o.prices[b], format)}
              </td>
            ))}
          </tr>
        ))}
        <tr className="foot"><td>Hold at best</td><td className={holdClass(s.holdPct)}>{holdText(s.holdPct)}</td>
          <td colSpan={books.length + 1} className="mut small">{s.bookCount ? `Fair = no-vig average of ${s.bookCount} book${s.bookCount > 1 ? "s" : ""}` : ""}</td></tr>
      </tbody>
    </table>
  );
}

function BookPicker({ books, hidden, setHidden }) {
  const toggle = (b) => setHidden(hidden.includes(b) ? hidden.filter((x) => x !== b) : [...hidden, b]);
  return (
    <div className="subnav">
      {books.map((b) => <button key={b} className={hidden.includes(b) ? "" : "on"} onClick={() => toggle(b)}>{b}</button>)}
      <button onClick={() => setHidden([])}>All</button>
      <button onClick={() => setHidden(books)}>None</button>
    </div>
  );
}

export default function OddsScreen() {
  const [sport, setSport] = useStored("oddsSport", "");
  const [market, setMarket] = useStored("oddsMarket", "moneyline");
  const [format, setFormat] = useStored("oddsFormat", "american");
  const [hidden, setHidden] = useStored("oddsHiddenBooks", []);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const [eventMarket, setEventMarket] = useState({});
  const [showBooks, setShowBooks] = useState(false);
  const data = useApi(`/api/odds${sport ? `?sport=${sport}` : ""}`) || [];

  const books = allBooks(data);
  const shown = books.filter((b) => !hidden.includes(b));
  const markets = [...new Set([...ORDER, ...data.flatMap((e) => Object.keys(e.markets))])];
  const events = filterEvents(data, query);

  return (
    <>
      <div className="bar wrap">
        <select value={sport} onChange={(e) => setSport(e.target.value)}>
          {["", "NBA", "NFL", "MLB", "NHL"].map((s) => <option key={s} value={s}>{s || "All sports"}</option>)}
        </select>
        <input className="search" placeholder="Search team" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="chip" onClick={() => setShowBooks(!showBooks)}>Books ({shown.length}/{books.length})</button>
      </div>
      {showBooks && <BookPicker books={books} hidden={hidden} setHidden={setHidden} />}
      <div className="subnav">
        {markets.map((m) => <button key={m} className={m === market ? "on" : ""} onClick={() => { setMarket(m); setEventMarket({}); }}>{marketLabel(m)}</button>)}
      </div>
      {!shown.length && <div className="mut">No books selected.</div>}
      {events.length === 0 && data.length > 0 && <div className="mut">No events match “{query}”.</div>}
      {shown.length > 0 && events.map((e) => {
        const m = eventMarket[e.id] && e.markets[eventMarket[e.id]] ? eventMarket[e.id] : market;
        const outs = e.markets[m] || [];
        const groups = lineGroups(m, outs, e.home, e.away);
        const main = mainGroup(groups, shown);
        const ms = main && groupStats(main, shown);
        const isOpen = open === e.id;
        return (
          <div className="card" key={e.id} onClick={() => setOpen(isOpen ? null : e.id)}>
            <b>{e.away} @ {e.home}</b> <span className="mut">{e.sport} · {new Date(e.start).toLocaleString()}</span>
            <div className="mut">
              {!main ? `No ${marketLabel(m).toLowerCase()} odds` : <>
                {marketLabel(m)} best: {main.outcomes.map((o, i) => `${outcomeLabel(o)} ${ms.best[i] ? formatOdds(ms.best[i].price, format) : "—"}`).join(" · ")}
                {" · "}hold <span className={holdClass(ms.holdPct)}>{holdText(ms.holdPct)}</span>
                {groups.length > 1 && ` · ${groups.length} lines`}
              </>}
            </div>
            {isOpen && (
              <div onClick={(ev) => ev.stopPropagation()} className="detail">
                <div className="subnav">
                  {Object.keys(e.markets).map((k) => (
                    <button key={k} className={k === m ? "on" : ""} onClick={() => setEventMarket({ ...eventMarket, [e.id]: k })}>{marketLabel(k)}</button>
                  ))}
                </div>
                {groups.map((g) => <LineTable key={String(g.point)} group={g} books={shown} format={format} />)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
