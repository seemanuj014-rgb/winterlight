// Phase 10: Chamgadad's behaviour set as DATA. Pure maths, no three.
// Every state is a function from "seconds since the state began" to a Sample: a Pose (pose.ts) plus a few extra channels the rig
// applies (breathing, squash and stretch, where the eyes look, how closed the eyes are, how many Zs). Nothing here moves by itself:
// behaviour.ts runs the state machine, rig.ts writes the result onto the meshes.
// Everything here is [A]: her drawing is one still. The character is SLEEPY on purpose (CHARACTER_BIBLE: no frantic motion), so
// durations are long, holds are long and nothing overshoots. Angles are radians; positive rotation about z turns counter-clockwise
// as the viewer sees it; the viewer's right is +x.
import { blendPose, CURL, SIT, type PartName, type PartPose, type Pose } from './pose';

export type StateName =
  | 'rest' // the drawing's pose: sitting up, head as she drew it, paws together; breathing
  | 'breathe' // the same, slower and deeper
  | 'sleep' // curled up, eyes closed, soft Zs
  | 'wake' // one-shot: unroll, stretch, settle into rest
  | 'sitLookUp' // sitting up and looking up at the sky
  | 'findFinger' // the head and eyes follow a pointer (her finger)
  | 'curiousLean' // a slow lean and head tilt toward something
  | 'hop' // one-shot: a small happy hop
  | 'wave'; // one-shot: a small wave with one arm

export type GestureName = 'slowBlink' | 'earFlick';

export const STATE_NAMES: readonly StateName[] = ['rest', 'breathe', 'sleep', 'wake', 'sitLookUp', 'findFinger', 'curiousLean', 'hop', 'wave'];
export const GESTURE_NAMES: readonly GestureName[] = ['slowBlink', 'earFlick'];

/** What a state asks for at one moment. `eyes` and `zs` are TARGETS (behaviour.ts eases toward them); the rest is blended at once. */
export interface Sample {
  pose: Pose;
  /** Where the eyes look, head frame, -1..1 (gaze.ts clamps it). */
  gaze: readonly [number, number];
  /** Target eye closure, 0 open .. 1 closed. */
  eyes: number;
  /** Target amount of Zs, 0..1. */
  zs: number;
  /** Squash (negative) and stretch (positive) of the body, -1..1; the rig scales the torso by 1 + 0.07 * stretch. */
  stretch: number;
  /** Size of the breath, 1 = the normal small rise and fall. */
  breathAmp: number;
  /** Breaths per second. */
  breathHz: number;
}

export interface Ctx {
  /** The pointer (her finger), smoothed, head frame, -1..1. */
  pointer: readonly [number, number];
  /** -1 = lean toward the viewer's left, +1 = toward the right. */
  side: -1 | 1;
}

export type SampleFn = (t: number, ctx: Ctx) => Sample;

export interface StateDef {
  name: StateName;
  /** One-shots end by themselves after `duration` seconds and go back to where they came from (`wake` goes to rest). */
  oneShot: boolean;
  duration: number;
  /** A one-shot cannot be interrupted until this many seconds in; a request made earlier is queued (the latest wins). Base states are free at 0. */
  free: number;
  /** Seconds to blend in from whatever pose was showing (the lazy profile scales it). */
  blendIn: number;
  /** Seconds after which a posture relaxes to rest by itself (Infinity = stays). */
  hold: number;
  /** Which poses may be requested from here (a legal transition). One-shots also end by going to their resume state. */
  to: readonly StateName[];
  /** Reduced motion plays this instead (if given), else this state scaled down. */
  reducedAs?: StateName;
  /** Sleeps are never scaled down (a curled pose is still, not motion). */
  scalable: boolean;
  /** Where the pose is scaled toward when motion is reduced. */
  base: Pose;
  sample: SampleFn;
}

const d = (deg: number): number => (deg * Math.PI) / 180;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const smoother = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

type PoseEdit = Partial<Record<PartName, Partial<PartPose>>>;

/** A pose = a base (default the rest pose) with some parts changed. */
export function mk(edit: PoseEdit, base: Pose = SIT): Pose {
  const out = {} as Pose;
  for (const name of Object.keys(base) as PartName[]) {
    const e = edit[name];
    out[name] = { pos: e?.pos ?? base[name].pos, rot: e?.rot ?? base[name].rot };
  }
  return out;
}

