// Phase 13: the numbers and the geometry behind the snow ground, the snowfall and the pines. Pure: no three, no DOM, no clock, so it is unit-tested.
// Everything is deterministic (seeded): a screenshot, a test and her phone all see the same hills and the same forest.
// The three.js side (`terrain.ts`, `snowfall.ts`, `pines.ts`, `ground.ts`) only wraps these arrays in buffers.

import { rng, EYE_HEIGHT, STAR_COUNT, dirFromAngles, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, MOUNTAIN_LAYERS, type Tier } from './backdropMath';

export type { Tier };

const smooth = (t: number): number => t * t * (3 - 2 * t);
const quint = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number): number => smooth(clamp((x - a) / (b - a), 0, 1));

/** AD palette. Snow lit and shadow, pine and its snow tiers. */
export const SNOW_LIT = 0xe8f1f8;
export const SNOW_SHADOW = 0xa9bdd6;
export const PINE = 0x1f3a3a;
export const PINE_SNOW = 0xdfeaf2;
/** Far ground melts into the haze at the foot of the nearest mountain layer (about #2c4063, see mountains.ts: haze mixed 86 percent over the body), so there is no seam. */
export const GROUND_FOG = 0x2c4063;
/** the soft blob shadow under a pine on snow: AD snow shadow pushed toward mid sky */
export const BLOB_SHADOW = 0x7d92b4;

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/** 2D value noise in [0,1], smooth, from a seeded lattice that wraps. */
export function makeNoise2D(seed: number, size = 128): (x: number, y: number) => number {
  const r = rng(seed);
  const lat = Array.from({ length: size * size }, () => r());
  const at = (ix: number, iy: number): number => lat[(((iy % size) + size) % size) * size + (((ix % size) + size) % size)]!;
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = quint(x - ix);
    const fy = quint(y - iy);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(n: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * f + o * 17.3, y * f - o * 9.1);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm; // 0..1
}

// ---------------------------------------------------------------------------
// Where things stand. `[A]`: every number below is a first guess. Phase 14 (cabin) and Phase 17 (camera) may move the two clearings.
// ---------------------------------------------------------------------------

/** The camera of the test view sits at the origin looking toward -z. */
export const STAGE = { x: 0, z: -4.5, radius: 4.5 };
/** The flat patch kept clear for the cabin (Phase 14) and its path. */
export const CABIN_SITE = { x: 7.5, z: -15, radius: 5.5 };
export const CLEARINGS = [STAGE, CABIN_SITE] as const;
/** how far from a clearing's edge the ground takes to become hills */
export const CLEARING_BLEND = 5.5;
/** the ground is a disc round the eye; the nearest mountain layer stands at 36, so the ground ends a metre short of it */
export const TERRAIN_RADIUS = 35;

const driftNoiseA = makeNoise2D(1301);
const driftNoiseB = makeNoise2D(1303);
const rippleNoise = makeNoise2D(1307);

/** 0 inside a clearing (flat, exactly y = 0), 1 well outside. */
export function clearingMask(x: number, z: number): number {
  let m = 1;
  for (const c of CLEARINGS) m = Math.min(m, smoothstep(c.radius, c.radius + CLEARING_BLEND, Math.hypot(x - c.x, z - c.z)));
  return m;
}

/** Ground height at (x, z), in world units; the ground plane of the scene is y = 0. Soft drifts stretched along the wind (+x), a little ripple, and the foothills rising toward the mountains. */
export function terrainHeight(x: number, z: number): number {
  const m = clearingMask(x, z);
  if (m <= 0) return 0;
  const round = fbm(driftNoiseA, x * 0.085, z * 0.085, 3) - 0.5;
  const long = fbm(driftNoiseB, x * 0.045, z * 0.15, 3) - 0.5; // long drifts: wind carries snow along +x
  const ripple = rippleNoise(x * 0.42, z * 0.42) - 0.5;
  const rise = smoothstep(15, TERRAIN_RADIUS, Math.hypot(x, z)) * 1.25;
  return m * (0.55 * round + 0.5 * long + 0.1 * ripple + rise);
}

// ---------------------------------------------------------------------------
// Terrain mesh: a polar grid round the eye, fine near and coarse far
// ---------------------------------------------------------------------------

export const TERRAIN_RINGS = 40;
export const TERRAIN_SECTORS = 120;
const RING_POWER = 1.7;

export interface TerrainMesh {
  position: Float32Array;
  normal: Float32Array;
  index: Uint16Array;
  vertexCount: number;
  triangles: number;
}

