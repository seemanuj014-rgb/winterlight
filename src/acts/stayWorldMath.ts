// Phase 28: the look of "stay a while", as numbers. Pure (no three, no DOM, no clock, no random): numbers in, numbers out, so a frozen frame, a test and the page agree.
//
//   * the camera starts where the finale left it (the valley, `valleyCamera`), drifts a very little (a slow sway, none under reduced motion) and can be turned by hand:
//     a drag, or the arrow keys, turn the view left / right and up / down within limits; Home puts it back. Looking up far enough shows the sky, and that is all "constellations" means here.
//   * the five shapes come home from the crown to their patches (`homePlacement`), so the sky is hers to play again.
// Nothing here is a mechanic that can fail or end: the pan is always clamped, there is no timer that ends anything, and no word is written here. Every number is `[A]`.

import { valleyCamera, finalePlacement, type FinaleCam } from './finaleSkyMath';
import type { SkyPlacement } from '../constellations/skyLayoutMath';
import type { V3 } from '../core/directorMath';
import { CABIN_SITE, terrainHeight } from '../world/groundMath';

const D2R = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number): number => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

export const STAY_WORLD = {
  /** `[A]` the slow sway: period (s) and reach (m, sideways and up) */
  driftPeriodS: 48,
  driftM: [0.7, 0.25] as readonly [number, number],
  /** `[A]` how far the view can be turned by hand (degrees from the valley look; positive = right). The five patches sit LEFT of the valley look (the valley look is about 26 degrees right of straight ahead) and up to about 64 degrees above the horizon on a tall phone, so the range is lopsided and tall: found by `tools/stay_reach.py`, which showed the cat-and-bunny shape could never be brought on screen with the first numbers (+-40, up to 48). */
  yawRangeDeg: [-55, 40] as readonly [number, number],
  pitchLimitDeg: [-8, 68] as readonly [number, number],
  /** `[A]` a drag across the whole screen turns the view this far; one arrow-key press turns it `keyStepDeg` */
  dragDegPerScreen: 150,
  keyStepDeg: 6,
  /** `[A]` looking up at least this far (degrees from the valley look) counts as being at the constellations */
  skyLookPitchDeg: 22,
  /** `[A]` free roaming: how far she can walk from where the finale left her (m, a disc; the ground follows the camera and ends at 35), and what one wheel pixel, one pinch pixel and one key press are worth (m) */
  walkRadiusM: 33,
  /** `[A]` the joystick: walking speed at full push (m/s), and the cabin's wall she cannot walk through (m from its centre) */
  walkSpeedMps: 4,
  cabinKeepOutM: 3.6,
  wheelMPerPx: 0.02,
  pinchMPerPx: 0.06,
  keyWalkM: 1.2,
  /** `[A]` the five shapes take this long to come home from the crown (s); under reduced motion they are simply there */
  homeSeconds: 2.4,
  /** the share of the way home spent moving across (the rest is settling down onto the patch) */
  acrossShare: 0.7,
} as const;

export interface Pan {
  /** degrees, positive = looking to the right of the valley look */
  yawDeg: number;
  /** degrees, positive = looking higher */
  pitchDeg: number;
}

export const CENTRED: Pan = { yawDeg: 0, pitchDeg: 0 };

/** where she has walked to: metres east-west (x) and north-south (z) from the valley look's own spot, and how far she has turned her whole body (degrees, unlimited; her head's own turn is `Pan`) */
export interface Walk {
  x: number;
  z: number;
  yawDeg?: number;
}
export const HOME_WALK: Walk = { x: 0, z: 0, yawDeg: 0 };

const wrapDeg = (d: number): number => {
  if (!Number.isFinite(d)) return 0;
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
};

/** keep her inside the disc she may roam and outside the cabin's walls; bad numbers put her back at the start */
export function clampWalk(w: Walk): Walk {
  let x = Number.isFinite(w.x) ? w.x : 0;
  let z = Number.isFinite(w.z) ? w.z : 0;
  const d = Math.hypot(x, z);
  const r = STAY_WORLD.walkRadiusM;
  if (d > r) {
    x = (x / d) * r;
    z = (z / d) * r;
  }
  const b = valleyCamera(1).eye;
  const cx = CABIN_SITE.x - b[0];
  const cz = CABIN_SITE.z - b[2];
  const dc = Math.hypot(x - cx, z - cz);
  if (dc < STAY_WORLD.cabinKeepOutM) {
    const k = dc > 1e-6 ? STAY_WORLD.cabinKeepOutM / dc : 0;
    x = dc > 1e-6 ? cx + (x - cx) * k : cx + STAY_WORLD.cabinKeepOutM;
    z = dc > 1e-6 ? cz + (z - cz) * k : cz;
  }
  return { x, z, yawDeg: wrapDeg(w.yawDeg ?? 0) };
}

/** the way she is facing on the ground, radians (same convention as the camera: 0 = -z): the valley look, plus her whole-body turn, plus her head's turn */
export function headingRad(pan: Pan, bodyYawDeg = 0): number {
  const base = valleyCamera(1);
  const d: V3 = [base.look[0] - base.eye[0], base.look[1] - base.eye[1], base.look[2] - base.eye[2]];
  return Math.atan2(d[0], -d[2]) + (clampPan(pan).yawDeg + (Number.isFinite(bodyYawDeg) ? bodyYawDeg : 0)) * D2R;
}