const NEUTRAL: Omit<Sample, 'pose'> = { gaze: [0, 0], eyes: 0, zs: 0, stretch: 0, breathAmp: 1, breathHz: 0.22 };
const still = (pose: Pose, over: Partial<Omit<Sample, 'pose'>> = {}): SampleFn => () => ({ pose, ...NEUTRAL, ...over });

interface Key extends Partial<Omit<Sample, 'pose'>> {
  t: number;
  pose: Pose;
}

/** Piecewise smooth interpolation through keys (times ascending). Before the first key and after the last it holds. */
export function keyed(keys: readonly Key[]): SampleFn {
  return (t) => {
    const first = keys[0]!, last = keys[keys.length - 1]!;
    if (t <= first.t) return full(first);
    if (t >= last.t) return full(last);
    let i = 0;
    while (keys[i + 1]!.t < t) i++;
    const a = keys[i]!, b = keys[i + 1]!;
    const k = smoother((t - a.t) / (b.t - a.t));
    const A = full(a), B = full(b);
    return {
      pose: blendPose(A.pose, B.pose, k),
      gaze: [A.gaze[0] + (B.gaze[0] - A.gaze[0]) * k, A.gaze[1] + (B.gaze[1] - A.gaze[1]) * k],
      eyes: A.eyes + (B.eyes - A.eyes) * k,
      zs: A.zs + (B.zs - A.zs) * k,
      stretch: A.stretch + (B.stretch - A.stretch) * k,
      breathAmp: A.breathAmp + (B.breathAmp - A.breathAmp) * k,
      breathHz: A.breathHz + (B.breathHz - A.breathHz) * k,
    };
  };
}
const full = (k: Key): Sample => ({
  pose: k.pose,
  gaze: k.gaze ?? NEUTRAL.gaze,
  eyes: k.eyes ?? NEUTRAL.eyes,
  zs: k.zs ?? NEUTRAL.zs,
  stretch: k.stretch ?? NEUTRAL.stretch,
  breathAmp: k.breathAmp ?? NEUTRAL.breathAmp,
  breathHz: k.breathHz ?? NEUTRAL.breathHz,
});

/** A copy of a pose with one part's rotation / position offset added (used for oscillations on top of keys). */
function addTo(p: Pose, part: PartName, rot: readonly [number, number, number], pos: readonly [number, number, number] = [0, 0, 0]): Pose {
  const o = { ...p } as Pose;
  const q = p[part];
  o[part] = { pos: [q.pos[0] + pos[0], q.pos[1] + pos[1], q.pos[2] + pos[2]], rot: [q.rot[0] + rot[0], q.rot[1] + rot[1], q.rot[2] + rot[2]] };
  return o;
}

// ---------------------------------------------------------------------------------------------------------------- the states

const restPose = SIT;
const lookUpPose = mk({ neck: { rot: [d(-13), 0, 0] }, torso: { rot: [d(-3), 0, 0] }, armL: { rot: [0, 0, d(2)] }, armR: { rot: [0, 0, d(-2)] } });

const WAKE_STRETCH = mk({
  neck: { rot: [d(-15), 0, 0] },
  torso: { rot: [d(-7), 0, 0] },
  armL: { rot: [0, 0, d(-118)] },
  armR: { rot: [0, 0, d(118)] },
  legL: { rot: [d(-8), 0, 0] },
  legR: { rot: [d(-8), 0, 0] },
});
const WAKE_MID = mk({ root: { rot: [0, 0, d(-34)] }, neck: { rot: [d(2), 0, d(20)] }, torso: { rot: [0, 0, d(-5)] }, armL: { rot: [0, 0, d(-30)] }, armR: { rot: [0, 0, d(30)] } });

const HOP_CROUCH = mk({ neck: { rot: [d(7), 0, 0] }, torso: { rot: [d(5), 0, 0] }, armL: { rot: [0, 0, d(-6)] }, armR: { rot: [0, 0, d(6)] }, legL: { rot: [d(10), 0, 0] }, legR: { rot: [d(10), 0, 0] } });
const HOP_AIR = mk({
  root: { pos: [0, 0.5, 0] },
  neck: { rot: [d(-9), 0, 0] },
  torso: { rot: [d(-4), 0, 0] },
  armL: { rot: [0, 0, d(-34)] },
  armR: { rot: [0, 0, d(34)] },
  legL: { rot: [d(-14), 0, 0] },
  legR: { rot: [d(-14), 0, 0] },
});
const HOP_LAND = mk({ neck: { rot: [d(8), 0, 0] }, torso: { rot: [d(5), 0, 0] }, armL: { rot: [0, 0, d(-12)] }, armR: { rot: [0, 0, d(12)] }, legL: { rot: [d(8), 0, 0] }, legR: { rot: [d(8), 0, 0] } });

