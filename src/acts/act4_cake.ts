import type * as THREE from 'three';
import type { Cake } from '../world/cake';
import { CAKE_TARGET, CANDLE_COUNT, CANDLE_TARGET_R } from '../world/cakeMath';
import { createInput, createPicker, createHaptics } from '../input';
import { createMic, type Mic, type MicResult } from '../audio/mic';
import type { BlowReading } from '../audio/blow';
import { createBus, type Bus, type WinterEvents } from '../state/events';
import { CakeMachine, type CakeEvent } from './cakeMath';
import { createFocusRing, type Hud } from './hud';

// Phase 25, Act 4: the cake and the candles. The rules and the timing are in `cakeMath.ts` (`CakeMachine`, tested) and the breath is measured by `audio/blow.ts` (tested on
// synthetic buffers). This file only joins them to the browser:
//   - the TAP FALLBACK, which always works and never depends on the microphone: a tap on a candle puts that one out; a tap on the cake itself (a big target, so a thumb never has
//     to hit a wick) puts out the next lit one; Tab to the cake then Enter / Space does the same. Mouse and touch go through the Phase 18 input layer.
//   - the MICROPHONE, asked for ONLY when the candle moment begins (`machine.micWanted` turns true), never before, never shown any UI of ours; denied, missing or throwing it
//     resolves quietly and the taps carry on. It is stopped the moment the moment ends (`micWanted` false) and on dispose. Nothing is recorded, stored or sent (`audio/mic.ts`).
//   - the events: `act:enter {act:4}` when the cake begins, `cake:wish {on}` around the wish beat, `candle:out {index, left}` per flame, `act:done {act:4}` once at the end.
//   - haptics: a soft buzz per candle, a longer `done` at the end (the browser only ever sees `navigator.vibrate`; iOS has none).
// Nothing here draws: no draw calls. In the full card Phase 28 creates this with the real world; `?cake` (`cakeView.ts`) is the test view.

export type MicState = 'idle' | 'asked' | MicResult;

export interface CakeActOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  cake: Cake;
  hud: Hud | null;
  reduced: boolean;
  /** false = never ask for the microphone (test knob `&nomic`); taps still work */
  mic?: boolean;
  /** test seam: a fake microphone (tests/cake.test.ts style). Default is the real one. */
  makeMic?: (onReading: (r: BlowReading) => void) => Mic;
  bus?: Bus<WinterEvents>;
}

export interface CakeAct {
  readonly machine: CakeMachine;
  readonly bus: Bus<WinterEvents>;
  /** start the cake appearing */
  start(): void;
  /**
   * One fixed step. `scripted` stands in for the microphone in a test view (a breath at a known time); when it is given, the real microphone is not asked at all.
   * Order inside: the viewer's taps, the breath, the machine, the microphone's on/off, the words.
   */
  step(dt: number, scripted?: { blowing: boolean; strength: number }): void;
  /** every rendered frame: the cake's look from the machine, and the keyboard's focus ring */
  render(): void;
  /** what the viewer may be doing now (for tests and for `window.__cake`) */
  state(): { phase: string; lit: number; mic: MicState; micListening: boolean; focus: string | null; done: boolean; reading: BlowReading | null };
  /** where a target is on screen, for the real-input checks */
  screenOf(id: string): { x: number; y: number; radiusPx: number } | null;
  /** tell the picker the size of the view (px) */
  resize(width: number, height: number): void;
  /** ignore the viewer while false (a frozen test frame) */
  setEnabled(on: boolean): void;
  dispose(): void;
}

/** a breath reading older than this is not a breath any more (the mic stalled, the tab slept) */
const READING_FRESH_S = 0.4;