export function ringRadius(i: number): number {
  return TERRAIN_RADIUS * Math.pow(i / TERRAIN_RINGS, RING_POWER);
}

/** Phi = 0 points ahead (-z) and grows toward +x (to the right of the camera). */
export function buildTerrain(rings = TERRAIN_RINGS, sectors = TERRAIN_SECTORS): TerrainMesh {
  const vertexCount = 1 + rings * sectors;
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const put = (v: number, x: number, z: number): void => {
    const y = terrainHeight(x, z);
    position[v * 3] = x;
    position[v * 3 + 1] = y;
    position[v * 3 + 2] = z;
    const e = 0.06;
    const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
    const dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    const len = Math.hypot(dx, 1, dz);
    normal[v * 3] = -dx / len;
    normal[v * 3 + 1] = 1 / len;
    normal[v * 3 + 2] = -dz / len;
  };
  put(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = TERRAIN_RADIUS * Math.pow(i / rings, RING_POWER);
    for (let j = 0; j < sectors; j++) {
      const phi = (j / sectors) * Math.PI * 2;
      put(1 + (i - 1) * sectors + j, Math.sin(phi) * r, -Math.cos(phi) * r);
    }
  }
  const idx: number[] = [];
  const v = (i: number, j: number): number => 1 + (i - 1) * sectors + (j % sectors);
  for (let j = 0; j < sectors; j++) idx.push(0, v(1, j + 1), v(1, j)); // centre fan, counter-clockwise seen from above
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j), d = v(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  return { position, normal, index: Uint16Array.from(idx), vertexCount, triangles: idx.length / 3 };
}

// ---------------------------------------------------------------------------
// Snowfall
// ---------------------------------------------------------------------------

/** PB particles are 800 / 2,500 / 6,000 for the WHOLE scene: stars (Phase 12) plus snow plus what later phases add (lanterns, glitter, sparks). Snow stays under about 45 percent. */
export const SNOW_COUNT: Record<Tier, number> = { low: 340, mid: 900, high: 1800 };
export const PARTICLE_BUDGET: Record<Tier, number> = { low: 800, mid: 2500, high: 6000 };
/** The box of air round the camera that the flakes live in (they wrap round its edges). Smaller and sparser on a weak phone. */
export const SNOW_BOX: Record<Tier, { w: number; d: number; h: number }> = {
  low: { w: 30, d: 30, h: 14 },
  mid: { w: 36, d: 36, h: 15 },
  high: { w: 44, d: 44, h: 16 },
};
/** fraction of the flakes kept under reduced motion (AD: fewer particles, same story) */
export const REDUCED_SNOW_SHARE = 0.5;
/** how far ahead of the camera the middle of the box sits */
export const SNOW_BOX_AHEAD = 0.42;

export function snowCount(tier: Tier, reducedMotion: boolean): number {
  return reducedMotion ? Math.ceil(SNOW_COUNT[tier] * REDUCED_SNOW_SHARE) : SNOW_COUNT[tier];
}

export interface Flakes {
  count: number;
  /** position in the box, 0..1 on each axis, 3 floats each */
  base: Float32Array;
  /** metres per second, 0.5 to 1.1: slow and dreamy */
  speed: Float32Array;
  /** size in CSS pixels */
  size: Float32Array;
  /** sway phase (radians) */
  phase: Float32Array;
  /** how strongly the wind carries this flake, 0.7 to 1.3 */
  windK: Float32Array;
}

/** Flakes in random order, so any prefix is evenly scattered (a tier step-down or reduced motion just draws fewer). Deterministic. */
export function makeFlakes(seed = 31, count = SNOW_COUNT.high): Flakes {
  const r = rng(seed);
  const base = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const windK = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    base[i * 3] = r();
    base[i * 3 + 1] = r();
    base[i * 3 + 2] = r();
    speed[i] = 0.5 + r() * 0.6;
    const big = r();
    size[i] = big > 0.96 ? 4.8 + r() * 1.4 : 1.8 + r() * 2.2;
    phase[i] = r() * Math.PI * 2;
    windK[i] = 0.7 + r() * 0.6;
  }
  return { count, base, speed, size, phase, windK };
}

export const WIND = { base: 0.45, gust: 0.3, gustRadPerSec: 0.11, reducedBase: 0.12 };
/** How far the wind has carried the air sideways (+x, metres) at time t. A steady breeze plus a slow gust, integrated so there is no jump. Reduced motion: a small steady drift, no gusts. */
export function windDisplacement(tSec: number, reducedMotion: boolean): number {
  if (!Number.isFinite(tSec)) return 0;
  if (reducedMotion) return WIND.reducedBase * tSec;
  return WIND.base * tSec + (WIND.gust / WIND.gustRadPerSec) * (1 - Math.cos(WIND.gustRadPerSec * tSec));
}
/** fall speed and sway scale: reduced motion falls a little slower and does not sway */
export const REDUCED_FALL_SCALE = 0.6;
export const SWAY_AMPLITUDE = 0.3;

