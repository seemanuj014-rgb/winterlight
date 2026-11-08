import * as THREE from 'three';
import type { ActWorld, ActsHook } from '../world/actWorld';
import type { Frame } from '../core/directorMath';
import { FIXED_DT } from '../core/loop';
import { SHOTS } from '../world/shots';
import { terrainHeight } from '../world/groundMath';
import { createInput, createPicker, createHaptics, type PointerKind } from '../input';
import { createBus, type Bus, type WinterEvents } from '../state/events';
import { PetMachine, parsePetScript, petScriptAt, type LogEntry, type PetEvent, type V2 } from './petMath';
import { createFocusRing } from './focusRing';

// Phase 20: touching the animals. This file only listens to the input layer (Phase 18) and writes the machine's answers (`petMath.ts`, tested) onto the world.
//   the cat     drag over her (or hold a hand on her) to pet her: she purrs, flicks an ear, slow-blinks back; a tap is one ear flick
//   the bunny   hold a finger on the snow near her and she hops toward it; a sudden tap on or near her sends her off to hide, then she peeks and comes back
//   Chamgadad   leans toward whichever one is happy; the slow blink and the ear flick are hers too (no mouth is drawn: Q1 is the owner's)
// Keyboard: Tab to the animal, then Enter / Space (hold = a hand on her, quick = a tap) and the arrow keys while held (= stroking). A held key near the bunny holds a hand out in front of her.
// `?pet` (cat) / `?pet=bunny` is the test view (`tourView.ts` + `main.ts`); the real card calls `createPet` from the "stay a while" mode (Phase 28). Nothing here draws: no draw calls.
// Test knobs (`petMath.ts` `parsePetScript`): `&stroke=3-9`, `&rest=3-9`, `&tapcat=4`, `&finger=2-9@x:z`, `&tapat=6@x:z` script a viewer so a frame sequence repeats exactly; `&catstate=sleep` leaves the cat asleep.

declare global {
  interface Window {
    __pet?: { state(): Record<string, unknown>; log(): LogEntry[]; bus: Bus<WinterEvents>; screenOf(id: 'cat' | 'bunny'): { x: number; y: number; radiusPx: number } | null };
  }
}

export type PetPlace = 'cat' | 'bunny';

export interface Pet extends ActsHook {
  readonly bus: Bus<WinterEvents>;
  readonly machine: PetMachine;
  dispose(): void;
}

/** How big the cat counts for stroking, in metres (a ball round her; a finger sweeping across her is about two of these). */
const CAT_RADIUS = 0.2;
const BUNNY_RADIUS = 0.3;
const BUNNY_HOME = { x: -1.1, z: -3.4 } as const;
const BUNNY_LEASH = 1.2;
/** A key held on the bunny holds a hand out this far in front of her, toward the viewer (m). */
const KEY_REACH = 1.0;

