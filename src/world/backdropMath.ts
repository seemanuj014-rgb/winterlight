// Phase 12: the numbers behind the night backdrop. Pure: no three, no DOM, no clock, so it is unit-tested.
// Everything here is deterministic (seeded) so a screenshot, a test and her phone all see the same sky.

export type Tier = 'low' | 'mid' | 'high';

/** Small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** 1D value noise in [0,1], smooth, from a seeded lattice. */
export function makeNoise1D(seed: number, size = 256, linear = false): (x: number) => number {
  const r = rng(seed);
  const lat = Array.from({ length: size }, () => r());
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = lat[((i % size) + size) % size]!;
    const b = lat[(((i + 1) % size) + size) % size]!;
    return a + (b - a) * (linear ? f : smooth(f)); // linear lattice = straight faces and sharp corners, like folded paper
  };
}

// ---------------------------------------------------------------------------
// Mountains
// ---------------------------------------------------------------------------

/** One layer of mountains. Nearer layers are lower, softer and darker; farther ones taller, sharper and hazier (AD: hazier with distance). */
export interface MountainLayer {
  name: string;
  /** distance from the eye along -z, in world units */
  dist: number;
  /** ridge height in degrees of elevation seen from the eye: [lowest, highest] */
  elevDeg: [number, number];
  /** 0 = rolling, 1 = sharp ridged peaks */
  sharp: number;
  /** ridge noise frequency: peaks across the layer's width */
  peaks: number;
  /** colour of the body and of the haze it fades into at its foot (hex, AD palette: far mountains #3b5278 to #5a7196) */
  body: number;
  haze: number;
  /** how much of the height is swallowed by haze, 0..1 */
  hazeAmount: number;
  /** how much moon-lit snow shows on the faces that look at the moon, 0..1 */
  snow: number;
  /** how far this layer slides in the slow drift, as a share of the drift amplitude (near moves more) */
  parallax: number;
  seed: number;
}

export const EYE_HEIGHT = 1.7;
/** Layers from far to near. All of them are drawn without an ink line (AD: the background drops the outline). */
export const MOUNTAIN_LAYERS: readonly MountainLayer[] = [
  { name: 'far', dist: 78, elevDeg: [8, 19], sharp: 1.0, peaks: 9, body: 0x5a7196, haze: 0x6f86b8, hazeAmount: 0.5, snow: 0.34, parallax: 0.1, seed: 11 },
  { name: 'mid-far', dist: 62, elevDeg: [6, 14], sharp: 0.85, peaks: 8, body: 0x50688f, haze: 0x667cab, hazeAmount: 0.46, snow: 0.26, parallax: 0.25, seed: 23 },
  { name: 'mid-near', dist: 48, elevDeg: [4, 10], sharp: 0.6, peaks: 6, body: 0x445d85, haze: 0x566c94, hazeAmount: 0.4, snow: 0.18, parallax: 0.5, seed: 37 },
  { name: 'near', dist: 36, elevDeg: [2, 6], sharp: 0.3, peaks: 4, body: 0x3b5278, haze: 0x2a3d60, hazeAmount: 0.3, snow: 0.1, parallax: 1.0, seed: 41 },
];

/** Half the width of a layer in radians of arc around the eye (80 degrees each way: a wide landscape view and room to turn). Each layer is a curved wall at constant distance, so it never pokes through the sky behind it. */
export const LAYER_HALF_WIDTH = 1.4;
export const LAYER_COLUMNS = 220;

export interface Ridge {
  /** position of each column along the layer's arc, in world units of arc length (angle = x / dist), centred on 0 */
  x: Float32Array;
  /** top of the ridge at each column, world y (ground is y = 0) */
  y: Float32Array;
  /** -1..1: how much that part of the ridge faces the moon (left): + lit, - in shade */
  light: Float32Array;
}