/** walk `forwardM` the way she faces and `sideM` to her right (negative = back / left), clamped to the disc */
export function walkBy(walk: Walk, pan: Pan, forwardM: number, sideM: number): Walk {
  const h = headingRad(pan, walk.yawDeg ?? 0);
  const f = Number.isFinite(forwardM) ? forwardM : 0;
  const s = Number.isFinite(sideM) ? sideM : 0;
  return clampWalk({ x: walk.x + Math.sin(h) * f + Math.cos(h) * s, z: walk.z - Math.cos(h) * f + Math.sin(h) * s, yawDeg: walk.yawDeg ?? 0 });
}

export function clampPan(p: Pan): Pan {
  return {
    yawDeg: clamp(p.yawDeg, STAY_WORLD.yawRangeDeg[0], STAY_WORLD.yawRangeDeg[1]),
    pitchDeg: clamp(p.pitchDeg, STAY_WORLD.pitchLimitDeg[0], STAY_WORLD.pitchLimitDeg[1]),
  };
}

/** a drag of (dx, dy) px on a screen `widthPx` wide: the world follows the finger, so a drag right turns the view left and a drag down turns it up. Bad numbers change nothing. */
export function panFromDrag(pan: Pan, dxPx: number, dyPx: number, widthPx: number): Pan {
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx) || !(widthPx > 0)) return clampPan(pan);
  const k = STAY_WORLD.dragDegPerScreen / widthPx;
  return clampPan({ yawDeg: pan.yawDeg - dxPx * k, pitchDeg: pan.pitchDeg + dyPx * k });
}

/** the arrow keys turn the view; Home puts it back; any other key changes nothing */
export function panFromKey(pan: Pan, key: string): Pan {
  const s = STAY_WORLD.keyStepDeg;
  switch (key) {
    case 'ArrowLeft':
      return clampPan({ ...pan, yawDeg: pan.yawDeg - s });
    case 'ArrowRight':
      return clampPan({ ...pan, yawDeg: pan.yawDeg + s });
    case 'ArrowUp':
      return clampPan({ ...pan, pitchDeg: pan.pitchDeg + s });
    case 'ArrowDown':
      return clampPan({ ...pan, pitchDeg: pan.pitchDeg - s });
    case 'Home':
      return { ...CENTRED };
    default:
      return clampPan(pan);
  }
}

/** the activity label the view says: at the sky when she looks up far enough, otherwise wandering */
export function activityForPan(pan: Pan): 'wander' | 'constellations' {
  return pan.pitchDeg >= STAY_WORLD.skyLookPitchDeg ? 'constellations' : 'wander';
}

/** the camera `t` seconds into stay a while: the valley look, swayed a little (not under reduced motion), turned by `pan` (clamped) */
export function wanderCamera(aspect: number, t: number, pan: Pan, reduced: boolean, walk: Walk = HOME_WALK): FinaleCam {
  const base = valleyCamera(aspect);
  const wk = clampWalk(walk);
  const p = clampPan(pan);
  const tt = Number.isFinite(t) ? t : 0;
  const sway = reduced ? 0 : 1;
  const w = (2 * Math.PI * tt) / STAY_WORLD.driftPeriodS;
  // the eye keeps its height above the snow wherever she walks
  const groundNow = terrainHeight(base.eye[0] + wk.x, base.eye[2] + wk.z) - terrainHeight(base.eye[0], base.eye[2]);
  const eye: V3 = [
    base.eye[0] + wk.x + sway * STAY_WORLD.driftM[0] * Math.sin(w),
    base.eye[1] + groundNow + sway * STAY_WORLD.driftM[1] * Math.sin(w * 1.37 + 1),
    base.eye[2] + wk.z,
  ];
  const d: V3 = [base.look[0] - base.eye[0], base.look[1] - base.eye[1], base.look[2] - base.eye[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const h = Math.atan2(d[0], -d[2]) + (p.yawDeg + (wk.yawDeg ?? 0)) * D2R;
  const e = Math.asin(d[1] / l) + p.pitchDeg * D2R;
  const dir: V3 = [Math.sin(h) * Math.cos(e), Math.sin(e), -Math.cos(h) * Math.cos(e)];
  return { eye, look: [eye[0] + dir[0] * 20, eye[1] + dir[1] * 20, eye[2] + dir[2] * 20], fovDeg: base.fovDeg };
}

/** 0..1: how far the five shapes have come home, `t` seconds after stay a while began (reduced motion: already home) */
export function homeProgress(t: number, reduced: boolean): number {
  if (reduced) return 1;
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.min(1, t / STAY_WORLD.homeSeconds);
}

/** shape `id` at home progress `k`: 0 is the crown exactly as the finale left it, 1 is on its own patch exactly as in Phase 22; across first, then down onto the patch */
export function homePlacement(aspect: number, id: string, k: number): SkyPlacement {
  const q = Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0));
  const a = STAY_WORLD.acrossShare;
  const join = 1 - Math.min(1, q / a);
  const lift = 1 - Math.min(1, Math.max(0, (q - a) / (1 - a)));
  return finalePlacement(aspect, id, lift, join);
}
