import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';

import {findEntry, tooltipLeft} from './glossary.js';

const EDGE_MARGIN = 8;

/**
 * Renders jargon with a dotted underline and a definition tooltip. Opens on
 * hover, keyboard focus and tap; Escape closes it.
 * @param {{id: string, children: *}} props id is a glossary entry id.
 */
export function Term({id, children}) {
  const entry = findEntry(id);
  const tipId = useId();
  const anchor = useRef(null);
  const tip = useRef(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const open = hover || focus;
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const width = tip.current.offsetWidth;
    setShift(tooltipLeft(a, width, document.documentElement.clientWidth, EDGE_MARGIN) - a.left);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setHover(false);
        setFocus(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!entry) return children;
  return (
    <span className="term" ref={anchor} tabIndex={0} aria-describedby={open ? tipId : undefined}
      onMouseEnter={() => {
        setHover(true);
      }} onMouseLeave={() => {
        setHover(false);
      }}
      onFocus={() => {
        setFocus(true);
      }} onBlur={() => {
        setFocus(false);
      }}
      onClick={(e) => {
        // Tapping a term must not toggle a clickable parent such as an event card.
        e.stopPropagation();
        setFocus(true);
      }}>
      {children}
      {open && (
        <span className="term-tip" role="tooltip" id={tipId} ref={tip} style={{left: shift}}>
          <b>{entry.label}:</b> {entry.definition} <i>e.g. {entry.example}</i>
        </span>
      )}
    </span>
  );
}
