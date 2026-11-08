// Phase 6: inflation. Turns a flat outline into a plush closed volume whose FRONT silhouette is exactly that outline.
// Pure maths, no three, so it is unit-tested in Node. Every Float32Array here goes straight into a three BufferGeometry.
//
// Method (CHARACTER_BIBLE "Head-volume method"): a distance-to-edge height field, smoothed, with a fitted back.
//   * Each part is star-shaped about one centre, so it can be built as rings: ring j is the outline scaled toward the centre
//     by cos(phi_j), phi_j running 0..90 degrees. The rim (ring 0) is the outline itself, so the silhouette cannot drift,
//     and rings cannot fold over because every ring is a scaled copy of a star-shaped polygon.
//   * Depth comes from the distance-to-edge field, read once per ray: along ray i the largest distance to the outline is the local
//     inscribed radius D_i; the front is T_i = thickness * D_i deep there, and T_i is smoothed around the outline. Across the rim the
//     profile is a quarter circle, z = T_i * sin(phi) (vertical at the rim, flat on top), so side and three-quarter views stay round.
//     (Reading the exact distance at every vertex instead was tried first and failed the spike test: where a ray meets the outline
//     obliquely, as at the chin notch, a tiny step changes the distance a lot and the square-root profile turns that into spikes.)
//     Near the centre T_i fades to the mean, so the centre vertex has no spikes either.
//   * The inner rings are smoothed (rings 0 and 1 are not, so the rim keeps its tangent) to remove ridges along the medial axis.
//   * The back is the front mirrored and scaled by backScale. It is inferred [A]: her drawing shows no back.
// Space of these functions: any 2D units (the callers use world units); z is toward the viewer.

export type Pt = readonly [number, number];

