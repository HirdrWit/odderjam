import {sortedEntries} from './glossary.js';

/** Glossary tab: every betting term, A to Z. */
export function Glossary() {
  return (
    <>
      <h2>Glossary</h2>
      <dl className="glossary">
        {sortedEntries().map((e) => (
          <div key={e.id} id={`term-${e.id}`}>
            <dt>{e.label}</dt>
            <dd>{e.definition} <span className="mut">e.g. {e.example}</span></dd>
          </div>
        ))}
      </dl>
    </>
  );
}
