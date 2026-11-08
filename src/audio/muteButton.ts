import type { AudioEngine } from './engine';

// Phase 23: the mute button. Always on screen (top right, clear of the notch), a real <button>, plain DOM, no draw calls.
// It is also the first touch many people make, so tapping it unlocks the sound as well. The pictogram is drawn with SVG (no emoji, no font).
// The words are only the accessible name ("Sound on" / "Sound off"): plain functional labels, flagged for the owner like the loading words. Phase 24 moved its look to theme.css (class `mute-button`).

const ON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const OFF = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export const MUTE_LABELS = { on: 'Sound on. Tap to turn it off.', off: 'Sound off. Tap to turn it on.' } as const;

export interface MuteButton {
  readonly element: HTMLButtonElement;
  dispose(): void;
}

export function createMuteButton(engine: AudioEngine, parent: HTMLElement = document.body): MuteButton {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mute-button';
  // the look is `.mute-button` in src/ui/theme.css (audio/ may not import ui/, so it names the class and nothing more)
  const paint = (): void => {
    const m = engine.muted;
    b.innerHTML = m ? OFF : ON;
    b.setAttribute('aria-label', m ? MUTE_LABELS.off : MUTE_LABELS.on);
    b.setAttribute('aria-pressed', m ? 'true' : 'false');
  };
  b.addEventListener('click', () => {
    engine.unlock();
    engine.toggleMuted();
  });
  paint();
  const off = engine.onChange(paint);
  // first in the tab order (the page's canvas comes earlier in the document), so a keyboard user reaches the sound button before the scene
  parent.prepend(b);
  return {
    element: b,
    dispose() {
      off();
      b.remove();
    },
  };
}
