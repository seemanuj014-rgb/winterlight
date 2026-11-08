// Phase 26: the lanterns, as plain maths (no three, no DOM, no clock): where each paper lantern is at a given second after the release, how bright, how big. A lantern's whole
// life is a pure function of (its own numbers, t), so a frozen frame (`&at=`), a replay and a test all see the same thing. Everything numeric is `[A]` (mine, tune by eye).
// The release is the quiet beat after the candles: a hush, then the lanterns let go of the table one by one and rise into the aurora, swaying, and fade out high up.

export type Tier = 'low' | 'mid' | 'high';

/** how many lanterns at each tier (ONE instanced draw call whatever the count). Reduced motion shows half. */
export const LANTERN_COUNT: Record<Tier, number> = { low: 7, mid: 12, high: 18 };
export const REDUCED_LANTERN_SHARE = 0.5;
export const lanternCount = (tier: Tier, reduced: boolean): number => (reduced ? Math.ceil(LANTERN_COUNT[tier] * REDUCED_LANTERN_SHARE) : LANTERN_COUNT[tier]);

/** the beat: the music hushes for this long (the audio swell comes after it), then the glitter bursts and the first lantern lets go */
export const RELEASE = {
  /** seconds of quiet before anything moves */
  hushS: 1.4,
  /** the lanterns let go one by one over this many seconds after the hush */
  spreadS: 5,
  /** one lantern's whole life, from the table to gone */
  lifeS: 16,
  /** it grows from nothing to full size over this long, and its light comes up over this long */
  growS: 1.2,
  glowInS: 2,
  /** it fades out over the last share of its life */
  fadeShare: 0.28,
} as const;

/** seconds from the start of the whole release to the moment the last lantern is gone */
export const releaseEndS = (): number => RELEASE.hushS + RELEASE.spreadS + RELEASE.lifeS;

export interface Lantern {
  /** seconds after the hush that this one lets go */
  delay: number;
  /** where on the table it lifts off, metres from the table's middle */
  x0: number;
  z0: number;
  /** size (1 = 0.3 m tall), how fast it climbs (m/s), how its climb speeds up, how far it drifts toward the aurora and sideways (m over its life) */
  size: number;
  rise: number;
  accel: number;
  driftZ: number;
  driftX: number;
  /** sway: amplitude (m), frequency (Hz), phase (rad) */
  swayAmp: number;
  swayHz: number;
  phase: number;
  /** how warm it is (0 = paler, 1 = deeper amber) and the flicker speed */
  warm: number;
  flickerHz: number;
}

/** a small deterministic random generator (the same as the rest of the card) */
export function lanternRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The lanterns for the biggest tier; a smaller tier draws the first `count` of them, so a lower tier is a thinner flock, not a different one. Delays are in order, jittered. */
export function makeLanterns(seed = 26, count = LANTERN_COUNT.high): Lantern[] {
  const r = lanternRng(seed);
  const out: Lantern[] = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 0.42;
    // the first lanterns go a little apart in time so a small tier still reads as "one by one"
    const base = count > 1 ? (i / (count - 1)) * RELEASE.spreadS : 0;
    const side = r() < 0.5 ? -1 : 1;
    out.push({
      delay: Math.max(0, Math.min(RELEASE.spreadS, base + (r() - 0.5) * 0.5)),
      x0: Math.cos(a) * rad,
      z0: Math.sin(a) * rad * 0.7,
      size: 0.85 + r() * 0.35,
      rise: 0.55 + r() * 0.35,
      accel: 0.012 + r() * 0.02,
      driftZ: 5 + r() * 7,
      driftX: side * (0.8 + r() * 3.2),
      swayAmp: 0.12 + r() * 0.2,
      swayHz: 0.16 + r() * 0.14,
      phase: r() * Math.PI * 2,
      warm: r(),
      flickerHz: 0.8 + r() * 1.6,
    });
  }
  return out;
}

export interface LanternPose {
  /** is it in the sky at all at this time */
  visible: boolean;
  /** offset from the table's top, metres (the view adds the table's place) */
  x: number;
  y: number;
  z: number;
  /** a small roll and pitch from the sway, radians */
  roll: number;
  pitch: number;
  scale: number;
  /** 0..1 the light inside, with a slow flicker */
  glow: number;
  /** 0..1 how opaque (fades out near the end of its life) */
  alpha: number;
  /** 0..1 progress through its life */
  u: number;
}

const HIDDEN: LanternPose = { visible: false, x: 0, y: 0, z: 0, roll: 0, pitch: 0, scale: 0, glow: 0, alpha: 0, u: 0 };
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/**
 * Where one lantern is `tSec` seconds after the START of the whole release (so the hush is included). Reduced motion climbs slower, sways a quarter as much and does not flicker.
 * `tableTopY` is how high above the ground the table's top is; the pose's y starts there.
 */
export function lanternPose(l: Lantern, tSec: number, reduced = false, tableTopY = 0): LanternPose {
  if (!Number.isFinite(tSec)) return { ...HIDDEN };
  const age = tSec - RELEASE.hushS - l.delay;
  if (age < 0 || age > RELEASE.lifeS) return { ...HIDDEN };
  const u = age / RELEASE.lifeS;
  const speed = reduced ? 0.6 : 1;
  // it lifts off gently (the first second is slow), then climbs a little faster the higher it goes
  const lift = smooth(0, 1.6, age);
  const climb = l.rise * speed * (age * (0.35 + 0.65 * lift) + l.accel * age * age);
  const sway = (reduced ? 0.25 : 1) * l.swayAmp * Math.min(1, age / 3);
  const w = 2 * Math.PI * l.swayHz * age + l.phase;
  const x = l.x0 + l.driftX * u * u * (0.4 + 0.6 * u) + sway * Math.sin(w) * (1 + 1.2 * u);
  const z = l.z0 - l.driftZ * Math.pow(u, 1.15) * speed + sway * 0.6 * Math.cos(w * 0.8);
  const y = 0.05 + climb;
  const flick = reduced ? 0 : 0.08 * Math.sin(2 * Math.PI * l.flickerHz * age + l.phase * 3) + 0.04 * Math.sin(2 * Math.PI * l.flickerHz * 2.7 * age + l.phase);
  const glow = clamp01(smooth(0, RELEASE.glowInS, age) * (0.92 + flick));
  const fade = 1 - smooth(1 - RELEASE.fadeShare, 1, u);
  return {
    visible: true,
    x,
    y: y + tableTopY,
    z,
    roll: (reduced ? 0.25 : 1) * 0.12 * Math.sin(w + 1.3),
    pitch: (reduced ? 0.25 : 1) * 0.07 * Math.cos(w * 0.8),
    scale: l.size * smooth(0, RELEASE.growS, age),
    glow,
    alpha: fade * smooth(0, 0.5, age),
    u,
  };
}

/**
 * The camera for the release: behind the table, low, the table and its cake at the bottom of the picture, looking up past it into the aurora so the lanterns climb out of the cake and through the picture. Returns eye / look relative to the table's
 * top (the view adds the table's place) and a field of view that is wider on a tall phone screen so the climb still fits.
 */
export function releaseCamera(aspect: number): { eye: [number, number, number]; look: [number, number, number]; fovDeg: number } {
  const a = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 0.5;
  const tall = a < 0.8;
  return {
    eye: [0.1, tall ? 1.0 : 0.8, tall ? 3.7 : 3.2],
    look: [0.1, tall ? 2.9 : 2.2, -6],
    fovDeg: tall ? 64 : 52,
  };
}