/** The ridge line of one layer. Deterministic from the layer's seed. */
export function makeRidge(layer: MountainLayer, columns = LAYER_COLUMNS): Ridge {
  const n1 = makeNoise1D(layer.seed);
  const n2 = makeNoise1D(layer.seed + 101);
  const n3 = makeNoise1D(layer.seed + 202);
  const lin = makeNoise1D(layer.seed + 303, 256, true);
  const tent = (p: number): number => 1 - Math.abs(2 * lin(p) - 1); // straight-sided peaks
  const half = layer.dist * LAYER_HALF_WIDTH;
  const lo = Math.tan((layer.elevDeg[0] * Math.PI) / 180) * layer.dist + EYE_HEIGHT;
  const hi = Math.tan((layer.elevDeg[1] * Math.PI) / 180) * layer.dist + EYE_HEIGHT;
  const x = new Float32Array(columns + 1);
  const y = new Float32Array(columns + 1);
  const light = new Float32Array(columns + 1);
  for (let i = 0; i <= columns; i++) {
    const u = i / columns; // 0..1 across the layer
    x[i] = (u * 2 - 1) * half;
    const p = u * layer.peaks;
    // a big slow shape sets where the high peaks stand; finer octaves roughen it
    const big = n1(p * 0.6);
    const soft = 0.55 * n2(p) + 0.3 * n3(p * 2.1 + 3) + 0.15 * n2(p * 4.3 + 9);
    const sharp = 0.55 * tent(p) + 0.3 * tent(p * 2.1 + 3) + 0.15 * tent(p * 4.3 + 9);
    const mid = soft + (sharp - soft) * layer.sharp; // rolling layers stay soft, far ones are folded
    // widen the contrast so there are real peaks and real saddles, not a flat wobble
    const raw = (0.4 * big + 0.6 * mid - 0.3) * 1.8;
    const h = clamp(raw > 0.8 ? 0.8 + 0.2 * Math.tanh((raw - 0.8) / 0.2) : raw, 0, 1); // soft top, no flat-topped mesas
    y[i] = lo + (hi - lo) * h;
  }
  for (let i = 0; i <= columns; i++) {
    const a = y[Math.max(0, i - 1)]!;
    const b = y[Math.min(columns, i + 1)]!;
    const dx = x[Math.min(columns, i + 1)]! - x[Math.max(0, i - 1)]!;
    const slope = (b - a) / dx; // + going up to the right: that face looks left, toward the moon
    // slope as a share of how steep a face can be on this layer
    const maxSlope = ((hi - lo) / (layer.dist * 0.05)) * 0.6;
    light[i] = clamp(slope / maxSlope, -1, 1);
  }
  return { x, y, light };
}

