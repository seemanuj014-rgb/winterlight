// Phase 24: the wish card as a component. Plain DOM, no three, no draw calls. The look lives in theme.css (class `wl-card`); this file owns the behaviour.
//   text    EXACTLY as given (textContent, never trimmed or rewritten; a TODO_OWNER placeholder shows as it is)
//   close   a tap on the card, Escape, or Enter / Space while the card has focus
//   focus   the card takes focus when it opens (so a keyboard or screen-reader user lands on the words) and gives it back when it closes
//   queue   a second wish that arrives while one is open waits its turn
// The wording of the tiny "tap to close" cue is NOT here: it is optional, empty by default, and any words come from the caller (content/), never from this file.

export interface WishCardOptions {
  parent: HTMLElement;
  reducedMotion: boolean;
  /** optional tiny closing cue shown under the wish (plain words from content/, or leave out) */
  closeCue?: string;
  /** called when the card opens or closes */
  onToggle?: (open: boolean, id: string | null) => void;
  /** the spoken name that goes before the wish for a screen reader (e.g. the constellation's name) */
  spokenName?: (id: string) => string;
}

export interface WishCard {
  readonly element: HTMLElement;
  show(id: string, text: string): void;
  hide(): void;
  readonly open: boolean;
  readonly current: string | null;
  dispose(): void;
}

export function createWishCard(o: WishCardOptions): WishCard {
  const card = document.createElement('div');
  card.id = 'wish-card';
  card.className = 'wl-card';
  card.tabIndex = -1;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false'); // the sky behind stays reachable by a tap on a finished star
  card.setAttribute('aria-hidden', 'true');
  const body = document.createElement('span');
  card.appendChild(body);
  if (o.closeCue) {
    const cue = document.createElement('span');
    cue.className = 'wl-card-close';
    cue.textContent = o.closeCue;
    cue.setAttribute('aria-hidden', 'true');
    card.appendChild(cue);
  }
  // a polite live region says name + wish once (the card itself is a dialog, so it is not also announced twice)
  const live = document.createElement('div');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
  o.parent.append(live, card);
  if (o.reducedMotion) card.style.transition = 'none';

  let openId: string | null = null;
  let returnFocus: Element | null = null;
  const queue: Array<{ id: string; text: string }> = [];

  function openNow(id: string, text: string): void {
    openId = id;
    body.textContent = text;
    card.style.display = 'block';
    card.setAttribute('aria-hidden', 'false');
    void card.offsetWidth; // let the fade start from 0
    card.style.opacity = '1';
    const name = o.spokenName?.(id) ?? '';
    // a dialog needs a name: the constellation's own name (from content/names.json), or none at all
    if (name) card.setAttribute('aria-label', name);
    else card.removeAttribute('aria-label');
    live.textContent = `${name}${name ? ': ' : ''}${text}`;
    returnFocus = document.activeElement;
    card.scrollTop = 0;
    const take = (): void => {
      try {
        card.focus({ preventScroll: true });
      } catch {
        /* a browser without focus options: the card is still readable */
      }
    };
    take();
    // a touch tap opens the card on pointer-up and the browser then moves focus to the canvas for the click that follows: take it back once, a moment later
    setTimeout(() => {
      if (openId === id && document.activeElement !== card) take();
    }, 60);
    o.onToggle?.(true, id);
  }

  function close(): void {
    if (openId === null) return;
    const was = openId;
    openId = null;
    card.style.opacity = '0';
    card.style.display = 'none';
    card.setAttribute('aria-hidden', 'true');
    if (returnFocus instanceof HTMLElement && document.contains(returnFocus) && returnFocus !== document.body) {
      try {
        returnFocus.focus({ preventScroll: true });
      } catch {
        /* nothing to give back to */
      }
    }
    returnFocus = null;
    o.onToggle?.(false, was);
    const next = queue.shift();
    if (next) openNow(next.id, next.text);
  }

  const onKey = (e: KeyboardEvent): void => {
    if (openId === null) return;
    if (e.key === 'Escape' || ((e.key === 'Enter' || e.key === ' ') && document.activeElement === card)) {
      e.preventDefault();
      close();
    }
  };
  card.addEventListener('click', close);
  window.addEventListener('keydown', onKey);

  return {
    element: card,
    show(id, text) {
      if (openId === id || queue.some((q) => q.id === id)) return;
      if (openId === null) openNow(id, text);
      else queue.push({ id, text });
    },
    hide: close,
    get open() {
      return openId !== null;
    },
    get current() {
      return openId;
    },
    dispose() {
      card.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
      card.remove();
      live.remove();
    },
  };
}
