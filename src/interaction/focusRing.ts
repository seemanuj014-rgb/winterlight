// Phase 20: the soft ring that shows where the keyboard's focus is (Tab to an animal, then hold Space or Enter). Plain DOM, no draw calls. The same look as Phase 19's ring
// (`acts/hud.ts`); it is repeated here because only `main.ts` may import `acts/`. Phase 24 (the UI layer) can merge the two.
export interface FocusRing {
  show(x: number, y: number, diameterPx: number): void;
  hide(): void;
  dispose(): void;
}
export function createFocusRing(): FocusRing {
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;display:none;border:2px solid rgba(255,226,170,.9);border-radius:50%;box-shadow:0 0 14px rgba(255,214,150,.55);pointer-events:none;z-index:5;transform:translate(-50%,-50%)';
  document.body.appendChild(ring);
  return {
    show(x, y, d) {
      ring.style.display = 'block';
      ring.style.width = `${d}px`;
      ring.style.height = `${d}px`;
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
    },
    hide() {
      ring.style.display = 'none';
    },
    dispose() {
      ring.remove();
    },
  };
}
