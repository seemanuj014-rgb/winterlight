// Phase 28: where Chamgadad and the bunny stand in stay a while's valley, and when they are drawn. PURE (no three, no DOM, no words, no clock).
// The spots are measured from the valley camera (the one the finale ends on), so they are in front of it on the snow at any aspect; every number is `[A]` and was set by LOOKING at frames.
// The draw-call rule is `stayBudgetMath.ts`: the animals and the five sky shapes are never drawn together. The shapes come home from the crown over `homeProgress`; until they are home
// they are the picture and the animals wait, after that looking level shows the animals (and hides the sky, which is out of the picture then) and looking up shows the sky.
import { valleyCamera } from './finaleSkyMath';
import { terrainHeight } from '../world/groundMath';
import { PART_CALLS, lookForActivity, planStay, type PartId } from './stayBudgetMath';

type V3 = readonly [number, number, number];

export interface CastSpots {
  readonly chamgadad: V3;
  /** which way she faces (radians about the vertical, 0 = +z) */
  readonly chamgadadYaw: number;
  readonly bunny: V3;
  readonly bunnyYaw: number;
}

/** `[A]` how far in front of the valley eye she sits (m), and how far to the side of the view line (+ = to the right of the view) */
export const CAST = { chamgadadAhead: 17, chamgadadSide: 0.6, bunnyAhead: 13.6, bunnySide: -0.9 } as const;
/** `[A]` the same for a wide screen (aspect 1.6 and up): its view is much shallower, so the same spots would sit at the very bottom or below the frame; they move farther along the view line */
export const CAST_WIDE = { chamgadadAhead: 23, chamgadadSide: 0.8, bunnyAhead: 20, bunnySide: -1.2 } as const;
/** the aspects the tall and the wide spots belong to; in between they blend */
export const CAST_ASPECTS = { tall: 0.6, wide: 1.6 } as const;
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
function blendFor(aspect: number): number {
  const a = Number.isFinite(aspect) ? aspect : 1;
  return Math.min(1, Math.max(0, (a - CAST_ASPECTS.tall) / (CAST_ASPECTS.wide - CAST_ASPECTS.tall)));
}

/** a point `ahead` metres along the valley view's ground direction and `side` metres to its right, standing on the snow */
function onSnow(ahead: number, side: number): V3 {
  const c = valleyCamera(1);
  const dx = c.look[0] - c.eye[0];
  const dz = c.look[2] - c.eye[2];
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len;
  const fz = dz / len;
  // right of the view on the ground plane (x right, z toward the viewer): the forward direction turned a quarter turn
  const rx = -fz;
  const rz = fx;
  const x = c.eye[0] + fx * ahead + rx * side;
  const z = c.eye[2] + fz * ahead + rz * side;
  return [x, terrainHeight(x, z), z];
}

/** both animals face the valley eye, so she sees their fronts */
function yawToward(from: V3, to: V3): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

export function castSpots(aspect: number = CAST_ASPECTS.tall): CastSpots {
  const eye = valleyCamera(1).eye;
  const k = blendFor(aspect);
  const chamgadad = onSnow(mix(CAST.chamgadadAhead, CAST_WIDE.chamgadadAhead, k), mix(CAST.chamgadadSide, CAST_WIDE.chamgadadSide, k));
  const bunny = onSnow(mix(CAST.bunnyAhead, CAST_WIDE.bunnyAhead, k), mix(CAST.bunnySide, CAST_WIDE.bunnySide, k));
  return { chamgadad, chamgadadYaw: yawToward(chamgadad, eye), bunny, bunnyYaw: yawToward(bunny, eye) };
}

/** the shapes are home (resting on their patches) from this progress on */
export const HOME_DONE = 1;

/** is a part drawn: the valley always; the sky while looking up or until the shapes are home; the animals only once the shapes are home and she looks level */
export function castShows(activity: string, home: number, id: PartId): boolean {
  const look = lookForActivity(activity);
  const plan = planStay(look).visible;
  if (id === 'sky') return plan.includes('sky') || home < HOME_DONE;
  if (id === 'chamgadad' || id === 'bunny') return plan.includes(id) && home >= HOME_DONE;
  return plan.includes(id);
}

/** the draw calls the rule asks for at a moment (low tier numbers from `PART_CALLS`) */
export function callsNow(activity: string, home: number): number {
  const parts: PartId[] = ['backdrop', 'ground', 'cabin', 'sky', 'chamgadad', 'bunny'];
  return parts.filter((p) => castShows(activity, home, p)).reduce((n, p) => n + PART_CALLS[p], 0);
}