/** Number of triangles a layer's strip uses (two rows of quads: ridge to mid, mid to foot). */
export function layerTriangles(columns = LAYER_COLUMNS): number {
  return columns * 2 * 2;
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

/** Star counts per tier. PB particle budgets are 800 / 2,500 / 6,000 for the WHOLE scene; snow (Phase 13) needs most of it. */
export const STAR_COUNT: Record<Tier, number> = { low: 320, mid: 640, high: 1000 };

export interface Stars {
  count: number;
  /** unit directions, 3 floats each, all above the horizon */
  dir: Float32Array;
  /** size in CSS pixels */
  size: Float32Array;
  /** twinkle phase (radians) */
  phase: Float32Array;
  /** twinkle speed (radians per second) */
  speed: Float32Array;
  /** how much it twinkles, 0..1 */
  depth: Float32Array;
  /** colour as r,g,b 0..1 (sRGB), 3 floats each */
  tint: Float32Array;
}

const STAR_TINTS: [number, number, number][] = [
  [0.86, 0.91, 1.0], // cool white
  [0.86, 0.91, 1.0],
  [0.86, 0.91, 1.0],
  [1.0, 0.92, 0.78], // rare warm
  [0.78, 0.76, 1.0], // lavender
];

/** Moon direction: left of centre, up, behind the scene, matching the left-back rim light of the toon ramp (Phase 3). */
export const MOON_AZIMUTH_DEG = -9; // 0 = straight ahead (-z), negative = left
export const MOON_ELEVATION_DEG = 25;
export const MOON_RADIUS_DEG = 3.4; // exaggerated, as in a picture book

export function dirFromAngles(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** Stars in random order, so any prefix is evenly scattered (a tier step-down just draws fewer). Deterministic. */
export function makeStars(seed = 7, count = STAR_COUNT.high): Stars {
  const r = rng(seed);
  const dir = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const depth = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  const moon = dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
  const keepOut = Math.cos(((MOON_RADIUS_DEG + 2.2) * Math.PI) / 180); // no star behind the moon's disc and rim
  let i = 0;
  while (i < count) {
    // uniform on the upper sphere, thinned toward the horizon so the glow there stays clean
    const y = r();
    const az = r() * Math.PI * 2;
    const rad = Math.sqrt(1 - y * y);
    const d: [number, number, number] = [Math.cos(az) * rad, y, Math.sin(az) * rad];
    if (y < 0.03) continue;
    if (y < 0.3 && r() > y / 0.3 + 0.1) continue;
    if (d[0] * moon[0] + d[1] * moon[1] + d[2] * moon[2] > keepOut) continue;
    dir[i * 3] = d[0];
    dir[i * 3 + 1] = d[1];
    dir[i * 3 + 2] = d[2];
    const big = r();
    size[i] = big > 0.97 ? 5 + r() * 1.5 : big > 0.85 ? 3.2 + r() * 1.0 : 1.9 + r() * 1.1;
    phase[i] = r() * Math.PI * 2;
    speed[i] = 0.5 + r() * 1.7;
    depth[i] = 0.25 + r() * 0.55;
    const t = STAR_TINTS[Math.floor(r() * STAR_TINTS.length)]!;
    tint[i * 3] = t[0];
    tint[i * 3 + 1] = t[1];
    tint[i * 3 + 2] = t[2];
    i++;
  }
  return { count, dir, size, phase, speed, depth, tint };
}

// ---------------------------------------------------------------------------
// Aurora, drift, view
// ---------------------------------------------------------------------------

export const AURORA = {
  /** the ribbon: a curved strip on the sky behind the mountains */
  dist: 84,
  /** centre of the ribbon in azimuth (degrees, 0 = ahead) and the half-width it covers */
  azimuthDeg: 6,
  halfAzimuthDeg: 80,
  /** lowest and highest edge of the strip, degrees of elevation */
  bottomDeg: 8,
  topDeg: 52,
  segments: 28,
  /** colours (AD): teal, violet, rare pink */
  teal: 0x58e0c0,
  violet: 0x9a86ff,
  pink: 0xf0a0d0,
  /** overall strength by tier; soft on purpose */
  strength: { low: 0.62, mid: 0.56, high: 0.52 } as Record<Tier, number>,
  /** noise octaves in the shader by tier */
  octaves: { low: 1, mid: 2, high: 3 } as Record<Tier, number>,
  /** how fast the curtain moves, 1 = the normal slow drift */
  speed: 1,
};

/** The slow parallax drift: world units, a gentle sine that takes about a minute and a half to go and return. No drift under reduced motion. */
export const DRIFT = { amplitude: 1.1, periodSec: 90 };
export function driftOffset(tSec: number, reducedMotion: boolean): number {
  if (reducedMotion || !Number.isFinite(tSec)) return 0;
  return Math.sin((tSec / DRIFT.periodSec) * Math.PI * 2) * DRIFT.amplitude;
}

export interface BackdropView {
  fovDeg: number;
  eyeY: number;
  pitchDeg: number;
  /** horizontal half-angle seen, degrees */
  halfHorizontalDeg: number;
}

/** The camera used by the `?world` test view (the camera director, Phase 17, replaces it). Tall phones get a taller field of view so the moon and the aurora stay in frame. */
export function fitBackdropView(aspect: number): BackdropView {
  const a = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 1;
  const fovDeg = a < 0.75 ? 64 : a < 1.1 ? 56 : 46;
  const pitchDeg = a < 0.75 ? 12 : a < 1.1 ? 11 : 9;
  const halfH = (Math.atan(Math.tan((fovDeg * Math.PI) / 360) * a) * 180) / Math.PI;
  return { fovDeg, eyeY: EYE_HEIGHT, pitchDeg, halfHorizontalDeg: halfH };
}

/** Is a direction (azimuth, elevation in degrees) inside the view when looking ahead at the view's pitch? Small-angle check, enough for tests. */
export function inView(view: BackdropView, aspect: number, azimuthDeg: number, elevationDeg: number, margin = 0): boolean {
  const halfV = view.fovDeg / 2;
  const halfH = view.halfHorizontalDeg;
  void aspect;
  return Math.abs(azimuthDeg) <= halfH - margin && Math.abs(elevationDeg - view.pitchDeg) <= halfV - margin;
}

/** Hex to 0..1 sRGB triple, for tests and for uniforms. */
export function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
/** Perceptual-ish brightness of a hex colour, 0..1. */
export function luma(hex: number): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
