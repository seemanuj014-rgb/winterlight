// Phase 6: the head, two ears (each a back flap plus an inner bowl) and the neck, as world-space meshes.
// Pure (no three): it reads character/traced/<name>.parts.json (made by tools/split_parts.py from her drawing) and returns arrays.
// head.ts and ears.ts wrap these in three geometries and give them their toon look.
//
// What is measured and what is [A] (inferred, to be approved by the owner):
//   measured  every front outline here is her ink (see split_parts.py); the front view of the union is her silhouette
//   [A]       depths: how deep the head is, how thin the ears are, the back of everything, the layering order
//   [A]       the neck's top and the ears' roots sit inside the head, hidden; nothing about them is drawn
import { refToWorld, REF_WORLD_SIZE, type Pt } from '../refFrame';
import { inflate, pointInPolygon, type InflateOptions, type InflatedMesh } from './inflate';

/** Her ink is 10.8 px thick (median along the contour of the 1080 px drawing, measured in Phase 3). Same weight on every part. */
export const INK_PX = 10.8;
export const INK_WORLD = (INK_PX / 1080) * REF_WORLD_SIZE;

export interface EarJson {
  points: number[][];
  bowl: number[][];
  fold: number[][];
  base: number[][];
  pivot: number[];
  patch: { cx: number; cy: number; rx: number; ry: number; angle_rad: number } | null;
}
export interface PartsJson {
  head: { points: number[][] };
  neck: { points: number[][] };
  ear_upright: EarJson;
  ear_angled: EarJson;
}

export interface WorldEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Counter-clockwise from +x, in the world (y up) frame. */
  angle: number;
}

export interface BuiltEar {
  /** The whole ear, seen from behind where it folds over: the teal-grey back. Sits behind. */
  flap: InflatedMesh;
  /** The inner face inside the fold stroke: pale blue. Sits in front of the flap; its rim is her fold line. */
  bowl: InflatedMesh;
  /** Where the ear attaches (middle of the base, world x, y, z). Phase 8 rotates the ear about this. */
  pivot: [number, number, number];
  /** The lavender patch near the base, on the bowl. */
  patch: WorldEllipse | null;
  /** The fold stroke as a world-space polyline (for Phase 8's fold flex and for checking). */
  fold: Pt[];
}

export interface BuiltHead {
  head: InflatedMesh;
  neck: InflatedMesh;
  earUpright: BuiltEar;
  earAngled: BuiltEar;
}

export interface Layout {
  head: Partial<InflateOptions>;
  neck: Partial<InflateOptions>;
  flap: Partial<InflateOptions>;
  bowl: Partial<InflateOptions>;
  /** Clearance kept between a part and whatever it must stay behind. */
  gap: number;
}

/**
 * Triangle cost: about 10k for the whole head, 20k with the ink hulls (PERF_BUDGET: scene <= 80k on low).
 * [A] first guesses for depth; Phase 11 tunes them against how the 3D head reads next to her drawing. */
export const LAYOUT_DEFAULTS: Layout = {
  head: { rimInset: INK_WORLD, samples: 112, rings: 14, thickness: 0.9, rim: 1, backScale: 0.85, outlineSmooth: 2, heightSmooth: 6 },
  neck: { rimInset: INK_WORLD, samples: 64, rings: 8, thickness: 0.8, rim: 0.9, backScale: 0.2, outlineSmooth: 2, heightSmooth: 6 },
  flap: { rimInset: INK_WORLD, samples: 56, rings: 8, thickness: 0.3, rim: 1, backScale: 2.6, outlineSmooth: 2, heightSmooth: 4 },
  bowl: { rimInset: INK_WORLD, samples: 48, rings: 7, thickness: 0.3, rim: 1, backScale: 0.3, outlineSmooth: 2, heightSmooth: 4 },
  gap: 0.045,
};

const toWorld = (pts: readonly number[][]): Pt[] => pts.map(([u, v]) => refToWorld(u!, v!) as Pt);

export function shiftZ(m: InflatedMesh, dz: number): InflatedMesh {
  const positions = Float32Array.from(m.positions);
  for (let i = 2; i < positions.length; i += 3) positions[i] = positions[i]! + dz;
  return { ...m, positions, frontZMax: m.frontZMax + dz, backZMin: m.backZMin + dz };
}

/** z of the front surface at world (x, y), or null if the front surface does not cover that point. */
export function sampleFrontZ(m: InflatedMesh, x: number, y: number): number | null {
  const p = m.positions;
  const tris = m.indices.length / 2; // the first half of the indices is the front surface
  let best: number | null = null;
  for (let t = 0; t < tris; t += 3) {
    const a = m.indices[t]!, b = m.indices[t + 1]!, c = m.indices[t + 2]!;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, bx = p[b * 3]!, by = p[b * 3 + 1]!, cx = p[c * 3]!, cy = p[c * 3 + 1]!;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-14) continue;
    const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
    const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
    const z = w0 * p[a * 3 + 2]! + w1 * p[b * 3 + 2]! + w2 * p[c * 3 + 2]!;
    if (best === null || z > best) best = z;
  }
  return best;
}

