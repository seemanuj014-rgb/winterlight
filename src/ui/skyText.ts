// Phase 22: the words that go with the five constellations. Plain DOM, no three, no draw calls, no constellations import (the page that owns both wires them together).
//   name   the constellation's name (from content/names.json) fades in softly under its shape, and stays, quietly, once the shape is finished (no fade under reduced motion)
//   wish   the wish card (text EXACTLY as in content/wishes.json: never trimmed, never rewritten; a placeholder shows as it is, so the owner can see where their words go)
//          tap the card or press Escape to put it away; a second wish that arrives meanwhile waits its turn
// Phase 24: the card is now `wishCard.ts` and the look is `theme.css` (classes `wl-card`, `wl-label`). No word is invented here: the only text is the owner's.

import { createWishCard, type WishCard } from './wishCard';

export interface SkyTextOptions {
  /** where to put the elements (default document.body) */
  parent?: HTMLElement;
  /** the canvas, so label positions given in canvas pixels land in the right place */
  canvas: HTMLElement;
  names: Record<string, string>;
  wishes: Record<string, string>;
  reducedMotion: boolean;
  /** called when a wish card opens or closes (the input layer can pause under it) */
  onCard?: (open: boolean, id: string | null) => void;
}

export interface SkyText {
  /** show a finished shape's name (fades in unless `instant`) */
  showName(id: string, instant?: boolean): void;
  /** where a name sits (canvas px), or null to hide it (off screen) */
  place(id: string, at: { x: number; y: number } | null): void;
  showWish(id: string): void;
  hideWish(): void;
  readonly open: boolean;
  readonly current: string | null;
  /** names that are showing */
  readonly named: readonly string[];
  dispose(): void;
}


export function createSkyText(o: SkyTextOptions): SkyText {
  const parent = o.parent ?? document.body;
  const root = document.createElement('div');
  root.className = 'sky-text';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6';
  const labels = new Map<string, HTMLDivElement>();
  const named: string[] = [];

  // Phase 24: no live region here. The wish card announces "name: wish" once when it opens (wishCard.ts); a second region saying the name again would read it twice.

  parent.appendChild(root);
  // the root is click-through; the card inside turns clicks back on (theme.css `.wl-card`)
  const card: WishCard = createWishCard({
    parent: root,
    reducedMotion: o.reducedMotion,
    spokenName: (id) => o.names[id] ?? '',
    onToggle: (open, id) => o.onCard?.(open, id),
  });

  return {
    showName(id, instant = false) {
      if (labels.has(id)) return;
      const el = document.createElement('div');
      el.textContent = o.names[id] ?? '';
      el.setAttribute('aria-hidden', 'true'); // the wish card says the name (with the wish), once
      el.className = 'wl-label';
      el.style.left = '-999px';
      el.style.top = '-999px';
      if (o.reducedMotion || instant) el.style.transition = 'none';
      root.appendChild(el);
      labels.set(id, el);
      named.push(id);
      requestAnimationFrame(() => (el.style.opacity = '0.9'));
      if (o.reducedMotion || instant) el.style.opacity = '0.9';
    },
    place(id, at) {
      const el = labels.get(id);
      if (!el) return;
      if (!at) {
        el.style.visibility = 'hidden';
        return;
      }
      const r = o.canvas.getBoundingClientRect();
      el.style.visibility = 'visible';
      el.style.left = `${r.left + at.x}px`;
      el.style.top = `${r.top + at.y + 6}px`;
    },
    showWish(id) {
      card.show(id, o.wishes[id] ?? '');
    },
    hideWish() {
      card.hide();
    },
    get open() {
      return card.open;
    },
    get current() {
      return card.current;
    },
    get named() {
      return [...named];
    },
    dispose() {
      card.dispose();
      root.remove();
    },
  };
}
