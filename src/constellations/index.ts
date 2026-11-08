import * as THREE from 'three';
import { createPicker, type Input, type Picker } from '../input';
import type { PointerKind } from '../input/gestureMath';
import type { Bus } from '../state/events';
import type { WinterEvents } from '../state/events';
import { ConstellationMachine, type EngineEvent } from './engine';
import { createConstellationFx, type Fx, type Tier } from './fx';
import type { ConstellationDef } from './defs';

// Phase 21: one playable constellation = the pure machine (engine.ts) + how it looks (fx.ts) + the input layer wired to both.
// The five real shapes (Phase 22) are five `ConstellationDef`s handed to this; nothing here knows what a shape is of.
//
// Where it sits: a flat patch of the sky, `placement.halfAngleDeg` wide, centred on a sky direction (azimuth 0 = straight ahead, elevation up), always facing the viewer.
// A finger on the screen is turned into a point on that patch by a ray (so a tilted phone or a moving camera still draws where the finger is).
// Touch, mouse and keys all arrive as the same gestures from the input layer (Phase 18): drag from a star to the next one, or tap one star and then its neighbour.

export interface Placement {
  /** degrees from straight ahead (positive = to the right) */
  azDeg: number;
  /** degrees above the horizon */
  elDeg: number;
  /** half the angular width of the patch (the plane's -1..1) */
  halfAngleDeg: number;
  /** metres from the eye; must be inside the sky dome (default 60) */
  distance?: number;
}

export interface PlayOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  def: ConstellationDef;
  placement: Placement;
  tier: Tier;
  reducedMotion: boolean;
  pixelRatio?: number;
  bus?: Bus<WinterEvents>;
  /** a buzz for connect and complete; the input layer's `createHaptics()` fits */
  haptics?: { pulse(name: 'tick' | 'tap' | 'soft' | 'done'): void };
  /** every engine event, as it happens (the test view prints them; Phase 22 listens for the shape being done) */
  onEvent?: (e: EngineEvent) => void;
  hintAfter?: number;
}

export interface Play {
  readonly engine: ConstellationMachine;
  readonly fx: Fx;
  readonly picker: Picker;
  /** pass to `createInput({ resolve, keyboard })` */
  resolve: (x: number, y: number, kind: PointerKind) => string | null;
  /** the keyboard skips stars with no line left to draw; a finger can still touch them (and gets a soft "not that one") */
  keyboard: { ids: () => readonly string[]; positionOf: (id: string) => { x: number; y: number } | null };
  /** wire the input layer's gestures to the engine; returns the unsubscribe */
  attach(input: Pick<Input, 'on'>): () => void;
  /** a point on the screen (px in the canvas box) -> the patch's own plane, or null if the ray misses it */
  planeAt(x: number, y: number): { x: number; y: number } | null;
  update(dt: number, tSec?: number): void;
  resize(widthPx: number, heightPx: number): void;
  /** move the patch (a different screen shape, or the next constellation's spot) */
  setPlacement(p: Placement): void;
  /** Phase 22: with five shapes in the sky only the one being worked on may offer a hint (default on) */
  setHints(on: boolean): void;
  undo(): void;
  reset(): void;
  /** seconds on the play's own clock */
  readonly clock: number;
  setTier(t: Tier): void;
  setPixelRatio(pr: number): void;
  dispose(): void;
}

export const DEFAULT_DISTANCE = 60;
/** `[A]` the lit line's half-width on the screen (px) */
export const LINE_PX = 1.9;
/** `[A]` the finger is clumsier than the mouse: a touch gets 1.35 times the snap circle */
export const SNAP_SCALE: Record<PointerKind, number> = { touch: 1.35, mouse: 1, pen: 1.15, key: 1 };

