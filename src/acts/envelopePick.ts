import type * as THREE from 'three';
import type { Envelope } from '../world/envelope';
import { createInput, createPicker, createHaptics } from '../input';
import { createFocusRing } from './hud';
import type { LetterAct } from './act5_letter';

// Phase 27: pick the envelope in the real 3D scene with the Phase 18 picker, the way `act4_cake.ts` picks the cake. It replaces the session 3 test tap button.
//   - a tap or click on the envelope (a generous target: the picker's own minimum on screen, never less than the touch rule) calls `act.open()`; the machine itself refuses it unless the envelope is waiting;
//   - one keyboard stop, the envelope: Tab to it (the focus ring shows), Enter or Space opens it; there is no stop while it cannot be opened (still drifting, already open, being read);
//   - nothing here draws (the ring is DOM) and nothing has words except the ring, which has none.
// In the full card Phase 28 creates this with the real camera and canvas; `?envelope` (`envelopeView.ts`) is the test view.

export interface EnvelopePick {
  /** every rendered frame: the keyboard's focus ring */
  render(): void;
  /** the envelope's centre on screen (px, canvas space) and its target radius, or null while there is nothing to pick */
  screenOf(): { x: number; y: number; radiusPx: number } | null;
  /** id of the keyboard stop, or null */
  focus(): string | null;
  resize(widthPx: number, heightPx: number): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

const ID = 'envelope';

export function createEnvelopePick(o: { camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; envelope: Envelope; act: LetterAct }): EnvelopePick {
  const { act, envelope } = o;
  const picker = createPicker(o.camera);
  const haptics = createHaptics();
  const ring = createFocusRing();
  const input = createInput({
    element: o.canvas,
    resolve: (x, y, kind) => (act.machine.canOpen ? picker.pick(x, y, kind) : null),
    keyboard: { ids: () => (act.machine.canOpen ? [ID] : []), positionOf: (id) => picker.screenOf(id) },
  });
  picker.add({ id: ID, object: envelope.proxy, centre: () => envelope.centreWorld(), radius: envelope.targetRadius, priority: 1 });

  let enabled = true;
  const off = [
    input.on('tap', (e) => {
      if (!enabled || e.target !== ID) return;
      if (act.open()) haptics.pulse('soft');
      else haptics.pulse('tick');
    }),
  ];
  // a keyboard user's first Tab lands on the canvas itself, where the input layer hears nothing (found in Phase 19): hand that first Tab to the input layer, for keyboard focus only
  const onCanvasFocus = (): void => {
    if (input.focusId !== null || !act.machine.canOpen) return;
    let visible = false;
    try {
      visible = o.canvas.matches(':focus-visible');
    } catch {
      visible = false;
    }
    if (!visible) return;
    for (const type of ['keydown', 'keyup'] as const) o.canvas.dispatchEvent(new KeyboardEvent(type, { key: 'Tab', bubbles: false, cancelable: true }));
  };
  o.canvas.addEventListener('focus', onCanvasFocus);

  return {
    render() {
      const f = enabled && act.machine.canOpen && input.focusId === ID ? picker.screenOf(ID) : null;
      if (f) {
        const r = o.canvas.getBoundingClientRect();
        ring.show(r.left + f.x, r.top + f.y, Math.max(44, f.radiusPx * 2 + 14));
      } else ring.hide();
    },
    screenOf: () => picker.screenOf(ID),
    focus: () => input.focusId,
    resize: (w, h) => picker.resize(w, h),
    setEnabled(on) {
      enabled = on;
      input.setEnabled(on);
    },
    dispose() {
      for (const f of off) f();
      o.canvas.removeEventListener('focus', onCanvasFocus);
      input.dispose();
      ring.dispose();
    },
  };
}
