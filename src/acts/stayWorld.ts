import type { Bus, WinterEvents } from '../state/events';
import type { SkyPlacement } from '../constellations/skyLayoutMath';
import type { FinaleCam } from './finaleSkyMath';
import type { StayAwhileAct } from './stayAwhile';
import { CENTRED, HOME_WALK, clampWalk, STAY_WORLD, activityForPan, homePlacement, homeProgress, panFromDrag, panFromKey, walkBy, wanderCamera, type Pan, type Walk } from './stayWorldMath';

// Phase 28: stay a while's world, joined to the card. No three, no DOM, no draw calls, no words: it holds the pan and the clock and hands a view the numbers
// (`camera(aspect)`, `placement(aspect, id)`). The view (next session, in the full card) calls `update(dt)` each frame and feeds drags and keys in.
//   * it starts when stay a while does (`stay:enter`): the clock and the pan reset, so the first look is the valley exactly as the finale left it
//   * it only says "wander" or "constellations" (looking up) to the stay act, and never overrides pet / wishes / secrets, which other parts of the card set
//   * nothing here can end or block: `drag`, `key` and `recenter` always work, the pan is clamped, and `update` does nothing while she is not staying

export interface StayWorldOptions {
  stay: StayAwhileAct;
  bus?: Bus<WinterEvents>;
  reducedMotion?: boolean;
}

export interface StayWorld {
  update(dt: number): void;
  drag(dxPx: number, dyPx: number, widthPx: number): void;
  key(key: string): void;
  recenter(): void;
  /** a half turn on the spot (the little turn-around button by the stick) */
  turnAround(): void;
  /** the joystick: `vx` right and `vy` forward, each -1..1, held for `dt` seconds */
  move(vx: number, vy: number, dt: number): void;
  /** free roaming: walk `forwardM` the way she faces and `sideM` to her right (m) */
  walk(forwardM: number, sideM: number): void;
  /** a wheel or a pinch: `px` > 0 walks forward (zooms in), < 0 back; `perPx` is the metres one pixel is worth */
  zoom(px: number, perPx?: number): void;
  camera(aspect: number): FinaleCam;
  placement(aspect: number, id: string): SkyPlacement;
  state(): { time: number; pan: Pan; walk: Walk; home: number; staying: boolean };
  dispose(): void;
}

export function createStayWorld(o: StayWorldOptions): StayWorld {
  const reduced = !!o.reducedMotion;
  let t = 0;
  let pan: Pan = { ...CENTRED };
  let walkPos: Walk = { ...HOME_WALK };
  const offs: Array<() => void> = [];
  const label = (): void => {
    const a = o.stay.machine.activity;
    if (a !== 'wander' && a !== 'constellations') return;
    o.stay.setActivity(activityForPan(pan));
  };
  const home = (): number => homeProgress(t, reduced);
  offs.push(
    (o.bus ?? o.stay.bus).on('stay:enter', () => {
      t = 0;
      pan = { ...CENTRED };
      walkPos = { ...HOME_WALK };
    }),
  );
  return {
    update(dt) {
      if (!o.stay.machine.staying || !(dt > 0) || !Number.isFinite(dt)) return;
      t += Math.min(dt, 0.25);
    },
    drag(dx, dy, w) {
      const next = panFromDrag(pan, dx, dy, w);
      // her head can only turn so far; past that the whole body turns, without limit, so she can look all the way back
      const k = w > 0 && Number.isFinite(dx) ? STAY_WORLD.dragDegPerScreen / w : 0;
      const over = pan.yawDeg - dx * k - next.yawDeg;
      if (Number.isFinite(over) && Math.abs(over) > 1e-9) walkPos = clampWalk({ ...walkPos, yawDeg: (walkPos.yawDeg ?? 0) + over });
      pan = next;
      label();
    },
    turnAround() {
      if (!o.stay.machine.staying) return;
      walkPos = clampWalk({ ...walkPos, yawDeg: (walkPos.yawDeg ?? 0) + 180 });
    },
    move(vx, vy, dt) {
      if (!o.stay.machine.staying || !(dt > 0) || !Number.isFinite(dt)) return;
      const x = Math.max(-1, Math.min(1, Number.isFinite(vx) ? vx : 0));
      const y = Math.max(-1, Math.min(1, Number.isFinite(vy) ? vy : 0));
      if (x === 0 && y === 0) return;
      const step = STAY_WORLD.walkSpeedMps * Math.min(dt, 0.1);
      walkPos = walkBy(walkPos, pan, y * step, x * step);
    },
    key(k) {
      pan = panFromKey(pan, k);
      label();
    },
    recenter() {
      pan = { ...CENTRED };
      walkPos = { ...HOME_WALK };
      label();
    },
    walk(f, s) {
      walkPos = walkBy(walkPos, pan, f, s);
    },
    zoom(px, perPx = STAY_WORLD.wheelMPerPx) {
      if (!o.stay.machine.staying) return;
      walkPos = walkBy(walkPos, pan, px * perPx, 0);
    },
    camera: (aspect) => wanderCamera(aspect, t, pan, reduced, walkPos),
    placement: (aspect, id) => homePlacement(aspect, id, home()),
    state: () => ({ time: t, pan: { ...pan }, walk: { ...walkPos }, home: home(), staying: o.stay.machine.staying }),
    dispose: () => offs.forEach((f) => f()),
  };
}