// ---------------------------------------------------------------------------
// Pines
// ---------------------------------------------------------------------------

/** instance counts by tier (PB: instance anything repeated; the pines are ONE instanced draw call, their shadows another) */
export const PINE_COUNT: Record<Tier, number> = { low: 90, mid: 150, high: 220 };
export const PINE_MIN_RADIUS = 9;
export const PINE_MAX_RADIUS = 33;
export const PINE_SPACING = 1.7;
/** tallest a pine may look from the eye (degrees of elevation): the moon (25 degrees, radius 3.4) must never be hidden */
export const PINE_MAX_ELEVATION_DEG = 17;

/** the tallest a pine at distance r may be: near pines are smaller, far ones taller, so the sky and the moon stay open */
export function maxPineHeight(r: number): number {
  return Math.min(0.18 * r + 2.8, 8);
}

export interface Pines {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** world height of the tree, metres */
  height: Float32Array;
  /** width relative to height (1 = the unit tree's own proportions) */
  width: Float32Array;
  rot: Float32Array;
  phase: Float32Array;
}

const clusterNoise = makeNoise2D(1409);

/** Where the pines stand, in random order (any prefix is evenly scattered: low and mid tiers use the first 90 and 150 of the 220). Deterministic. */
export function placePines(count = PINE_COUNT.high, seed = 90210): Pines {
  const r = rng(seed);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const height = new Float32Array(count);
  const width = new Float32Array(count);
  const rot = new Float32Array(count);
  const phase = new Float32Array(count);
  let n = 0;
  for (let tries = 0; n < count && tries < 400000; tries++) {
    const rad = Math.sqrt(PINE_MIN_RADIUS ** 2 + r() * (PINE_MAX_RADIUS ** 2 - PINE_MIN_RADIUS ** 2));
    const phi = r() * Math.PI * 2;
    const px = Math.sin(phi) * rad;
    const pz = -Math.cos(phi) * rad;
    // fewer behind the camera, where she rarely looks
    if (pz > 0 && r() > 0.45) continue;
    // clumps and a denser belt toward the back, so the valley reads as a forest edge and not a polka dot
    const cluster = fbm(clusterNoise, px * 0.11, pz * 0.11, 2);
    const density = (0.12 + 0.88 * Math.pow(cluster, 1.4)) * (0.5 + 0.5 * smoothstep(9, 28, rad));
    if (r() > density * 1.6) continue;
    let blocked = false;
    for (const c of CLEARINGS) if (Math.hypot(px - c.x, pz - c.z) < c.radius + 1.5 + (c === STAGE ? 1 : 0)) blocked = true;
    if (blocked) continue;
    for (let k = 0; k < n && !blocked; k++) if (Math.hypot(px - x[k]!, pz - z[k]!) < PINE_SPACING) blocked = true;
    if (blocked) continue;
    const h = Math.min(3.0 + 3.6 * Math.pow(r(), 0.8), maxPineHeight(rad));
    x[n] = px;
    z[n] = pz;
    y[n] = terrainHeight(px, pz) - 0.05; // the foot sinks a hair into the snow
    height[n] = h;
    width[n] = 0.85 + r() * 0.3;
    rot[n] = r() * Math.PI * 2;
    phase[n] = r() * Math.PI * 2;
    n++;
  }
  return { count: n, x, y, z, height, width, rot, phase };
}

export interface PineGeometry {
  position: Float32Array;
  normal: Float32Array;
  /** 1 at the tip of a tier, 0 at its hem: where snow lies */
  aSnow: Float32Array;
  /** which tier, 0 (lowest) .. 1 (top); the shader uses it to vary the snow edge */
  aTier: Float32Array;
  index: Uint16Array;
  vertexCount: number;
  triangles: number;
}

export const PINE_TIERS = 5;
export const PINE_SEGMENTS = 8;
/** radius of the lowest tier as a share of the tree's height */
export const PINE_BASE_RADIUS = 0.3;

