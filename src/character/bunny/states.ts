// Phase 16: the snow bunny's states as data. Pure maths, no three.
//   sit    posture   upright in the snow, ears up, a small breath, tiny drifts of the head
//   hide   posture   lowered behind a snow bank (only the ear tips may show), ears laid back
//   peek   one-shot  about 5.4 s: rise from `hide`, look one way and the other, a nose twitch, sink back to `hide`
//   hop    one-shot  2.4 s on the spot: crouch, a slow floating arc, a soft landing, back to `sit` (no travel, so no pop at the end)
// Gestures (never change the posture): noseTwitch, earFlickL, earFlickR, slowBlink.
// Every number is mine `[A]` (the bunny is ours to design). Poses are deltas from the model's rest (upright, ears up, looking ahead).
// Asking for `peek` from `sit` goes through `hide` first (she ducks, then comes up).
import { Critter, keyframes, sampleOf, type AutoGesture, type CritterDef, type Key, type Sample, type StateDef } from '../companion/engine';

export type BunnyState = 'sit' | 'hide' | 'peek' | 'hop';
export type BunnyGesture = 'noseTwitch' | 'earFlickL' | 'earFlickR' | 'slowBlink';
export const BUNNY_STATE_NAMES: readonly BunnyState[] = ['sit', 'hide', 'peek', 'hop'];
export const BUNNY_GESTURE_NAMES: readonly BunnyGesture[] = ['noseTwitch', 'earFlickL', 'earFlickR', 'slowBlink'];

/** Upright: the rest pose of the model. */
export const SIT_POSE = { 'earL.rz': -0.1, 'earR.rz': 0.1 } as const;

/** Lowered behind a bank: sunk, hunched, ears laid back. */
export const HIDE_POSE = {
  'motion.py': -0.15,
  'body.rx': 0.12,
  'head.rx': 0.18,
  'earL.rz': -0.35, 'earR.rz': 0.35, 'earL.rx': -0.55, 'earR.rx': -0.55,
} as const;

/** Head and ears just above the bank, looking about. */
const UP = { ...SIT_POSE, 'motion.py': -0.05, 'body.rx': 0.06, 'earL.rz': -0.16, 'earR.rz': 0.16 } as const;

const sw = (t: number, hz: number, ph = 0): number => Math.sin(t * Math.PI * 2 * hz + ph) - Math.sin(ph); // 0 at t = 0

const sitSample = (t: number): Sample =>
  sampleOf({ ...SIT_POSE, 'head.ry': 0.06 * sw(t, 0.045), 'head.rz': 0.02 * sw(t, 0.03), 'head.rx': 0.02 * sw(t, 0.06) }, { breathAmp: 1.2, breathHz: 0.55, eyes: 0, gx: 0.15 * sw(t, 0.04), gy: 0 });

const hideSample = (t: number): Sample =>
  sampleOf({ ...HIDE_POSE, 'head.ry': 0.04 * sw(t, 0.05) }, { breathAmp: 1.0, breathHz: 0.6, eyes: 0, gx: 0, gy: 0.1 });

const HIDE0 = hideSample(0);
const SIT0 = sitSample(0);

const peekKeys: Key[] = [
  [0, HIDE0],
  [1.0, sampleOf({ ...UP, 'head.rx': 0.05 }, { breathAmp: 1, breathHz: 0.6, eyes: 0, gx: 0, gy: 0.2 })],
  [1.9, sampleOf({ ...UP, 'head.ry': 0.5, 'head.rz': -0.05 }, { breathAmp: 1, breathHz: 0.6, eyes: 0, gx: 0.7, gy: 0.1 })],
  [3.1, sampleOf({ ...UP, 'head.ry': -0.5, 'head.rz': 0.05 }, { breathAmp: 1, breathHz: 0.6, eyes: 0, gx: -0.7, gy: 0.1 })],
  [3.9, sampleOf({ ...UP, 'head.rx': -0.05 }, { breathAmp: 1, breathHz: 0.6, eyes: 0, gx: 0, gy: 0 })],
  [4.6, sampleOf({ ...HIDE_POSE, 'motion.py': -0.11 }, { breathAmp: 1, breathHz: 0.6, eyes: 0.3, gx: 0, gy: 0.1 })],
  [5.4, HIDE0],
];

