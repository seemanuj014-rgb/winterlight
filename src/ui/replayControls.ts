// Phase 24: the replay controls. Plain DOM, no three, no draw calls, no audio or constellations import (the page that owns both hands in what each button does).
// Two small round buttons under the sound button, right edge, one per thing worth hearing or seeing again:
//   music   the music-box tune again
//   wishes  the finished constellations' wish cards again, one after another
//   finale  (Phase 28, stay a while only) the ending again; `letter` (Phase 27) is the other way out of stay a while
// A button exists only when the caller adds it, and `setVisible` hides one that has nothing to replay yet (a shape not finished). Hidden = not in the tab order.
// The WORDS are only the accessible names (plain functional labels, flagged for the owner like the sound button's). The look is theme.css (`.wl-replay`, `.wl-replay-btn`).

export type ReplayKind = 'music' | 'wishes' | 'finale' | 'letter';

export const REPLAY_LABELS: Record<ReplayKind, string> = {
  music: 'Play the music box tune again',
  wishes: 'Show the wishes again',
  finale: 'Play the ending again',
  letter: 'Read the letter again',
};

const ICONS: Record<ReplayKind, string> = {
  music: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 17.5V6.5l9-2v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="6.8" cy="17.6" rx="2.6" ry="2.1" fill="currentColor"/><ellipse cx="15.8" cy="15.6" rx="2.6" ry="2.1" fill="currentColor"/></svg>',
  wishes: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3.5l2.3 5.6 6 .5-4.6 3.9 1.4 5.9L12 16.4 6.9 19.4l1.4-5.9L3.7 9.6l6-.5L12 3.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  finale: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19.8 3.8v4.4h-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  letter: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3.6" y="6" width="16.8" height="12" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
};

export interface ReplayControls {
  /** add (or replace) the button for `kind`; `press` runs on a click or Enter / Space */
  add(kind: ReplayKind, press: () => void, opts?: { visible?: boolean; label?: string }): HTMLButtonElement;
  setVisible(kind: ReplayKind, on: boolean): void;
  has(kind: ReplayKind): boolean;
  readonly element: HTMLElement;
  dispose(): void;
}

const shared = new WeakMap<HTMLElement, ReplayControls>();

/** One bar per page: the music button (added by whoever owns the sound) and the wishes button (added by whoever owns the sky) land in the same column. */
export function replayControls(parent: HTMLElement = document.body): ReplayControls {
  let c = shared.get(parent);
  if (!c || !c.element.isConnected) {
    c = createReplayControls(parent);
    shared.set(parent, c);
  }
  return c;
}

export function createReplayControls(parent: HTMLElement = document.body): ReplayControls {
  const bar = document.createElement('div');
  bar.className = 'wl-replay';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Replay');
  const buttons = new Map<ReplayKind, HTMLButtonElement>();
  // tab order: the sound button first, then these, then the scene. The page's canvas is earlier in the document, so these go at the START of the body, after the sound button when it exists.
  const mute = parent.querySelector('.mute-button');
  if (mute && mute.parentElement === parent) mute.after(bar);
  else parent.prepend(bar);

  const order: ReplayKind[] = ['music', 'wishes', 'finale', 'letter'];
  const sync = (): void => {
    // keep the order, but move a button only when it is out of place: moving a DOM node drops its focus, and a button that is already where it belongs must keep it
    const want = order.map((k) => buttons.get(k)).filter((b): b is HTMLButtonElement => !!b);
    want.forEach((b, i) => {
      if (bar.children[i] !== b) bar.insertBefore(b, bar.children[i] ?? null);
    });
    bar.hidden = ![...buttons.values()].some((b) => !b.hidden);
  };

  return {
    element: bar,
    add(kind, press, opts = {}) {
      buttons.get(kind)?.remove();
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `wl-replay-btn wl-replay-${kind}`;
      b.innerHTML = ICONS[kind];
      b.setAttribute('aria-label', opts.label ?? REPLAY_LABELS[kind]);
      b.hidden = opts.visible === false;
      b.addEventListener('click', () => {
        try {
          press();
        } catch {
          /* a replay must never throw into the card */
        }
      });
      buttons.set(kind, b);
      sync();
      return b;
    },
    setVisible(kind, on) {
      const b = buttons.get(kind);
      if (!b) return;
      b.hidden = !on;
      sync();
    },
    has: (kind) => buttons.has(kind),
    dispose() {
      bar.remove();
      buttons.clear();
    },
  };
}
