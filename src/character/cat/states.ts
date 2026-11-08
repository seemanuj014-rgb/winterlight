// Phase 16: the cat's states as data. Pure maths, no three.
//   sleep    posture   curled on the blanket, eyes shut as the drawn curve, a slow breath
//   wake     one-shot  4.6 s: eyes open slowly, head comes up, she unrolls and settles into `sit`
//   sit      posture   upright, tail curled round her feet, tiny drifts of head and tail, breathing
//   stretch  one-shot  6 s: front down, rump up, tail up, a long hold, back to `sit`
//   purr     posture   a loaf with the eyes at half, a faster small breath and a faint tremor (the purr loop)
// Gestures (never change the posture): earFlickL, earFlickR, tailFlick, slowBlink.
// Every number is mine `[A]` (the cat is ours to design). Poses are deltas from the model's rest (head up, tail straight back, ears upright).
import { Critter, keyframes, sampleOf, type AutoGesture, type CritterDef, type Key, type Sample, type StateDef } from '../companion/engine';

export type CatState = 'sleep' | 'wake' | 'sit' | 'stretch' | 'purr';
export type CatGesture = 'earFlickL' | 'earFlickR' | 'tailFlick' | 'slowBlink';
export const CAT_STATE_NAMES: readonly CatState[] = ['sleep', 'wake', 'sit', 'stretch', 'purr'];
export const CAT_GESTURE_NAMES: readonly CatGesture[] = ['earFlickL', 'earFlickR', 'tailFlick', 'slowBlink'];

const EARS = { 'earL.rz': -0.3, 'earR.rz': 0.3 };

/** The upright pose: the rest pose of the model, with her tail curled round her feet. */
export const SIT_POSE = { ...EARS, 'tail1.px': -0.1, 'tail1.ry': 2.3, 'tail2.ry': 0.55 } as const;

/** The loaf: body turned forward and low, the front legs tucked back under the chest, the hind paws kept flat, the tail laid along her left side. Authored by eye (Phase 16). */
const LOAF = {
  'body.rx': 1.3, 'body.py': -0.04, 'hind.rx': -1.3, 'fore.rx': 0.6,
  'head.pz': 0.02, 'head.py': -0.05,
  'tail1.rx': -1.3, 'tail1.px': -0.1, 'tail1.ry': 2.5, 'tail2.ry': 0.5,
} as const;

/** Curled on the blanket: the loaf, chin down on her paws, ears laid back. */
export const SLEEP_POSE = { ...LOAF, 'head.rx': -1.1, 'earL.rz': -0.42, 'earR.rz': 0.42, 'earL.rx': 0.3, 'earR.rx': 0.3 } as const;

/** A loaf with the head up: the purr. */
export const PURR_POSE = { ...LOAF, 'head.rx': -1.6, 'head.py': 0, ...EARS } as const;

/** Front down, rump up, tail up: the long stretch (a play bow, held). */
export const STRETCH_POSE = {
  ...EARS,
  'body.rx': 0.62, 'body.py': 0.02, 'hind.rx': -0.62,
  'fore.rx': -2.2,
  'head.rx': -0.35, 'head.py': -0.02,
  'tail1.rx': 1.35, 'tail1.ry': 0.1, 'tail2.rx': 0.35,
} as const;

const sw = (t: number, hz: number, ph = 0): number => Math.sin(t * Math.PI * 2 * hz + ph) - Math.sin(ph); // 0 at t = 0, so t = 0 is the mean

const sitSample = (t: number): Sample =>
  sampleOf(
    {
      ...SIT_POSE,
      'tail2.ry': SIT_POSE['tail2.ry'] + 0.1 * sw(t, 0.14, 0),
      'tail1.ry': SIT_POSE['tail1.ry'] + 0.05 * sw(t, 0.14, 0.6),
      'head.ry': 0.07 * sw(t, 0.05),
      'head.rz': 0.025 * sw(t, 0.033),
    },
    { breathAmp: 1, breathHz: 0.24, eyes: 0, gx: 0.2 * sw(t, 0.04), gy: 0 },
  );

const sleepSample = (t: number): Sample =>
  sampleOf({ ...SLEEP_POSE, 'tail2.ry': SLEEP_POSE['tail2.ry'] + 0.03 * sw(t, 0.1) }, { breathAmp: 1.3, breathHz: 0.16, eyes: 1, gx: 0, gy: -0.2 });