const WAVE_UP = mk({ neck: { rot: [0, d(-8), d(-7)] }, torso: { rot: [0, 0, d(-3)] }, armR: { rot: [0, 0, d(104)] } });
const WAVE_DOWN = SIT;

/** Hop: crouch, spring, a slow floating arc, a soft landing, settle. Two ear flicks (at launch and at landing) come from behaviour.ts. */
export const HOP_EVENTS: readonly { at: number; which: 'both'; strength: number }[] = [
  { at: 0.7, which: 'both', strength: 0.8 },
  { at: 1.57, which: 'both', strength: 0.6 },
];
export const HOP_AIR_START = 0.7;
export const HOP_AIR_END = 1.5;
const hopKeys = keyed([
  { t: 0, pose: restPose },
  { t: 0.45, pose: HOP_CROUCH, stretch: -0.9, gaze: [0, 0.2] },
  { t: HOP_AIR_START, pose: HOP_AIR, stretch: 0.8, gaze: [0, 0.55] },
  { t: HOP_AIR_END, pose: HOP_AIR, stretch: 0.5, gaze: [0, 0.3] },
  { t: 1.68, pose: HOP_LAND, stretch: -0.7, gaze: [0, 0] },
  { t: 2.6, pose: restPose, stretch: 0 },
]);
const hopSample: SampleFn = (t, ctx) => {
  const s = hopKeys(t, ctx);
  // the arc itself: a parabola between launch and landing, on top of the keyed height
  const u = clamp((t - HOP_AIR_START) / (HOP_AIR_END - HOP_AIR_START), 0, 1);
  const arc = 4 * u * (1 - u);
  const root = s.pose.root;
  return { ...s, pose: { ...s.pose, root: { pos: [root.pos[0], arc * 0.55, root.pos[2]], rot: root.rot } } };
};

const waveKeys = keyed([
  { t: 0, pose: WAVE_DOWN, gaze: [0, 0.1] },
  { t: 1.0, pose: WAVE_UP, gaze: [0, 0.1] },
  { t: 2.7, pose: WAVE_UP, gaze: [0, 0.1] },
  { t: 3.7, pose: WAVE_DOWN, gaze: [0, 0] },
]);
const waveSample: SampleFn = (t, ctx) => {
  const s = waveKeys(t, ctx);
  // three slow swings of the forearm side of the arm, fading in and out
  const env = smoother((t - 0.9) / 0.4) * (1 - smoother((t - 2.5) / 0.4));
  const swing = Math.sin((t - 0.9) * 2 * Math.PI * 1.05) * d(13) * env;
  return { ...s, pose: addTo(s.pose, 'armR', [0, 0, swing]) };
};

const findFingerSample: SampleFn = (_t, ctx) => {
  const [px, py] = ctx.pointer;
  const pose = mk({
    // the head turns most, the shoulders a little behind it; looking up tips the head back
    neck: { rot: [d(-11) * py, d(17) * px, d(-3) * px] },
    torso: { rot: [0, d(5) * px, 0] },
  });
  return { pose, ...NEUTRAL, gaze: [px, py], breathAmp: 1 };
};

const curiousSample: SampleFn = (t, ctx) => {
  const s = ctx.side;
  // the lean toward one side, head tilted further and turned, then a very slow drift so the hold is not a statue
  const drift = Math.sin(t * 0.45) * d(1.2);
  const pose = mk({
    root: { rot: [0, 0, d(-3.5) * s] },
    neck: { rot: [d(-3), d(10) * s, d(-11) * s + drift] },
    torso: { rot: [0, 0, d(-3) * s] },
  });
  return { pose, ...NEUTRAL, gaze: [0.7 * s, 0.35] };
};

const sitLookUpSample: SampleFn = (t) => {
  const drift = Math.sin(t * 0.3) * d(1.5);
  return { pose: addTo(lookUpPose, 'neck', [0, drift, 0]), ...NEUTRAL, gaze: [0, 0.8] };
};