export function createCakeAct(o: CakeActOptions): CakeAct {
  const bus = o.bus ?? createBus<WinterEvents>();
  const picker = createPicker(o.camera);
  const haptics = createHaptics();
  const ring = createFocusRing();
  const input = createInput({
    element: o.canvas,
    resolve: (x, y, kind) => picker.pick(x, y, kind),
    // keyboard: one stop, the cake. Enter or Space on it puts out the next lit candle (the same as a tap on it).
    keyboard: { ids: () => (machine.litCount > 0 ? ['cake'] : []), positionOf: (id) => picker.screenOf(id) },
  });

  // ---- the machine and what it tells the rest of the card -----------------------------------------------------------------------------------
  let done = false;
  let wishOn = false;
  const onEvent = (e: CakeEvent): void => {
    switch (e.type) {
      case 'begin':
        bus.emit('act:enter', { act: 4 });
        break;
      case 'wish':
        wishOn = true;
        bus.emit('cake:wish', { on: true });
        break;
      case 'ready':
        if (wishOn) {
          wishOn = false;
          bus.emit('cake:wish', { on: false });
        }
        break;
      case 'candle':
        bus.emit('candle:out', { index: e.candle ?? 0, left: e.left ?? 0 });
        haptics.pulse('soft');
        break;
      case 'done':
        if (!done) {
          done = true;
          haptics.pulse('done');
          bus.emit('act:done', { act: 4 });
        }
        break;
      default:
        break;
    }
  };
  const machine = new CakeMachine({ reducedMotion: o.reduced, onEvent });

  // ---- the targets: five small candles (they win where they overlap) and the whole cake (the big, forgiving one) --------------------------------
  for (let i = 0; i < CANDLE_COUNT; i++) {
    picker.add({ id: `candle${i}`, object: o.cake.proxies.candles[i]!, centre: () => o.cake.flameWorld(i), radius: CANDLE_TARGET_R, priority: 2 });
  }
  picker.add({ id: 'cake', object: o.cake.proxies.cake, centre: () => o.cake.cakeWorld(), radius: CAKE_TARGET.radius, priority: 1 });

  let enabled = true;
  const tapOn = (id: string | null): void => {
    if (!enabled || id === null) return;
    const m = /^candle(\d)$/.exec(id);
    // a tap on a candle that is already out does nothing; a tap on the cake puts out the next lit one
    const went = m ? machine.tap(Number(m[1])) : id === 'cake' ? machine.tap(null) : false;
    if (!went && id !== null) haptics.pulse('tick');
  };
  const off = [
    // `target` is what was under the finger when the gesture began, so a drag that wanders off a candle is still a tap on neither: only a real tap counts
    input.on('tap', (e) => tapOn(e.target)),
  ];
  // a keyboard user's first Tab lands on the canvas itself, where the input layer hears nothing (found in Phase 19): hand that first Tab to the input layer, for keyboard focus only
  const onCanvasFocus = (): void => {
    if (input.focusId !== null) return;
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

  // ---- the microphone: asked once, when the candle moment begins ------------------------------------------------------------------------------
  let lastReading: { r: BlowReading; at: number } | null = null;
  let clock = 0;
  let micState: MicState = 'idle';
  const mic: Mic | null =
    o.mic === false
      ? null
      : (o.makeMic ?? ((onReading) => createMic({ onReading })))((r) => {
          lastReading = { r, at: clock };
        });
  let asked = false;

  const api: CakeAct = {
    machine,
    bus,
    start() {
      machine.begin();
    },
    step(dt, scripted) {
      clock += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      // the breath: a script (test views) or the microphone's newest fresh reading; otherwise nobody is blowing
      let blowing = false;
      let strength = 0;
      if (scripted) ({ blowing, strength } = scripted);
      else if (lastReading && clock - lastReading.at <= READING_FRESH_S) ({ blowing, strength } = lastReading.r);
      machine.setBlow(enabled && blowing, strength);
      machine.update(dt);
      // ask for the microphone the first time the candle moment is on, and let go of it the moment it is over
      if (mic && !scripted) {
        if (machine.micWanted && !asked) {
          asked = true;
          micState = 'asked';
          void mic.request().then((r) => {
            micState = r;
            // the moment may have ended while the browser's prompt was open: do not keep a microphone nobody wants
            if (!machine.micWanted) mic.stop();
          });
        } else if (!machine.micWanted && mic.listening) {
          mic.stop();
          lastReading = null;
        }
      }
    },
    render() {
      const id = input.focusId;
      const f = id ? picker.screenOf(id) : null;
      if (f && enabled) {
        const r = o.canvas.getBoundingClientRect();
        ring.show(r.left + f.x, r.top + f.y, Math.max(44, f.radiusPx * 2 + 14));
      } else ring.hide();
      o.cake.set(machine.candleViews, machine.appear, machine.light, machine.time);
      o.hud?.set(machine.hint, machine.line);
    },
    state() {
      return { phase: machine.phase, lit: machine.litCount, mic: micState, micListening: !!mic?.listening, focus: input.focusId, done, reading: lastReading ? lastReading.r : null };
    },
    screenOf: (id) => picker.screenOf(id),
    resize: (w, h) => picker.resize(w, h),
    setEnabled(on) {
      enabled = on;
      input.setEnabled(on);
    },
    dispose() {
      for (const f of off) f();
      o.canvas.removeEventListener('focus', onCanvasFocus);
      mic?.stop();
      input.dispose();
      ring.dispose();
    },
  };
  return api;
}