const hopKeys: Key[] = [
  [0, SIT0],
  [0.55, sampleOf({ ...SIT_POSE, 'motion.py': -0.03, 'body.rx': 0.28, 'head.rx': -0.1, 'earL.rx': -0.2, 'earR.rx': -0.2 }, { breathAmp: 0.6, breathHz: 0.55, eyes: 0.15 })],
  [0.95, sampleOf({ ...SIT_POSE, 'motion.py': -0.04, 'body.rx': 0.34, 'head.rx': -0.12, 'earL.rx': -0.25, 'earR.rx': -0.25 }, { breathAmp: 0.4, breathHz: 0.55, eyes: 0.2 })],
  [1.4, sampleOf({ ...SIT_POSE, 'motion.py': 0.13, 'body.rx': -0.15, 'head.rx': 0.1, 'earL.rx': -0.45, 'earR.rx': -0.45, 'earL.rz': -0.2, 'earR.rz': 0.2 }, { breathAmp: 0.4, breathHz: 0.55, eyes: 0 })],
  [1.95, sampleOf({ ...SIT_POSE, 'motion.py': -0.025, 'body.rx': 0.12, 'head.rx': -0.05, 'earL.rx': 0.2, 'earR.rx': 0.2 }, { breathAmp: 1, breathHz: 0.55, eyes: 0 })],
  [2.4, SIT0],
];

const STATES: Record<BunnyState, StateDef<BunnyState>> = {
  sit: { kind: 'posture', blend: 1.4, sample: sitSample },
  hide: { kind: 'posture', blend: 1.6, sample: hideSample },
  peek: { kind: 'oneShot', blend: 1.0, length: 5.4, free: 4.4, then: 'hide', sample: (t) => keyframes(peekKeys, t) },
  hop: { kind: 'oneShot', blend: 0.7, length: 2.4, free: 2.0, then: 'sit', sample: (t) => keyframes(hopKeys, t) },
};

const AUTO: AutoGesture<BunnyState, BunnyGesture>[] = [
  { gesture: 'noseTwitch', min: 4, max: 9, states: ['sit', 'hide'] },
  { gesture: 'earFlickL', min: 8, max: 18, states: ['sit'] },
  { gesture: 'earFlickR', min: 10, max: 20, states: ['sit'] },
  { gesture: 'slowBlink', min: 12, max: 26, states: ['sit'] },
];

export const BUNNY_DEF: CritterDef<BunnyState, BunnyGesture> = {
  initial: 'sit',
  states: STATES,
  allow: {
    sit: ['hide', 'hop'],
    hide: ['sit', 'peek'],
    peek: ['hide', 'sit'],
    hop: ['sit', 'hide'],
  },
  // from a standing seat she cannot peek: she ducks first
  via: (from, to) => (from === 'sit' && to === 'peek' ? 'hide' : from === 'hop' && to === 'peek' ? 'hide' : from === 'hide' && to === 'hop' ? 'sit' : null),
  gestures: {
    noseTwitch: { length: 1.1, cooldown: 1.5 },
    earFlickL: { length: 0.5, cooldown: 1.5 },
    earFlickR: { length: 0.5, cooldown: 1.5 },
    slowBlink: { length: 1.65, cooldown: 3 },
  },
  auto: AUTO,
};

export function newBunny(opts: { reducedMotion?: boolean; seed?: number; auto?: boolean } = {}): Critter<BunnyState, BunnyGesture> {
  return new Critter(BUNNY_DEF, opts);
}