export function signedArea(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]!;
    const [x2, y2] = p[(i + 1) % p.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Counter-clockwise (positive area, y up) copy. */
export function ensureCCW(p: readonly Pt[]): Pt[] {
  const q = p.map((v) => [v[0], v[1]] as Pt);
  return signedArea(q) < 0 ? q.reverse() : q;
}

export function perimeter(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

/** n points spaced evenly by arc length along the closed polyline (the first input vertex is kept). */
export function resampleClosed(p: readonly Pt[], n: number): Pt[] {
  if (p.length < 3 || n < 3) throw new Error('resampleClosed: need at least 3 points');
  const total = perimeter(p);
  if (!(total > 0)) throw new Error('resampleClosed: zero-length outline');
  const step = total / n;
  const out: Pt[] = [];
  let edge = 0;
  let edgeStart = 0; // arc length at the start of the current edge
  for (let k = 0; k < n; k++) {
    const target = k * step;
    for (;;) {
      const a = p[edge % p.length]!;
      const b = p[(edge + 1) % p.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (target <= edgeStart + len + 1e-12 || edge >= p.length * 2) {
        const t = len > 0 ? Math.min(1, Math.max(0, (target - edgeStart) / len)) : 0;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        break;
      }
      edgeStart += len;
      edge++;
    }
  }
  return out;
}

/** Moves every vertex of a CCW outline inward by d along its (mitred) normal. For d small against the features of the shape. */
export function insetClosed(p: readonly Pt[], d: number): Pt[] {
  const n = p.length;
  return p.map((v, i) => {
    const a = p[(i + n - 1) % n]!, b = p[(i + 1) % n]!;
    const e1x = v[0] - a[0], e1y = v[1] - a[1], e2x = b[0] - v[0], e2y = b[1] - v[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    // inward (left, for CCW) normals of the two edges, averaged and mitred (the mitre is capped so a sharp corner cannot shoot out)
    const n1x = -e1y / l1, n1y = e1x / l1, n2x = -e2y / l2, n2y = e2x / l2;
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const cos = Math.max(0.5, mx * n1x + my * n1y);
    return [v[0] + (mx * d) / cos, v[1] + (my * d) / cos] as Pt;
  });
}

/** Taubin (lambda, mu) smoothing of a closed outline: removes pixel jitter without shrinking it. */
export function smoothClosed(p: readonly Pt[], iterations: number, lambda = 0.5, mu = -0.53): Pt[] {
  let cur = p.map((v) => [v[0], v[1]] as [number, number]);
  const n = cur.length;
  for (let it = 0; it < iterations; it++) {
    for (const f of [lambda, mu]) {
      const next = cur.map((v, i) => {
        const a = cur[(i + n - 1) % n]!;
        const b = cur[(i + 1) % n]!;
        return [v[0] + f * ((a[0] + b[0]) / 2 - v[0]), v[1] + f * ((a[1] + b[1]) / 2 - v[1])] as [number, number];
      });
      cur = next;
    }
  }
  return cur;
}

export function pointInPolygon(x: number, y: number, p: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Exact distance from a point to the outline (not signed). */
export function distanceToPolygon(x: number, y: number, p: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i]!;
    const [bx, by] = p[(i + 1) % p.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/** True if every point of the outline is visible from c in order: the polar angle around c only ever increases (CCW outline). */
export function isStarShaped(p: readonly Pt[], c: Pt): boolean {
  let total = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const ax = a[0] - c[0], ay = a[1] - c[1], bx = b[0] - c[0], by = b[1] - c[1];
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    const d = Math.atan2(cross, dot);
    if (d <= 1e-9) return false;
    total += d;
  }
  return Math.abs(total - 2 * Math.PI) < 1e-6;
}

/** The star centre with the largest clearance to the outline, searched on a grid. Throws if the outline is not star-shaped from anywhere. */
export function findCentre(p: readonly Pt[], grid = 48): { centre: Pt; distance: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  let best: { centre: Pt; distance: number } | null = null;
  for (let gy = 0; gy <= grid; gy++) {
    for (let gx = 0; gx <= grid; gx++) {
      const x = minX + ((maxX - minX) * gx) / grid;
      const y = minY + ((maxY - minY) * gy) / grid;
      if (!pointInPolygon(x, y, p)) continue;
      const d = distanceToPolygon(x, y, p);
      if (best && d <= best.distance) continue;
      if (isStarShaped(p, [x, y])) best = { centre: [x, y], distance: d };
    }
  }
  if (!best) throw new Error('findCentre: the outline is not star-shaped from any grid point; split it into simpler parts');
  return best;
}

export interface InflateOptions {
  /** Vertices around the rim. */
  samples: number;
  /** Rings between rim and centre (the centre is one more vertex). */
  rings: number;
  /** Depth of the front, as a multiple of the local inscribed radius. 1 = as deep as it is round. */
  thickness: number;
  /** How much of the way in the rounded edge reaches full depth (1 = a full dome, smaller = a flatter top). */
  rim: number;
  /** Back depth relative to the front (1 = symmetric, 0 = flat back). [A]: the back is inferred. */
  backScale: number;
  /** [1 2 1] passes around the outline on the local depth D_i (stops depth jumping between neighbouring rays). */
  depthSmooth: number;
  /** Taubin passes on the outline before building (removes pixel jitter). */
  outlineSmooth: number;
  /** Laplacian passes on the interior heights. */
  heightSmooth: number;
  /** Moves the whole outline inward by this much before building. The ink-line hull is drawn OUTWARD from the mesh edge, so a mesh
   *  whose rim is her ink's outer edge would come out one ink-width too big; the caller insets by her ink thickness instead. */
  rimInset: number;
  /** Added to every z (layering parts in front of or behind each other). */
  zOffset: number;
}

export const INFLATE_DEFAULTS: InflateOptions = {
  samples: 128,
  rings: 14,
  thickness: 1,
  rim: 1,
  backScale: 0.85,
  depthSmooth: 8,
  outlineSmooth: 3,
  heightSmooth: 6,
  rimInset: 0,
  zOffset: 0,
};

export interface InflatedMesh {
  /** xyz, rim vertices first. */
  positions: Float32Array;
  indices: Uint32Array;
  /** The rim outline actually used (CCW), after resampling and smoothing: the silhouette seen from the front. */
  rim: Pt[];
  centre: Pt;
  /** Largest inscribed radius of the outline. */
  maxDistance: number;
  /** Highest z of the front surface (zOffset + the front thickness). */
  frontZMax: number;
  /** Lowest z of the back surface. */
  backZMin: number;
  /** First index of the back vertices; the front surface is every vertex before it (shared rim included). */
  backStart: number;
}

const RAY_SAMPLES = 24;

export function inflate(outline: readonly Pt[], options: Partial<InflateOptions> = {}): InflatedMesh {
  const o = { ...INFLATE_DEFAULTS, ...options };
  if (o.rings < 3) throw new Error('inflate: need at least 3 rings');
  const ccw = ensureCCW(outline);
  let rim = smoothClosed(resampleClosed(ccw, o.samples), o.outlineSmooth);
  if (o.rimInset > 0) rim = smoothClosed(insetClosed(rim, o.rimInset), 1);
  const { centre, distance: maxDistance } = findCentre(rim);
  const N = rim.length;
  const K = o.rings; // rings 0..K-1, then the centre
  // Ring positions first; heights need the local depth per ray.
  const xy = new Float32Array((K * N + 1) * 2);
  const z = new Float64Array(K * N + 1);
  const tRing: number[] = [];
  for (let j = 0; j < K; j++) {
    const t = Math.cos((Math.PI / 2) * (j / K));
    tRing.push(t);
    for (let i = 0; i < N; i++) {
      xy[(j * N + i) * 2] = centre[0] + t * (rim[i]![0] - centre[0]);
      xy[(j * N + i) * 2 + 1] = centre[1] + t * (rim[i]![1] - centre[1]);
    }
  }
  xy[K * N * 2] = centre[0];
  xy[K * N * 2 + 1] = centre[1];

  // D_i: the largest distance to the outline along ray i (the local inscribed radius), smoothed around the outline.
  let D = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let best = 0;
    for (let s = 1; s <= RAY_SAMPLES; s++) {
      const t = 1 - s / RAY_SAMPLES; // from the rim to the centre, the centre included
      best = Math.max(best, distanceToPolygon(centre[0] + t * (rim[i]![0] - centre[0]), centre[1] + t * (rim[i]![1] - centre[1]), rim));
    }
    D[i] = best;
  }
  for (let it = 0; it < o.depthSmooth; it++) {
    const next = new Float64Array(N);
    for (let i = 0; i < N; i++) next[i] = (D[(i + N - 1) % N]! + 2 * D[i]! + D[(i + 1) % N]!) / 4;
    D = next;
  }
  let Dmean = 0;
  for (let i = 0; i < N; i++) Dmean += D[i]!;
  Dmean /= N;

  const phiRim = Math.max(o.rim, 1e-6) * (Math.PI / 2);
  for (let j = 1; j < K; j++) {
    const phi = (Math.PI / 2) * (j / K);
    const shape = Math.sin(Math.min(phi / phiRim, 1) * (Math.PI / 2));
    for (let i = 0; i < N; i++) {
      const depth = o.thickness * (Dmean + (D[i]! - Dmean) * tRing[j]!);
      z[j * N + i] = depth * shape;
    }
  }
  z[K * N] = o.thickness * Dmean;

  // Smooth the interior (rings 2..K-1 and the centre).
  for (let it = 0; it < o.heightSmooth; it++) {
    const next = Float64Array.from(z);
    for (let j = 2; j < K; j++) {
      for (let i = 0; i < N; i++) {
        const a = z[j * N + ((i + N - 1) % N)]!;
        const b = z[j * N + ((i + 1) % N)]!;
        const up = z[(j - 1) * N + i]!;
        const down = j + 1 < K ? z[(j + 1) * N + i]! : z[K * N]!;
        next[j * N + i] = z[j * N + i]! + 0.5 * ((a + b + up + down) / 4 - z[j * N + i]!);
      }
    }
    let ring = 0;
    for (let i = 0; i < N; i++) ring += z[(K - 1) * N + i]!;
    next[K * N] = z[K * N]! + 0.5 * (ring / N - z[K * N]!);
    z.set(next);
  }

  // Vertices: front (rim, rings 1..K-1, centre), then back (rings 1..K-1, centre). Rim is shared.
  const frontCount = K * N + 1;
  const backCount = (K - 1) * N + 1;
  const positions = new Float32Array((frontCount + backCount) * 3);
  let frontZMax = -Infinity;
  let backZMin = Infinity;
  for (let v = 0; v < frontCount; v++) {
    positions[v * 3] = xy[v * 2]!;
    positions[v * 3 + 1] = xy[v * 2 + 1]!;
    positions[v * 3 + 2] = o.zOffset + z[v]!;
    frontZMax = Math.max(frontZMax, o.zOffset + z[v]!);
  }
  // back vertex for front vertex v (v >= N): index frontCount + (v - N); the centre maps to the last one.
  for (let v = N; v < frontCount; v++) {
    const b = frontCount + (v - N);
    positions[b * 3] = xy[v * 2]!;
    positions[b * 3 + 1] = xy[v * 2 + 1]!;
    positions[b * 3 + 2] = o.zOffset - o.backScale * z[v]!;
    backZMin = Math.min(backZMin, o.zOffset - o.backScale * z[v]!);
  }
  const backOf = (v: number): number => (v < N ? v : frontCount + (v - N));

  const idx: number[] = [];
  const front = (j: number, i: number): number => j * N + (i % N);
  for (let j = 0; j < K - 1; j++) {
    for (let i = 0; i < N; i++) {
      const a = front(j, i), b = front(j, i + 1), c = front(j + 1, i + 1), d = front(j + 1, i);
      idx.push(a, b, c, a, c, d);
    }
  }
  const centreV = K * N;
  for (let i = 0; i < N; i++) idx.push(front(K - 1, i), front(K - 1, i + 1), centreV);
  // back: the same triangles with reversed winding on the mirrored vertices
  const frontTris = idx.length;
  for (let t = 0; t < frontTris; t += 3) idx.push(backOf(idx[t]!), backOf(idx[t + 2]!), backOf(idx[t + 1]!));

  return {
    positions,
    indices: Uint32Array.from(idx),
    rim,
    centre,
    maxDistance,
    frontZMax,
    backZMin: Number.isFinite(backZMin) ? backZMin : o.zOffset,
    backStart: frontCount,
  };
}

/** Area-weighted vertex normals (what three's computeVertexNormals does), for tools and tests that have no three. */
export function computeNormals(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    const ux = positions[b * 3]! - positions[a * 3]!, uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!, uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!, vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!, vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v * 3] += nx;
      n[v * 3 + 1] += ny;
      n[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v]!, n[v + 1]!, n[v + 2]!) || 1;
    n[v] /= l;
    n[v + 1] /= l;
    n[v + 2] /= l;
  }
  return n;
}