const purrSample = (t: number): Sample =>
  sampleOf({ ...PURR_POSE, 'head.ry': 0.04 * sw(t, 0.05), 'tail2.ry': PURR_POSE['tail2.ry'] + 0.05 * sw(t, 0.12) }, { breathAmp: 0.8, breathHz: 0.5, eyes: 0.62, shiver: 1, gx: 0, gy: 0 });

const SIT_END = sitSample(0);
const SLEEP_START = sleepSample(0);

const wakeKeys: Key[] = [
  [0, SLEEP_START],
  [1.2, sampleOf({ ...SLEEP_POSE, 'head.rx': -1.2, 'earL.rz': -0.36, 'earR.rz': 0.36 }, { breathAmp: 1, breathHz: 0.22, eyes: 0.8, gy: -0.1 })],
  [2.3, sampleOf({ ...PURR_POSE }, { breathAmp: 1, breathHz: 0.24, eyes: 0.4, gy: 0 })],
  [3.4, sampleOf({ ...SIT_POSE, 'body.rx': 0.5, 'body.py': -0.02, 'hind.rx': -0.5, 'fore.rx': -0.3, 'head.rx': -0.45, 'tail1.rx': -0.5, 'tail1.px': -0.09, 'tail1.ry': 1.9, 'tail2.ry': 0.8 }, { breathAmp: 1, breathHz: 0.24, eyes: 0.1, gy: 0 })],
  [4.6, SIT_END],
];

const stretchKeys: Key[] = [
  [0, SIT_END],
  [1.4, sampleOf({ ...SIT_POSE, 'body.rx': 0.3, 'hind.rx': -0.3, 'head.rx': -0.2, 'fore.rx': -0.6 }, { breathAmp: 1, breathHz: 0.24, eyes: 0.3 })],
  [2.8, sampleOf(STRETCH_POSE, { breathAmp: 1.4, breathHz: 0.2, eyes: 0.85 })],
  [4.4, sampleOf({ ...STRETCH_POSE, 'tail2.rx': 0.5, 'body.py': 0.025 }, { breathAmp: 1.4, breathHz: 0.2, eyes: 0.85 })],
  [6.0, SIT_END],
];

const STATES: Record<CatState, StateDef<CatState>> = {
  sleep: { kind: 'posture', blend: 2.8, sample: sleepSample },
  wake: { kind: 'oneShot', blend: 0.6, length: 4.6, free: 3.4, then: 'sit', sample: (t) => keyframes(wakeKeys, t) },
  sit: { kind: 'posture', blend: 2.0, sample: sitSample },
  stretch: { kind: 'oneShot', blend: 1.2, length: 6.0, free: 4.4, then: 'sit', sample: (t) => keyframes(stretchKeys, t) },
  purr: { kind: 'posture', blend: 2.2, sample: purrSample },
};

const AUTO: AutoGesture<CatState, CatGesture>[] = [
  { gesture: 'earFlickL', min: 6, max: 15, states: ['sit', 'purr'] },
  { gesture: 'earFlickR', min: 8, max: 17, states: ['sit', 'purr'] },
  { gesture: 'earFlickL', min: 14, max: 30, states: ['sleep'] },
  { gesture: 'tailFlick', min: 9, max: 20, states: ['sit', 'purr'] },
  { gesture: 'slowBlink', min: 10, max: 22, states: ['sit'] },
];

export const CAT_DEF: CritterDef<CatState, CatGesture> = {
  initial: 'sleep',
  states: STATES,
  allow: {
    sleep: ['wake'],
    wake: ['sit', 'stretch', 'purr', 'sleep'],
    sit: ['stretch', 'purr', 'sleep'],
    stretch: ['sit', 'purr', 'sleep'],
    purr: ['sit', 'stretch', 'sleep'],
  },
  // asking for anything while she sleeps wakes her first
  via: (from) => (from === 'sleep' ? 'wake' : null),
  gestures: {
    earFlickL: { length: 0.5, cooldown: 1.5 },
    earFlickR: { length: 0.5, cooldown: 1.5 },
    tailFlick: { length: 1.0, cooldown: 2 },
    slowBlink: { length: 1.65, cooldown: 3 },
  },
  auto: AUTO,
};

export function newCat(opts: { reducedMotion?: boolean; seed?: number; auto?: boolean } = {}): Critter<CatState, CatGesture> {
  return new Critter(CAT_DEF, opts);
}