/** One unit pine (height 1, y from 0 to 1): a thin trunk and five stacked cones, each with an underside, so the near ones read from below too. Open cones (no cap on the tip). */
export function buildPineGeometry(): PineGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const snow: number[] = [];
  const tier: number[] = [];
  const idx: number[] = [];
  const S = PINE_SEGMENTS;
  const vert = (p: [number, number, number], n: [number, number, number], s: number, t: number): number => {
    pos.push(...p);
    const l = Math.hypot(...n) || 1;
    nor.push(n[0] / l, n[1] / l, n[2] / l);
    snow.push(s);
    tier.push(t);
    return pos.length / 3 - 1;
  };
  for (let k = 0; k < PINE_TIERS; k++) {
    const baseY = 0.1 + 0.16 * k;
    const h = 0.34 - 0.02 * k;
    const R = PINE_BASE_RADIUS * (1 - 0.17 * k);
    const t = k / (PINE_TIERS - 1);
    const apex: number[] = [];
    const ring: number[] = [];
    for (let j = 0; j < S; j++) {
      const a0 = (j / S) * Math.PI * 2;
      const aMid = ((j + 0.5) / S) * Math.PI * 2;
      apex.push(vert([0, baseY + h, 0], [Math.cos(aMid) * h, R, Math.sin(aMid) * h], 1, t));
      ring.push(vert([Math.cos(a0) * R, baseY, Math.sin(a0) * R], [Math.cos(a0) * h, R, Math.sin(a0) * h], 0, t));
    }
    // side: seen from outside, counter-clockwise (x right, z toward the viewer): apex, next ring vertex, this ring vertex
    for (let j = 0; j < S; j++) idx.push(apex[j]!, ring[(j + 1) % S]!, ring[j]!);
    // underside: darker, faces down
    const centre = vert([0, baseY, 0], [0, -1, 0], 0, t);
    const under: number[] = [];
    for (let j = 0; j < S; j++) {
      const a0 = (j / S) * Math.PI * 2;
      under.push(vert([Math.cos(a0) * R, baseY, Math.sin(a0) * R], [0, -1, 0], 0, t));
    }
    for (let j = 0; j < S; j++) idx.push(centre, under[j]!, under[(j + 1) % S]!);
  }
  // trunk: six sides, open
  const T = 6;
  const trunkR = 0.028;
  const lo: number[] = [];
  const hi: number[] = [];
  for (let j = 0; j < T; j++) {
    const a = (j / T) * Math.PI * 2;
    lo.push(vert([Math.cos(a) * trunkR, 0, Math.sin(a) * trunkR], [Math.cos(a), 0, Math.sin(a)], 0, 0));
    hi.push(vert([Math.cos(a) * trunkR, 0.16, Math.sin(a) * trunkR], [Math.cos(a), 0, Math.sin(a)], 0, 0));
  }
  for (let j = 0; j < T; j++) {
    const a = lo[j]!, b = lo[(j + 1) % T]!, c = hi[j]!, d = hi[(j + 1) % T]!;
    idx.push(a, c, b, b, c, d);
  }
  return {
    position: Float32Array.from(pos),
    normal: Float32Array.from(nor),
    aSnow: Float32Array.from(snow),
    aTier: Float32Array.from(tier),
    index: Uint16Array.from(idx),
    vertexCount: pos.length / 3,
    triangles: idx.length / 3,
  };
}

/** The 4x4 matrix (column-major, as three.js wants it) that stands a unit pine at its place: scale (w, H, w) then turn about y then move. */
export function pineMatrix(p: Pines, i: number, out: Float32Array, offset = 0): void {
  const H = p.height[i]!;
  const W = H * p.width[i]!;
  const c = Math.cos(p.rot[i]!);
  const s = Math.sin(p.rot[i]!);
  out.set([c * W, 0, -s * W, 0, 0, H, 0, 0, s * W, 0, c * W, 0, p.x[i]!, p.y[i]!, p.z[i]!, 1], offset);
}

// ---------------------------------------------------------------------------
// Blob shadows under the pines (PB: no real-time shadows, fake them)
// ---------------------------------------------------------------------------

/** The moon stands ahead and a little left, so shadows fall toward the camera and a hair to the right. */
export function shadowDirection(): [number, number] {
  const m = dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
  const l = Math.hypot(m[0], m[2]);
  return [-m[0] / l, -m[2] / l];
}
export const SHADOW_RINGS = 2;
export const SHADOW_SEGMENTS = 10;
export const SHADOW_VERTS_PER_PINE = 1 + SHADOW_RINGS * SHADOW_SEGMENTS;
export const SHADOW_TRIS_PER_PINE = SHADOW_SEGMENTS + (SHADOW_RINGS - 1) * SHADOW_SEGMENTS * 2;

export interface ShadowGeometry {
  position: Float32Array;
  /** 0 at the middle (darkest), 1 at the edge (gone) */
  aEdge: Float32Array;
  index: Uint16Array;
  vertexCount: number;
  triangles: number;
}