const ALL_AWAKE: readonly StateName[] = ['rest', 'breathe', 'sitLookUp', 'findFinger', 'curiousLean', 'hop', 'wave', 'sleep'];
const without = (list: readonly StateName[], n: StateName): StateName[] => list.filter((x) => x !== n);

export const STATES: Record<StateName, StateDef> = {
  rest: { name: 'rest', oneShot: false, duration: Infinity, free: 0, blendIn: 1.0, hold: Infinity, to: without(ALL_AWAKE, 'rest'), scalable: true, base: SIT, sample: still(restPose) },
  breathe: {
    name: 'breathe', oneShot: false, duration: Infinity, free: 0, blendIn: 1.2, hold: Infinity, to: without(['rest', ...without(ALL_AWAKE, 'rest')], 'breathe'),
    scalable: true, base: SIT, sample: still(restPose, { breathAmp: 1.9, breathHz: 0.16 }),
  },
  sleep: {
    name: 'sleep', oneShot: false, duration: Infinity, free: 0, blendIn: 2.2, hold: Infinity, to: ['wake'], scalable: false, base: CURL,
    sample: still(CURL, { eyes: 1, zs: 1, breathAmp: 1.5, breathHz: 0.15 }),
  },
  wake: {
    name: 'wake', oneShot: true, duration: 4.4, free: 2.6, blendIn: 0.5, hold: Infinity, to: ['rest', 'sleep'], reducedAs: 'rest', scalable: false, base: SIT,
    sample: keyed([
      { t: 0, pose: CURL, eyes: 1, zs: 0.6, breathAmp: 1.5, breathHz: 0.15 },
      { t: 0.9, pose: CURL, eyes: 0.85, zs: 0, breathAmp: 1.8, breathHz: 0.2 },
      { t: 1.9, pose: WAKE_MID, eyes: 0.55, stretch: 0.2, breathHz: 0.25 },
      { t: 2.8, pose: WAKE_STRETCH, eyes: 0.45, stretch: 0.9, gaze: [0, 0.3], breathAmp: 2.2, breathHz: 0.2 },
      { t: 3.5, pose: WAKE_STRETCH, eyes: 0.2, stretch: 0.9, gaze: [0, 0.3], breathAmp: 2.2, breathHz: 0.2 },
      { t: 4.4, pose: restPose, eyes: 0, stretch: 0 },
    ]),
  },
  sitLookUp: { name: 'sitLookUp', oneShot: false, duration: Infinity, free: 0, blendIn: 1.3, hold: 9, to: without(ALL_AWAKE, 'sitLookUp'), scalable: true, base: SIT, sample: sitLookUpSample },
  findFinger: { name: 'findFinger', oneShot: false, duration: Infinity, free: 0, blendIn: 0.7, hold: 3, to: without(ALL_AWAKE, 'findFinger'), scalable: true, base: SIT, sample: findFingerSample },
  curiousLean: { name: 'curiousLean', oneShot: false, duration: Infinity, free: 0, blendIn: 1.1, hold: 5, to: without(ALL_AWAKE, 'curiousLean'), scalable: true, base: SIT, sample: curiousSample },
  hop: { name: 'hop', oneShot: true, duration: 2.6, free: 1.75, blendIn: 0.3, hold: Infinity, to: without(ALL_AWAKE, 'hop'), reducedAs: 'curiousLean', scalable: true, base: SIT, sample: hopSample },
  wave: { name: 'wave', oneShot: true, duration: 3.7, free: 2.5, blendIn: 0.6, hold: Infinity, to: without(ALL_AWAKE, 'wave'), scalable: true, base: SIT, sample: waveSample },
};

/** Legal posture transitions, from the table above. A request that is not legal is routed (see routePath) or refused. */
export function canTransition(from: StateName, to: StateName): boolean {
  return STATES[from].to.includes(to);
}

/**
 * The states to pass through to get from one posture to another. Sleeping Chamgadad always wakes first (a request for a hop while
 * asleep is a wake, then a hop); everything else is direct. Returns [] if there is nothing to do (same state) or no way.
 */
export function routePath(from: StateName, to: StateName): StateName[] {
  if (from === to) return [];
  if (to === 'wake') return from === 'sleep' ? ['wake'] : [];
  if (canTransition(from, to)) return [to];
  if (from === 'sleep') return to === 'rest' ? ['wake'] : ['wake', to];
  if (from === 'wake') return ['rest', to];
  return [];
}

export const REST_SAMPLE: Sample = { pose: SIT, ...NEUTRAL };