/**
 * How far `front` (already built at z offset 0 relative to what it must cover) has to move in z so that, everywhere the two overlap
 * in the front view, `front`'s surface is at least `gap` in front of every one of `behind`'s vertices.
 */
export function zNeededInFront(front: InflatedMesh, behind: readonly InflatedMesh[], gap: number, onlyFront = true): number {
  let need = -Infinity;
  const test = (x: number, y: number, z: number): void => {
    if (!pointInPolygon(x, y, front.rim)) return;
    const fz = sampleFrontZ(front, x, y);
    if (fz !== null) need = Math.max(need, z - fz + gap);
  };
  for (const m of behind) {
    const p = m.positions;
    const count = onlyFront ? m.backStart : p.length / 3;
    for (let v = 0; v < count; v++) test(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
    // The surface between vertices can stick out too (it did: 121 pixels of neck through the chin rim), so sample every
    // front triangle's middle and the middle of each of its edges as well.
    const tris = onlyFront ? m.indices.length / 2 : m.indices.length;
    for (let t = 0; t < tris; t += 3) {
      const a = m.indices[t]!, b = m.indices[t + 1]!, c = m.indices[t + 2]!;
      const at = (i: number, k: number): number => p[i * 3 + k]!;
      test((at(a, 0) + at(b, 0) + at(c, 0)) / 3, (at(a, 1) + at(b, 1) + at(c, 1)) / 3, (at(a, 2) + at(b, 2) + at(c, 2)) / 3);
      for (const [i, j] of [[a, b], [b, c], [c, a]] as const) test((at(i!, 0) + at(j!, 0)) / 2, (at(i!, 1) + at(j!, 1)) / 2, (at(i!, 2) + at(j!, 2)) / 2);
    }
  }
  return need === -Infinity ? 0 : need;
}

function buildEar(e: EarJson, layout: Layout): BuiltEar {
  const flap = inflate(toWorld(e.points), { ...layout.flap, zOffset: 0 });
  // The bowl is built at z 0, then lifted just enough to clear the flap everywhere the two overlap.
  const bowl0 = inflate(toWorld(e.bowl), { ...layout.bowl, zOffset: 0 });
  const bowl = shiftZ(bowl0, zNeededInFront(bowl0, [flap], layout.gap));
  const pivotXY = refToWorld(e.pivot[0]!, e.pivot[1]!);
  const p = e.patch;
  const patch: WorldEllipse | null = p
    ? { cx: refToWorld(p.cx, p.cy)[0], cy: refToWorld(p.cx, p.cy)[1], rx: p.rx * REF_WORLD_SIZE, ry: p.ry * REF_WORLD_SIZE, angle: -p.angle_rad }
    : null;
  return { flap, bowl, pivot: [pivotXY[0], pivotXY[1], (flap.frontZMax + flap.backZMin) / 2], patch, fold: toWorld(e.fold) };
}

export function buildHeadParts(json: PartsJson, layout: Partial<Layout> = {}): BuiltHead {
  const L: Layout = { ...LAYOUT_DEFAULTS, ...layout };
  const neck = inflate(toWorld(json.neck.points), { ...L.neck, zOffset: 0 });
  const earUpright = buildEar(json.ear_upright, L);
  const earAngled = buildEar(json.ear_angled, L);
  // The head sits in front of the neck and both ears (ears and neck root hide inside it).
  const head0 = inflate(toWorld(json.head.points), { ...L.head, zOffset: 0 });
  const behind = [neck, earUpright.flap, earUpright.bowl, earAngled.flap, earAngled.bowl];
  const head = shiftZ(head0, zNeededInFront(head0, behind, L.gap));
  return { head, neck, earUpright, earAngled };
}

/** Bounding-sphere radius the way three's geometry.computeBoundingSphere does it (centre of the box, farthest vertex). */
export function boundingRadius(positions: ArrayLike<number>): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!); maxX = Math.max(maxX, positions[i]!);
    minY = Math.min(minY, positions[i + 1]!); maxY = Math.max(maxY, positions[i + 1]!);
    minZ = Math.min(minZ, positions[i + 2]!); maxZ = Math.max(maxZ, positions[i + 2]!);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  let r = 0;
  for (let i = 0; i < positions.length; i += 3) r = Math.max(r, Math.hypot(positions[i]! - cx, positions[i + 1]! - cy, positions[i + 2]! - cz));
  return r;
}

/** widthFrac to give makeToon for a part, so its ink line is INK_WORLD thick (the outline scales with the part's own radius). */
export function outlineWidthFrac(part: InflatedMesh): number {
  return INK_WORLD / boundingRadius(part.positions);
}

/** 1 at the middle of the lavender patch, soft to 0 outside it. The fitted radii mark where the drawn patch is half way faded. */
export function patchWeight(x: number, y: number, p: WorldEllipse): number {
  const dx = x - p.cx, dy = y - p.cy;
  const c = Math.cos(-p.angle), s = Math.sin(-p.angle);
  const q = Math.hypot((dx * c - dy * s) / p.rx, (dx * s + dy * c) / p.ry);
  const t = Math.min(1, Math.max(0, (q - 0.7) / 0.6));
  return 1 - t * t * (3 - 2 * t);
}