export function createPet(world: ActWorld, ctx: { canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean; place: PetPlace }): Pet {
  const { canvas, params, place } = ctx;
  const bus = createBus<WinterEvents>();
  const picker = createPicker(world.camera);
  const haptics = createHaptics();
  const input = createInput({
    element: canvas,
    resolve: (x, y, kind) => picker.pick(x, y, kind),
    keyboard: { ids: () => picker.ids(), positionOf: (id) => picker.screenOf(id) },
  });
  const ring = createFocusRing();
  const script = parsePetScript(params);
  // In this view the bunny lives a little nearer Chamgadad than her spot in the tour, on a short leash, so that a startled hop still ends inside a phone's narrow frame `[A]`.
  const machine = new PetMachine({ bunnyHome: { x: BUNNY_HOME.x, z: BUNNY_HOME.z }, bunnyYaw: world.bunny.root.rotation.y, bunnyLeash: BUNNY_LEASH });
  picker.add({ id: 'cat', object: world.cat.root, radius: CAT_RADIUS });
  picker.add({ id: 'bunny', object: world.bunny.root, radius: BUNNY_RADIUS });

  // A keyboard user's first Tab lands on the canvas itself, where the input layer hears nothing yet (found in Phase 19): hand that first Tab to the input layer so the ring is
  // on the animal at once. Only for keyboard focus (`:focus-visible`), never for a click or a touch.
  const onCanvasFocus = (): void => {
    if (input.focusId !== null) return;
    let visible = false;
    try {
      visible = canvas.matches(':focus-visible');
    } catch {
      visible = false;
    }
    if (!visible) return;
    for (const type of ['keydown', 'keyup'] as const) canvas.dispatchEvent(new KeyboardEvent(type, { key: 'Tab', bubbles: false, cancelable: true }));
  };
  canvas.addEventListener('focus', onCanvasFocus);

  // ---- what the finger is doing (written by the input events, read once a step) ---------------------------------------------------------------
  let phase: 'none' | 'press' | 'hold' | 'drag' = 'none';
  let target: string | null = null;
  let kind: PointerKind = 'touch';
  let px = 0;
  let py = 0;
  let movedPx = 0;
  let catTaps = 0;
  let groundTap: { at: V2; on: boolean } | null = null;
  let keyFinger: V2 | null = null;
  let view = { w: 1, h: 1 };
  let t = 0;
  let prevT = 0;
  let last: Record<string, unknown> = {};

  const ndcOf = (x: number, y: number): THREE.Vector2 => new THREE.Vector2((x / view.w) * 2 - 1, -(y / view.h) * 2 + 1);
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  /** where a point on the screen is on the snow round the bunny (world x, z), or null when the ray does not come down to it */
  function ground(ndc: THREE.Vector2): V2 | null {
    plane.constant = -terrainHeight(machine.bunny.x, machine.bunny.z);
    world.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, world.camera);
    const p = ray.ray.intersectPlane(plane, hit);
    return p ? { x: p.x, z: p.z } : null;
  }
  const overCat = (x: number, y: number, k: PointerKind): boolean => picker.pick(x, y, k) === 'cat';

  const offs = [
    input.on('press', (e) => {
      phase = 'press';
      target = e.target;
      kind = e.kind;
      px = e.x;
      py = e.y;
    }),
    input.on('holdstart', (e) => {
      phase = 'hold';
      px = e.x;
      py = e.y;
      if (e.kind === 'key' && e.target === 'bunny') holdKeyHand();
    }),
    input.on('holdend', () => end()),
    input.on('dragstart', (e) => {
      phase = 'drag';
      px = e.x;
      py = e.y;
      if (e.kind === 'key' && e.target === 'bunny') holdKeyHand();
    }),
    input.on('drag', (e) => {
      px = e.x;
      py = e.y;
      if (world.location === 'nook' && (e.kind === 'key' ? e.target === 'cat' : overCat(e.x, e.y, e.kind))) movedPx += Math.hypot(e.ddx, e.ddy);
    }),
    input.on('dragend', () => end()),
    input.on('cancel', () => end()),
    input.on('tap', (e) => {
      end();
      if (world.location === 'nook') {
        if (e.target === 'cat' || (e.kind !== 'key' && overCat(e.x, e.y, e.kind))) catTaps++;
      } else if (e.kind === 'key') {
        if (e.target === 'bunny') groundTap = { at: machine.bunny.pos, on: true };
      } else {
        const g = ground(ndcOf(e.x, e.y));
        if (g) groundTap = { at: g, on: e.target === 'bunny' };
      }
    }),
  ];
  function end(): void {
    phase = 'none';
    keyFinger = null;
  }
  /** a held key near the bunny: a hand held out in front of her, toward the viewer (fixed where it began, so she does not chase it) */
  function holdKeyHand(): void {
    if (keyFinger) return;
    const cx = world.camera.position.x - machine.bunny.x;
    const cz = world.camera.position.z - machine.bunny.z;
    const d = Math.hypot(cx, cz) || 1;
    keyFinger = { x: machine.bunny.x + (cx / d) * KEY_REACH, z: machine.bunny.z + (cz / d) * KEY_REACH };
  }

  /** which way is "toward" the animal, as Chamgadad leans: -1 the viewer's left, +1 the right */
  const right = new THREE.Vector3();
  function sideToward(who: 'cat' | 'bunny'): -1 | 1 {
    world.camera.updateMatrixWorld();
    right.setFromMatrixColumn(world.camera.matrixWorld, 0);
    const a = who === 'cat' ? world.cat.root.position : world.bunny.root.position;
    return (a.x - world.holder.position.x) * right.x + (a.z - world.holder.position.z) * right.z >= 0 ? 1 : -1;
  }

  function emit(e: PetEvent): void {
    if (e.type === 'purrStart') bus.emit('pet:purr', { on: true });
    else if (e.type === 'purrEnd') bus.emit('pet:purr', { on: false });
    else if (e.type === 'bunnyHop') bus.emit('pet:bunny', { kind: 'hop' });
    else if (e.type === 'bunnyArrive') bus.emit('pet:bunny', { kind: 'arrive' });
    else if (e.type === 'bunnyStartle') bus.emit('pet:bunny', { kind: 'startle' });
    else if (e.type === 'bunnyHide') bus.emit('pet:bunny', { kind: 'hide' });
    else if (e.type === 'bunnyPeek') bus.emit('pet:bunny', { kind: 'peek' });
    else if (e.type === 'bunnyBack') bus.emit('pet:bunny', { kind: 'back' });
    if (params.has('debug')) console.log('[pet]', e.type, e.detail ?? '');
  }

  return {
    bus,
    machine,
    start() {
      // she starts awake (the boot left her curled up asleep): let the wake run unseen, as the stage shot of the tour does
      world.actor.behaviour.request('wake');
      if (place === 'cat' && params.get('catstate') !== 'sleep') world.cat.behaviour.request('wake');
      for (let i = 0; i < 400; i++) {
        world.actor.update(FIXED_DT);
        if (place === 'cat') world.cat.update(FIXED_DT);
      }
      world.cameraRig.director.play(SHOTS[place === 'cat' ? 'petCat' : 'petBunny'], { cut: true });
      window.__pet = { state: () => last, log: () => [...machine.log], bus, screenOf: (id) => picker.screenOf(id) }; // `screenOf` is for the browser test tool (where to put a finger), nothing else
    },
    step(dt: number, _frame: Frame) {
      prevT = t;
      t += Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      const sc = petScriptAt(script, prevT, t);
      const catPresent = world.location === 'nook';
      const bunnyPresent = !catPresent;
      picker.setEnabled('cat', catPresent);
      picker.setEnabled('bunny', bunnyPresent);

      // the cat: is a finger on her, and how far did it travel over her (in her own sizes on screen)?
      const radiusPx = Math.max(24, picker.screenOf('cat')?.radiusPx ?? 60);
      const realOn = catPresent && (phase === 'hold' || phase === 'drag') && (kind === 'key' ? target === 'cat' : overCat(px, py, kind));
      const moved = sc.catMoved + movedPx / radiusPx;
      movedPx = 0;
      const catOn = sc.catOn || realOn;
      const catTap = sc.catTap || catTaps > 0;
      catTaps = 0;

      // the bunny: where a held finger is on the snow, and where a tap landed
      let finger: V2 | null = sc.finger;
      if (!finger && bunnyPresent && (phase === 'hold' || phase === 'drag')) {
        if (kind === 'key') finger = target === 'bunny' ? keyFinger : null;
        else finger = ground(new THREE.Vector2(input.pointer.x, input.pointer.y));
      }
      let tap = groundTap;
      groundTap = null;
      if (!tap && sc.tap) tap = { at: sc.tap, on: false };

      const o = machine.update(dt, {
        catPresent,
        bunnyPresent,
        reduced: ctx.reduced,
        cat: { on: catOn, moved, tap: catTap, state: world.cat.behaviour.state },
        bunny: { state: world.bunny.behaviour.state, finger, tap, reduced: ctx.reduced },
        chamState: world.actor.behaviour.state,
      });

      if (o.cat) {
        if (o.cat.request) world.cat.behaviour.request(o.cat.request);
        for (const g of o.cat.gestures) world.cat.behaviour.gesture(g);
      }
      if (o.bunny) {
        const b = world.bunny;
        b.root.position.set(o.bunny.x, terrainHeight(o.bunny.x, o.bunny.z), o.bunny.z);
        b.root.rotation.y = o.bunny.yaw;
        if (o.bunny.request) b.behaviour.request(o.bunny.request);
        for (const g of o.bunny.gestures) b.behaviour.gesture(g);
      }
      if (o.cham.lean) world.actor.behaviour.request('curiousLean', { side: sideToward(o.cham.lean), hold: 6 });
      if (o.cham.blink) world.actor.behaviour.gesture('slowBlink');
      if (o.cham.ear) world.actor.behaviour.gesture('earFlick');
      if (o.haptic) haptics.pulse(o.haptic);
      for (const e of o.events) emit(e);

      last = {
        place,
        location: world.location,
        cat: { state: world.cat.behaviour.state, purring: machine.cat.purring, affection: Number(machine.cat.affection.toFixed(3)) },
        bunny: { state: world.bunny.behaviour.state, mode: machine.bunny.mode, x: Number(machine.bunny.x.toFixed(2)), z: Number(machine.bunny.z.toFixed(2)), yaw: Number(machine.bunny.yaw.toFixed(2)) },
        chamgadad: world.actor.behaviour.state,
        t: Number(t.toFixed(2)),
      };
    },
    render() {
      const id = input.focusId;
      const f = id ? picker.screenOf(id) : null;
      if (f) {
        const r = canvas.getBoundingClientRect();
        ring.show(r.left + f.x, r.top + f.y, Math.max(44, f.radiusPx * 2 + 14));
      } else ring.hide();
    },
    resize(w, h) {
      view = { w: Math.max(1, w), h: Math.max(1, h) };
      picker.resize(w, h);
    },
    dispose() {
      canvas.removeEventListener('focus', onCanvasFocus);
      for (const f of offs) f();
      picker.remove('cat');
      picker.remove('bunny');
      input.dispose();
      ring.dispose();
    },
  };
}
