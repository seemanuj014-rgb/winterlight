// Phase 15: the numbers behind the light and the mist. Pure: no three, no DOM, no clock, so it is unit-tested.
// AD: "Cool moonlight as the key. Warm light only from the cabin windows, the lamp, the candles and the lanterns, so warm always means 'someone is here'."
// So: one cool directional light from where the sky's moon stands, a cool hemisphere fill, and a FEW warm point lights, each sitting at a real warm thing.
// Real point lights cost fragment work on every toon surface, so their number is a tier budget (PB), not a taste.

import { CABIN, DOOR, NOOK, WARM_LIGHT } from './cabinMath';
import { dirFromAngles, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG } from './backdropMath';

export type Tier = 'low' | 'mid' | 'high';
export type Vec3 = [number, number, number];

/** Cool moon key. Intensity is a multiple of the toon light intensity (PI), so the ramp's top step is the base colour at 1. */
export const MOON_KEY = { color: 0xcfe0ff, intensity: 1.0 };
/** Cool fill so the shadow side of a log is blue, not black. Sky colour from above, snow-bounce colour from below. */
export const SKY_FILL = { sky: 0x4d6896, ground: 0x7f95bb, intensity: 0.5 };
/** The warm of AD: window and lantern. */
export const WARM = { window: 0xffb86b, lantern: WARM_LIGHT };

export function moonDirection(): Vec3 {
  return dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
}

export interface PointSpec {
  name: string;
  /** in the parent's local frame (cabin: its own frame, the door on +z; nook: the room's frame) */
  pos: Vec3;
  color: number;
  intensity: number;
  /** metres at which the light is gone */
  distance: number;
  decay: number;
  /** slow flicker: [amplitude 0..1, speed in rad/s], and a seed so no two lights breathe together */
  flicker: [number, number];
  seed: number;
}

/** How many real point lights each tier may have at the cabin (PB: the toon shaders loop over them for every pixel). */
export const CABIN_POINT_LIGHTS: Record<Tier, number> = { low: 2, mid: 3, high: 4 };
/** and in the nook (a small room, one lamp is the point): */
export const NOOK_POINT_LIGHTS: Record<Tier, number> = { low: 1, mid: 2, high: 2 };

/** The cabin's warm lights, in order of importance: a tier takes the first N. */
export function cabinPointLights(tier: Tier): PointSpec[] {
  const lx = CABIN.hingeX + DOOR.w + 0.55;
  const frontZ = CABIN.hz + 0.55;
  const all: PointSpec[] = [
    // the lantern by the door: the brightest little thing in the scene
    { name: 'lantern', pos: [lx, 2.0, CABIN.hz + 0.55], color: WARM.lantern, intensity: 7, distance: 7, decay: 1.6, flicker: [0.07, 2.3], seed: 1 },
    // the two front windows together, low, in front of the glass: warm on the snow and the lower logs
    { name: 'window-left', pos: [CABIN.frontWindowX[0]!, 1.4, frontZ + 0.25], color: WARM.window, intensity: 6, distance: 6, decay: 1.6, flicker: [0.03, 1.3], seed: 2 },
    { name: 'window-right', pos: [CABIN.frontWindowX[1]!, 1.4, frontZ + 0.25], color: WARM.window, intensity: 6, distance: 6, decay: 1.6, flicker: [0.03, 1.1], seed: 3 },
    // the doorway
    { name: 'doorway', pos: [0, 1.1, frontZ + 0.6], color: WARM.window, intensity: 5, distance: 6, decay: 1.6, flicker: [0.02, 0.9], seed: 4 },
  ];
  const n = CABIN_POINT_LIGHTS[tier];
  if (n >= all.length) return all;
  // the low tier has only two: the lantern and ONE stand-in for both windows (between them), so the front still reads as lit from inside
  if (n === 2) {
    return [all[0]!, { name: 'windows', pos: [0, 1.4, frontZ + 0.35], color: WARM.window, intensity: 9, distance: 7.5, decay: 1.6, flicker: [0.03, 1.2], seed: 2 }];
  }
  return all.slice(0, n);
}

