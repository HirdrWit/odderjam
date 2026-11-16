import {useState} from 'react';

import {INTRO_COPY, introDismissed, setIntroDismissed} from './intro.js';

function store() {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
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
      <p>{copy.what} {copy.how}</p>
      <button type="button" onClick={() => {
        set(true);
      }}>Got it</button>
    </div>
  );
}