export function createConstellationPlay(o: PlayOptions): Play {
  const { camera, def } = o;
  const engine = new ConstellationMachine(def, { hintAfter: o.hintAfter });
  const fx = createConstellationFx({ def, tier: o.tier, reducedMotion: o.reducedMotion, pixelRatio: o.pixelRatio });
  o.scene.add(fx.root);
  let placement = o.placement;
  const dist = placement.distance ?? DEFAULT_DISTANCE;
  let half = 1;

  const dirV = new THREE.Vector3();
  const targets: { id: string; radius: number; size: number }[] = [];
  function place(): void {
    half = Math.tan((placement.halfAngleDeg * Math.PI) / 180) * dist;
    fx.root.scale.set(half, half, half);
    for (const t of targets) t.radius = half * 0.07 * t.size;
    const az = (placement.azDeg * Math.PI) / 180;
    const el = (placement.elDeg * Math.PI) / 180;
    dirV.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
    fx.root.position.copy(camera.position).add(dirV);
    fx.root.lookAt(camera.position); // +z toward the eye, x to the right, y up
    fx.root.updateMatrixWorld(true);
  }

  // ---- picking: every star is a small invisible target with a generous screen radius ----------------------------------------------------
  const picker = createPicker(camera);
  const holders = new Map<string, THREE.Object3D>();
  const wv = new THREE.Vector3();
  for (const n of def.nodes) {
    const h = new THREE.Object3D();
    h.position.set(n.x, n.y, 0);
    fx.root.add(h);
    holders.set(n.id, h);
    const t = { id: n.id, object: h, centre: () => h.getWorldPosition(wv.set(0, 0, 0)).clone(), radius: 0.1, size: n.size ?? 1 };
    targets.push(t);
    picker.add(t);
  }
  place();
  let sizeW = 1;
  let sizeH = 1;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const local = new THREE.Vector3();

  function planeAt(x: number, y: number): { x: number; y: number } | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    ndc.set((x / sizeW) * 2 - 1, -(y / sizeH) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    nrm.set(0, 0, 1).transformDirection(fx.root.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(nrm, fx.root.position);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    local.copy(hit);
    fx.root.worldToLocal(local);
    return { x: local.x, y: local.y };
  }

  // ---- engine events -> look, buzz, bus, caller ---------------------------------------------------------------------------------------
  let clock = 0;
  let hints = true;
  const handle = (events: EngineEvent[]): void => {
    for (const e of events) {
      fx.onEvent(e);
      if (e.type === 'connect') {
        o.haptics?.pulse('tick');
        o.bus?.emit('star:connect', { shape: def.id, line: e.drawn - 1 });
      }
      else if (e.type === 'select') o.haptics?.pulse('tap');
      else if (e.type === 'complete') {
        o.haptics?.pulse('done');
        o.bus?.emit('constellation:done', { id: def.id });
      }
      o.onEvent?.(e);
    }
  };
  const kindScale = (k: PointerKind): void => engine.setSnapScale(SNAP_SCALE[k] ?? 1);

  return {
    engine,
    fx,
    picker,
    resolve: (x, y, kind) => picker.pick(x, y, kind),
    keyboard: { ids: () => picker.ids().filter((id) => engine.targetsFrom(id).length > 0), positionOf: (id) => picker.screenOf(id) },
    attach(input) {
      const offs = [
        input.on('tap', (g) => {
          kindScale(g.kind);
          handle(engine.tap(g.target, clock));
        }),
        input.on('dragstart', (g) => {
          kindScale(g.kind);
          const p = planeAt(g.x, g.y);
          // the line comes out of the star that was under the finger at the press; the finger is where it is now
          const star = g.target;
          const at = p ?? (star ? engine.position(star) : null);
          if (at) handle(engine.beginDrag(star, at.x, at.y, clock));
        }),
        input.on('drag', (g) => {
          const p = planeAt(g.x, g.y);
          if (p) handle(engine.move(p.x, p.y, clock));
        }),
        input.on('dragend', () => handle(engine.release(clock))),
        input.on('cancel', () => handle(engine.release(clock))),
      ];
      return () => offs.forEach((f) => f());
    },
    planeAt,
    update(dt, tSec) {
      clock = tSec ?? clock + dt;
      place();
      // keep the line a few pixels wide whatever the screen: pixels per plane unit at the patch
      const pxPerUnit = (Math.tan((placement.halfAngleDeg * Math.PI) / 180) / Math.tan((camera.fov * Math.PI) / 360)) * (sizeH / 2);
      fx.setLineWidth(Math.min(0.03, Math.max(0.004, LINE_PX / Math.max(1, pxPerUnit))));
      if (hints) handle(engine.tick(clock));
      fx.update(dt, clock, engine.state());
    },
    resize(w, h) {
      sizeW = Math.max(1, w);
      sizeH = Math.max(1, h);
      picker.resize(w, h);
    },
    setPlacement(p) {
      placement = p;
      place();
    },
    setHints(on) {
      hints = on;
    },
    undo: () => handle(engine.undo(clock)),
    reset: () => handle(engine.reset(clock)),
    get clock() {
      return clock;
    },
    setTier: (t) => fx.setTier(t),
    setPixelRatio: (p) => fx.setPixelRatio(p),
    dispose() {
      o.scene.remove(fx.root);
      fx.dispose();
    },
  };
}

export { ConstellationMachine, HINT_AFTER, type EngineEvent, type EngineState } from './engine';
export { validateDef, DEMO_KITE, DEMO_PATH, DEMO_DEFS, type ConstellationDef, type StarNode } from './defs';
export type { Fx, Tier } from './fx';
