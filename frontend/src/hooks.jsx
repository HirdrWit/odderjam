import {useEffect, useState} from 'react';

import {BETTABLE_EVENT, readBettable, writeBettable} from './bettable.js';
import {GOTO_EVENT} from './help.js';

export {useApi, useApiStatus, useStored} from './hooks.js';

const TOAST_MS = 3500;

/**
 * Shows a short inline notice.
 * @param {string} text
 * @param {string=} kind 'ok' or 'err'.
 * @param {{label: string, tab: string}=} action Optional link to another tab.
 */
export function toast(text, kind = 'ok', action = undefined) {
  window.dispatchEvent(new CustomEvent('toast', {detail: {text, kind, action}}));
}

/** Renders the notices sent with `toast`. */
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let nextId = 0;
    const add = (e) => {
      const id = ++nextId;
      setItems((xs) => [...xs, {id, ...e.detail}]);
      setTimeout(() => {
        setItems((xs) => xs.filter((x) => x.id !== id));
      }, TOAST_MS);
    };
    window.addEventListener('toast', add);
    return () => {
      window.removeEventListener('toast', add);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.kind === 'err' ? '⚠ ' : '✓ '}{t.text}
          {t.action && (
            <>{' '}<button type="button" className="link" onClick={() => {
              window.dispatchEvent(new CustomEvent(GOTO_EVENT, {detail: t.action.tab}));
            }}>{t.action.label}</button></>
          )}
        </div>
      ))}
    </div>
  );
}

/** Returns the first validation message from a failed API response, if any. */
export async function errorDetail(response) {
  try {
    const {detail} = await response.json();
    if (!Array.isArray(detail)) return detail;
    const [first] = detail;
    return first && `${first.loc?.at(-1) ?? 'input'}: ${first.msg}`;
  } catch {
    return undefined;
  }
}

/**
 * Sends `body` as JSON to `url`.
 * @param {string} url
 * @param {*} body
 * @param {string=} method
 * @return {!Promise<!Response>}
 */
export function postJson(url, body, method = 'POST') {
  return fetch(url, {
    method,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
}

/**
 * The global "Bettable only" toggle, shared by every tab through localStorage
 * and a window event. On by default.
 * @return {!Array} `[on, setOn]`.
 */
export function useBettable() {
  const [on, setOnState] = useState(() => readBettable());
  useEffect(() => {
    const sync = () => setOnState(readBettable());
    window.addEventListener(BETTABLE_EVENT, sync);
    return () => window.removeEventListener(BETTABLE_EVENT, sync);
  }, []);
  const setOn = (next) => {
    writeBettable(globalThis.localStorage, next);
    setOnState(next);
    window.dispatchEvent(new Event(BETTABLE_EVENT));
  };
  return [on, setOn];
}