/** The nook: the lamp on the bedside table, and (mid and high) a faint warm bounce in front of the bed so the camera side of the room is not a black wall. */
export function nookPointLights(tier: Tier): PointSpec[] {
  const all: PointSpec[] = [
    { name: 'lamp', pos: [NOOK.lamp[0], NOOK.lamp[1] + 0.12, NOOK.lamp[2] + 0.2], color: WARM.window, intensity: 3.2, distance: 5.5, decay: 1.6, flicker: [0.025, 1.7], seed: 11 },
    { name: 'bounce', pos: [0.1, 1.5, 1.2], color: WARM.lantern, intensity: 0.9, distance: 6, decay: 1.2, flicker: [0, 0], seed: 12 },
  ];
  return all.slice(0, NOOK_POINT_LIGHTS[tier]);
}

/** The cool light through the nook's window, from outside toward the room's middle: a soft key from the right. */
export const NOOK_WINDOW_LIGHT = { color: 0xa9c4ff, intensity: 0.28, from: [4.5, 3.2, 1.4] as Vec3 };
export const NOOK_FILL = { sky: 0x4a5d88, ground: 0x6a5a52, intensity: 0.32 };

/** A slow, never-jumpy brightness factor around 1: two sines and a seed. Reduced motion or zero amplitude: exactly 1 (steady). */
export function flicker(t: number, amp: number, speed: number, seed: number, reduced: boolean): number {
  if (reduced || !(amp > 0) || !Number.isFinite(t)) return 1;
  const a = Math.sin(t * speed + seed * 1.7) * 0.6 + Math.sin(t * speed * 2.37 + seed * 4.1) * 0.4;
  return 1 + amp * a;
}

// ---------------------------------------------------------------------------
// Height fog: a low, cool mist that lies on the snow and thins out above head height. Exponential in height, integrated exactly along the ray
// from the eye to the point, so a tree trunk is hazier at its foot than at its top and the snow melts into blue with distance.
// ---------------------------------------------------------------------------
export const MIST = {
  /** colour it fades into (a little lighter and bluer than the ground fog, so low mist reads as light, not as dirt) */
  color: 0x3a5380,
  /** density in 1/metre at the ground */
  density: 0.034,
  /** how fast it thins with height: e-fold at 1/falloff metres (about 2.3 m) */
  falloff: 0.42,
  /** the most mist it can ever add */
  max: 0.62,
};

/**
 * Fraction of the mist colour added for a ray of length `dist` from height `y0` to height `y1` (metres above the snow), 0..max.
 * The JS twin of `heightMist` in the shader; a test holds them to the same arithmetic.
 */
export function heightMist(dist: number, y0: number, y1: number, m = MIST): number {
  if (!(dist > 0) || !Number.isFinite(dist)) return 0;
  const a = Math.max(0, y0);
  const b = Math.max(0, y1);
  const k = m.falloff;
  const dy = (b - a) * k;
  // mean of exp(-k y) along the ray
  const meanDensity = Math.abs(dy) < 1e-4 ? Math.exp(-k * a) : (Math.exp(-k * a) - Math.exp(-k * b)) / dy;
  const tau = m.density * dist * meanDensity;
  return m.max * (1 - Math.exp(-tau));
}

/** GLSL twin. Included by the terrain and pine shaders; `eye` is the camera position, `p` the world position of the pixel. */
export const HEIGHT_MIST_GLSL = /* glsl */ `
uniform vec4 uMist;   // density, falloff, max, 0
float heightMist(vec3 p, vec3 eye) {
  float dist = length(p - eye);
  float a = max(0.0, eye.y);
  float b = max(0.0, p.y);
  float dy = (b - a) * uMist.y;
  float meanD = abs(dy) < 0.0001 ? exp(-uMist.y * a) : (exp(-uMist.y * a) - exp(-uMist.y * b)) / dy;
  return uMist.z * (1.0 - exp(-uMist.x * dist * meanD));
}
`;
