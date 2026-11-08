import type { ActWorld, ActsHook } from '../world/actWorld';
import type { Frame } from '../core/directorMath';
import { createInput, createPicker, createHaptics } from '../input';
import { createBus, type WinterEvents, type Bus } from '../state/events';
import { createProgress, type ProgressStore } from '../state/progress';
import nookRaw from '../../content/nook.json?raw';
import { HINT_TEXT, parseNookLine, parseScript, type LogEntry } from './actsMath';
import { createAct1, type Act1, type ActIO } from './act1_nook';
import { createAct2, type Act2 } from './act2_door';
import { createFocusRing, createHud } from './hud';

// Phase 19: Acts 1 and 2 as one run: the sleepy nook, then the door and the push-out into the snow. Phase 21 and later add the acts after it.
// `createActs` builds the input layer on the canvas, the two acts and their words, and hands the world's loop an `ActsHook`.
// Test hooks (all opt-in): `window.__acts` = { state(), log(), bus } for reading what happened; the `?acts` URL knobs are in `main.ts` / `tourView.ts`
// (`&hold=3-7`, `&tap=9,10`, `&pointer=0.4,0.2` script a viewer so a frame sequence repeats exactly).

declare global {
  interface Window {
    __acts?: { state(): Record<string, unknown>; log(): LogEntry[]; bus: Bus<WinterEvents>; progress: ProgressStore };
  }
}

export interface Acts extends ActsHook {
  readonly bus: Bus<WinterEvents>;
  readonly progress: ProgressStore;
  readonly act: 1 | 2;
  dispose(): void;
}

export function createActs(world: ActWorld, ctx: { canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean }): Acts {
  const bus = createBus<WinterEvents>();
  const progress = createProgress();
  const picker = createPicker(world.camera);
  const haptics = createHaptics();
  const input = createInput({
    element: ctx.canvas,
    resolve: (x, y, kind) => picker.pick(x, y, kind),
    keyboard: { ids: () => picker.ids(), positionOf: (id) => picker.screenOf(id) },
  });
  const line = parseNookLine(nookRaw);
  const hud = createHud({ hint: HINT_TEXT, line });
  const ring = createFocusRing();
  const script = parseScript(ctx.params);
  // A keyboard user's first Tab lands on the canvas itself, where the input layer hears nothing yet: no ring, and the first Space would only put the ring up.
  // Found in the browser (Phase 19): hand that first Tab to the input layer, so the ring is on her at once and one Space or Enter held wakes her.
  // Only for keyboard focus (`:focus-visible`), never for a click or a touch.
  const onCanvasFocus = (): void => {
    if (input.focusId !== null) return;
    let visible = false;
    try {
      visible = ctx.canvas.matches(':focus-visible');
    } catch {
      visible = false;
    }
    if (!visible) return;
    for (const type of ['keydown', 'keyup'] as const) ctx.canvas.dispatchEvent(new KeyboardEvent(type, { key: 'Tab', bubbles: false, cancelable: true }));
  };
  ctx.canvas.addEventListener('focus', onCanvasFocus);
  const io: ActIO = { input, picker, haptics, bus, progress, hud, script, reduced: ctx.reduced };
  const act1: Act1 = createAct1(world, io, line);
  const act2: Act2 = createAct2(world, io);
  let act: 1 | 2 = 1;
  let last: Record<string, unknown> = {};
  if (ctx.params.has('debug')) {
    bus.on('act:enter', (e) => console.log('[acts] enter', e.act));
    bus.on('secret:found', (e) => console.log('[acts] secret', e.id));
    bus.on('act:done', (e) => console.log('[acts] done', e.act));
  }

  window.__acts = {
    state: () => last,
    log: () => [...act1.log.map((e) => ({ ...e, act: 1 })), ...(act2.machine ? act2.log.map((e) => ({ ...e, act: 2 })) : [])],
    bus,
    progress,
  };

  return {
    bus,
    progress,
    get act() {
      return act;
    },
    start() {
      act1.start();
    },
    step(dt: number, frame: Frame) {
      if (act === 1) {
        const o = act1.step(dt, frame);
        last = { act: 1, phase: o.phase, progress: Number(o.progress.toFixed(3)), lamp: Number(o.lamp.toFixed(3)), hint: Number(o.hint.toFixed(2)), line: Number(o.line.toFixed(2)), deep: Number(o.deep.toFixed(2)), shot: frame.shot, location: world.location };
        if (act1.done) {
          act = 2;
          act2.start();
        }
      } else {
        const o = act2.step(dt, frame);
        last = { act: 2, phase: o.phase, door: Number(o.nookDoor.toFixed(2)), shot: frame.shot, shotElapsed: Number(frame.elapsed.toFixed(2)), location: world.location };
      }
    },
    render() {
      const id = input.focusId;
      const f = id ? picker.screenOf(id) : null;
      if (f) {
        const r = ctx.canvas.getBoundingClientRect();
        ring.show(r.left + f.x, r.top + f.y, Math.max(44, f.radiusPx * 2 + 14));
      } else ring.hide();
    },
    resize(w, h) {
      picker.resize(w, h);
    },
    dispose() {
      ctx.canvas.removeEventListener('focus', onCanvasFocus);
      act1.dispose();
      input.dispose();
      hud.dispose();
      ring.dispose();
    },
  };
}
