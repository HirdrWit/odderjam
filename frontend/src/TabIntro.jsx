import {useState} from 'react';

import {Term} from './Term.jsx';
import {GOTO_EVENT, HELP_TAB} from './help.js';
import {INTRO_COPY, introDismissed, setIntroDismissed} from './intro.js';

function store() {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Wraps the first use of each glossary phrase in a Term tooltip.
 * @param {string} text
 * @return {!Array<string|!Object>}
 */
function withTerms(text) {
  const seen = new Set();
  return text.split(/(\+EV|\bedge\b|\bArbitrage\b)/).map((part, i) => {
    if (seen.has(part)) return part;
    if (part === '+EV') {
      seen.add(part);
      return <Term id="ev" key={i}>+EV</Term>;
    }
    if (part === 'edge') {
      seen.add(part);
      return <Term id="edge" key={i}>edge</Term>;
    }
    if (part === 'Arbitrage') {
      seen.add(part);
      return <Term id="arb" key={i}>Arbitrage</Term>;
    }
    return part;
  });
}

/**
 * A dismissible "what is this tab" banner. When dismissed, a small "?" button
 * brings it back.
 * @param {{tab: string}} props
 */
export function TabIntro({tab}) {
  const copy = INTRO_COPY[tab];
  const [hidden, setHidden] = useState(() => introDismissed(store(), tab));
  if (!copy) return null;
  const set = (value) => {
    setHidden(value);
    setIntroDismissed(store(), tab, value);
  };
  if (hidden) {
    return (
      <div className="intro-help">
        <button type="button" title="What is this tab?" aria-label="What is this tab?" onClick={() => {
          set(false);
        }}>?</button>
      </div>
    );
  }
  return (
    <div className="intro" role="note">
      <p>{withTerms(`${copy.what} ${copy.how}`)}</p>
      <button type="button" onClick={() => {
        window.dispatchEvent(new CustomEvent(GOTO_EVENT, {detail: HELP_TAB}));
      }}>Learn more in Help</button>
      <button type="button" onClick={() => {
        set(true);
      }}>Got it</button>
    </div>
  );
}
