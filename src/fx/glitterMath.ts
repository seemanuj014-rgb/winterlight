// Phase 26: the soft snow-glitter burst, as plain maths (no three). One burst, let off at the moment the first lantern lets go: a few hundred tiny sparks leave the table's top in
// every direction, slow down in the cold air, hang, twinkle and settle. Each spark's whole life is a pure function of (its numbers, t since the burst). `[A]` numbers.

export type Tier = 'low' | 'mid' | 'high';

/**
 * Sparks per tier. Sized against `docs/PERF_BUDGET.md` (particles low 800 / mid 2,500 / high 6,000): stars + snow + the cake's 10 flame and smoke points + the lantern halos + these
 * must stay within it (tests/fx.test.ts counts it). Reduced motion shows half, and they do not twinkle.
 */
export const GLITTER_COUNT: Record<Tier, number> = { low: 120, mid: 320, high: 640 };
export const REDUCED_GLITTER_SHARE = 0.5;
export const glitterCount = (tier: Tier, reduced: boolean): number => (reduced ? Math.ceil(GLITTER_COUNT[tier] * REDUCED_GLITTER_SHARE) : GLITTER_COUNT[tier]);

export const GLITTER = {
  /** the burst's life, seconds: every spark is gone by then */
  lifeS: 5.5,
  /** how fast the air slows a spark (1/s) and how fast gravity pulls it down (m/s^2, small: it is light) */
  drag: 1.3,
  gravity: 0.35,
  /** launch speed range, m/s */
  speedMin: 0.5,
  speedMax: 2.6,
  /** sprite size range in pixels at one pixel ratio */
  sizeMin: 2.2,
  sizeMax: 5,
  /** twinkle speed range, Hz */
  twinkleMin: 1.2,
  twinkleMax: 3.4,
  /** colours: frost, warm, ice (the card's constellation palette) */
  frost: 0xf4fbff,
  warm: 0xffe2b0,
  ice: 0x9cc8ff,
} as const;

export function glitterRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Glitter {
  count: number;
  /** launch velocity xyz per spark */
  vel: Float32Array;
  size: Float32Array;
  phase: Float32Array;
  twinkle: Float32Array;
  /** 0 frost, 1 warm, 2 ice */
  tint: Float32Array;
  /** seconds after the burst that a spark starts (a tiny stagger so it is a burst, not a flash) */
  delay: Float32Array;
}

/** The sparks for the biggest tier; a smaller tier draws the first part, so a lower tier is a thinner burst, not a different one. */
export function makeGlitter(seed = 52, count = GLITTER_COUNT.high): Glitter {
  const r = glitterRng(seed);
  const vel = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const twinkle = new Float32Array(count);
  const tint = new Float32Array(count);
  const delay = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // a ball of directions, leaning up (a burst off a table top does not go through the table)
    const az = r() * Math.PI * 2;
    const el = Math.asin(0.15 + r() * 0.85);
    const sp = GLITTER.speedMin + (GLITTER.speedMax - GLITTER.speedMin) * Math.pow(r(), 0.7);
    vel[i * 3] = Math.cos(az) * Math.cos(el) * sp;
    vel[i * 3 + 1] = Math.sin(el) * sp;
    vel[i * 3 + 2] = Math.sin(az) * Math.cos(el) * sp;
    size[i] = GLITTER.sizeMin + (GLITTER.sizeMax - GLITTER.sizeMin) * r();
    phase[i] = r() * Math.PI * 2;
    twinkle[i] = GLITTER.twinkleMin + (GLITTER.twinkleMax - GLITTER.twinkleMin) * r();
    const c = r();
    tint[i] = c < 0.62 ? 0 : c < 0.86 ? 1 : 2;
    delay[i] = r() * 0.35;
  }
  return { count, vel, size, phase, twinkle, tint, delay };
}

/** where spark `i` is (metres from the burst's origin) `t` seconds after the burst: it flies out, the air slows it, gravity slowly pulls it down */
export function glitterOffset(g: Glitter, i: number, t: number): [number, number, number] {
  const tt = Math.max(0, (Number.isFinite(t) ? t : 0) - g.delay[i]!);
  const k = GLITTER.drag;
  const run = (1 - Math.exp(-k * tt)) / k; // distance factor for a velocity that decays like exp(-k t)
  return [g.vel[i * 3]! * run, g.vel[i * 3 + 1]! * run - 0.5 * GLITTER.gravity * tt * tt, g.vel[i * 3 + 2]! * run];
}

/** 0..1 how bright spark `i` is `t` seconds after the burst: a quick flash in, a long soft fade out, and a twinkle on top (none under reduced motion) */
export function glitterAlpha(g: Glitter, i: number, t: number, reduced = false): number {
  const tt = (Number.isFinite(t) ? t : 0) - g.delay[i]!;
  if (tt <= 0 || tt >= GLITTER.lifeS) return 0;
  const u = tt / GLITTER.lifeS;
  const inn = Math.min(1, tt / 0.12);
  const out = 1 - Math.pow(u, 1.6);
  const tw = reduced ? 1 : 0.62 + 0.38 * Math.sin(g.twinkle[i]! * tt * 2 * Math.PI + g.phase[i]!);
  return Math.max(0, Math.min(1, inn * out * tw));
}
