// Phase 24: the letter reader. Plain DOM, no three, no draw calls. The look lives in theme.css (classes `wl-letter*`).
//   text    EXACTLY as given: `textContent` in a `white-space: pre-wrap` block, so line breaks and spaces stay as the owner wrote them. Never trimmed, never edited.
//   scroll  the panel scrolls, the page behind does not; the first line is at the top when it opens
//   close   a real button (its accessible name comes from the caller: plain functional words, flagged), Escape; focus goes in on open and back on close
// The letter RITUAL (when it opens, the ducking, "read" bookkeeping) is Phase 27; this is only the page she reads on.

export interface LetterReaderOptions {
  parent?: HTMLElement;
  text: string;
  reducedMotion: boolean;
  /** accessible name of the close button (plain functional words, from the caller) */
  closeLabel: string;
  /** accessible name of the panel */
  panelLabel: string;
  onToggle?: (open: boolean) => void;
  /** the owner's sign-off lines (from content/credits.json), shown quietly under the letter in their own block, never inside the letter's text */
  signOff?: readonly string[];
  /** called as she scrolls (the ritual reports how far down she is) */
  onScroll?: () => void;
}

export interface LetterReader {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** 0..1 how far down the letter she has scrolled (for Phase 27's "read" check) */
  progress(): number;
  dispose(): void;
}

const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export function createLetterReader(o: LetterReaderOptions): LetterReader {
  const parent = o.parent ?? document.body;
  const root = document.createElement('div');
  root.className = 'wl-letter' + (o.reducedMotion ? ' wl-reduced' : '');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', o.panelLabel);
  root.setAttribute('aria-hidden', 'true');
  root.hidden = true;

  const scroller = document.createElement('div');
  scroller.className = 'wl-letter-scroll';
  scroller.tabIndex = 0; // keyboard users can scroll it with the arrow keys
  const column = document.createElement('div');
  column.className = 'wl-letter-text';
  column.textContent = o.text; // exactly as given
  scroller.appendChild(column);
  if (o.signOff && o.signOff.length > 0) {
    const sign = document.createElement('div');
    sign.className = 'wl-letter-signoff';
    for (const line of o.signOff) {
      const p = document.createElement('p');
      p.textContent = line; // exactly as given
      sign.appendChild(p);
    }
    scroller.appendChild(sign);
  }
  if (o.onScroll) scroller.addEventListener('scroll', () => o.onScroll?.(), { passive: true });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'wl-letter-close';
  closeBtn.setAttribute('aria-label', o.closeLabel);
  closeBtn.innerHTML = CLOSE_SVG;

  root.append(scroller, closeBtn);
  parent.appendChild(root);

  let isOpen = false;
  let returnFocus: Element | null = null;

  const onKey = (e: KeyboardEvent): void => {
    if (isOpen && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', () => close());

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    returnFocus = document.activeElement;
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    scroller.scrollTop = 0;
    void root.offsetWidth;
    root.classList.add('wl-letter-in');
    try {
      scroller.focus({ preventScroll: true });
    } catch {
      /* still readable */
    }
    o.onToggle?.(true);
  }
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('wl-letter-in');
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    if (returnFocus instanceof HTMLElement && document.contains(returnFocus) && returnFocus !== document.body) {
      try {
        returnFocus.focus({ preventScroll: true });
      } catch {
        /* nothing to give back to */
      }
    }
    returnFocus = null;
    o.onToggle?.(false);
  }

  return {
    element: root,
    open,
    close,
    get isOpen() {
      return isOpen;
    },
    progress() {
      const max = scroller.scrollHeight - scroller.clientHeight;
      return max <= 0 ? 1 : Math.max(0, Math.min(1, scroller.scrollTop / max));
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