/** One soft ellipse per pine, draped on the ground, one vertex block per pine so a prefix is a smaller forest. */
export function buildShadows(p: Pines): ShadowGeometry {
  const V = SHADOW_VERTS_PER_PINE;
  const position = new Float32Array(p.count * V * 3);
  const aEdge = new Float32Array(p.count * V);
  const idx: number[] = [];
  const [sx, sz] = shadowDirection();
  for (let n = 0; n < p.count; n++) {
    const H = p.height[n]!;
    const along = 0.55 * H; // semi-axis along the shadow
    const across = 0.3 * H * p.width[n]!;
    const cx = p.x[n]! + sx * 0.4 * H;
    const cz = p.z[n]! + sz * 0.4 * H;
    const base = n * V;
    const put = (v: number, ox: number, oz: number, e: number): void => {
      // ox along the shadow direction, oz across it
      const wx = cx + sx * ox - sz * oz;
      const wz = cz + sz * ox + sx * oz;
      position[(base + v) * 3] = wx;
      position[(base + v) * 3 + 1] = terrainHeight(wx, wz) + 0.06;
      position[(base + v) * 3 + 2] = wz;
      aEdge[base + v] = e;
    };
    put(0, 0, 0, 0);
    for (let ring = 1; ring <= SHADOW_RINGS; ring++) {
      for (let j = 0; j < SHADOW_SEGMENTS; j++) {
        const a = (j / SHADOW_SEGMENTS) * Math.PI * 2;
        const f = ring / SHADOW_RINGS;
        put(1 + (ring - 1) * SHADOW_SEGMENTS + j, Math.cos(a) * along * f, Math.sin(a) * across * f, f);
      }
    }
    const vr = (ring: number, j: number): number => base + 1 + (ring - 1) * SHADOW_SEGMENTS + (j % SHADOW_SEGMENTS);
    for (let j = 0; j < SHADOW_SEGMENTS; j++) idx.push(base, vr(1, j + 1), vr(1, j));
    for (let ring = 1; ring < SHADOW_RINGS; ring++) {
      for (let j = 0; j < SHADOW_SEGMENTS; j++) {
        const a = vr(ring, j), b = vr(ring, j + 1), c = vr(ring + 1, j), d = vr(ring + 1, j + 1);
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  return { position, aEdge, index: Uint16Array.from(idx), vertexCount: p.count * V, triangles: idx.length / 3 };
}

// ---------------------------------------------------------------------------
// Tiers, cost, views
// ---------------------------------------------------------------------------

/** how hard the surface glitter works, by tier (one soft dot per cell; the low tier has fewer, quieter ones) */
export const SPARKLE_STRENGTH: Record<Tier, number> = { low: 0.65, mid: 1, high: 1 };
export const FOG = { near: 11, far: 34, terrainMax: 0.96, pineMax: 0.8 };

export interface GroundStats {
  drawCalls: number;
  triangles: number;
  particles: number;
  pines: number;
  flakes: number;
}

/** What the ground adds to the scene at a tier: 4 draw calls (terrain, snow, pines, pine shadows). */
export function groundStats(tier: Tier, reducedMotion: boolean, pineGeo: PineGeometry, terrain: TerrainMesh): GroundStats {
  const pines = PINE_COUNT[tier];
  return {
    drawCalls: 4,
    triangles: terrain.triangles + pines * (pineGeo.triangles + SHADOW_TRIS_PER_PINE),
    particles: snowCount(tier, reducedMotion),
    pines,
    flakes: snowCount(tier, reducedMotion),
  };
}

/** Particles used by the whole scene so far (stars from Phase 12 plus snow), as a share of the PB budget. */
export function particleShare(tier: Tier, reducedMotion: boolean): number {
  const stars = reducedMotion ? Math.ceil(STAR_COUNT[tier] * 0.6) : STAR_COUNT[tier];
  return (stars + snowCount(tier, reducedMotion)) / PARTICLE_BUDGET[tier];
}

/** Elevation (degrees) at which the eye sees the top of a point at ground distance r and height y. */
export function elevationFromEye(r: number, y: number): number {
  return (Math.atan2(y - EYE_HEIGHT, r) * 180) / Math.PI;
}
/** Elevation of the lowest ridge of the nearest mountain layer: ground must stay under it so the hills never cut the mountains in two. */
export function nearestRidgeFloorDeg(): number {
  const near = MOUNTAIN_LAYERS[MOUNTAIN_LAYERS.length - 1]!;
  return near.elevDeg[0];
}
