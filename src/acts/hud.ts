// Phase 24 (scrim): a soft dark backing (62 % night-brown, THEME.hintScrim) sits behind the hint and the line so they stay readable over the pale pillow and blanket; the contrast table checks it against every nook colour.
// Phase 19: the two small things the acts put on the page: the hint ("hold to wake Chamgadad") and, if the viewer waits, the owner's line.
// Plain DOM, nothing drawn in the scene (no draw calls). The look is a first pass: tiny, gentle, no box (ART_DIRECTION: UI hints are tiny and gentle, not instructions
// shouting). Phase 24 moved their colour, font and safe areas to theme.css variables (fallbacks kept so a page without the theme still works); self-hosted fonts wait for the owner's language answer; the owner's line is set as text, never as an image, so it can be read aloud.

export interface Hud {
  /** 0..1 each */
  set(hint: number, line: number): void;
  dispose(): void;
}

const css = `
.wl-hud{position:fixed;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 calc(20px + var(--wl-safe-right,0px)) calc(34px + var(--wl-safe-bottom,0px)) calc(20px + var(--wl-safe-left,0px));pointer-events:none;z-index:6;text-align:center}
.wl-hud p{margin:0;max-width:min(30em,86vw);color:var(--wl-hint,#f1e6d2);font-family:var(--wl-font-ui,ui-rounded,'SF Pro Rounded','Nunito','Segoe UI',system-ui,sans-serif);text-shadow:0 1px 8px rgba(8,6,4,.85),0 0 2px rgba(8,6,4,.9);background:rgba(8,6,4,.62);padding:.3em .85em;border-radius:14px;opacity:0;transition:none}
.wl-hud p:empty{display:none}
.wl-hud .wl-line{font-size:clamp(18px,4.8vw,24px);line-height:1.4;font-weight:600}
.wl-hud .wl-hint{font-size:clamp(12px,3.3vw,14px);letter-spacing:.04em;opacity:0}
`;

export function createHud(opts: { hint: string; line: string | null }): Hud {
  const style = document.createElement('style');
  style.textContent = css;
  const box = document.createElement('div');
  box.className = 'wl-hud';
  const line = document.createElement('p');
  line.className = 'wl-line';
  line.textContent = opts.line ?? '';
  const hint = document.createElement('p');
  hint.className = 'wl-hint';
  hint.textContent = opts.hint;
  // read by a screen reader when they appear (the words are real text, not painted on the canvas)
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.append(line, hint);
  document.head.appendChild(style);
  document.body.appendChild(box);
  let lastHint = -1;
  let lastLine = -1;
  return {
    set(h, l) {
      const hh = Math.round(Math.max(0, Math.min(1, h)) * 100) / 100;
      const ll = Math.round(Math.max(0, Math.min(1, l)) * 100) / 100;
      if (hh !== lastHint) {
        lastHint = hh;
        hint.style.opacity = String(hh);
        hint.setAttribute('aria-hidden', hh < 0.05 ? 'true' : 'false');
      }
      if (ll !== lastLine) {
        lastLine = ll;
        line.style.opacity = String(ll);
        line.setAttribute('aria-hidden', ll < 0.05 ? 'true' : 'false');
      }
    },
    dispose() {
      box.remove();
      style.remove();
    },
  };
}

/** A soft ring for the keyboard's focus (Tab to her, then hold Space or Enter). Follows her on screen; hidden otherwise. */
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
