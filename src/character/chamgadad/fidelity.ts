// Phase 5: the numeric fidelity target and the pure maths to measure it. No three, no DOM.
// Mirrors character/fidelity.json (tests/character.test.ts keeps the two in step).

export interface Region {
  yMin: number;
  yMax: number;
  iouMin: number;
}

export const FIDELITY_REGIONS = {
  headAndEars: { yMin: 0, yMax: 0.72, iouMin: 0.97 },
  neckAndChest: { yMin: 0.72, yMax: 0.995, iouMin: 0.95 },
} as const satisfies Record<string, Region>;

/** Allowed distance between a 3D eye centre and the drawn one, as a fraction of the image. [A] */
export const EYE_CENTRE_TOLERANCE = 0.01;

/** Even-odd scanline fill of a polygon given in normalised 0..1 coordinates (y down) into a size x size mask. */
export function rasterizePolygon(points: readonly (readonly [number, number])[], size = 256): Uint8Array {
  const mask = new Uint8Array(size * size);
  const n = points.length;
  if (n < 3) return mask;
  for (let row = 0; row < size; row++) {
    const y = (row + 0.5) / size;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = points[i]!;
      const [x2, y2] = points[(i + 1) % n]!;
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! * size - 0.5));
      const to = Math.min(size - 1, Math.floor(xs[k + 1]! * size - 0.5));
      for (let col = from; col <= to; col++) mask[row * size + col] = 1;
    }
  }
  return mask;
}

/** Intersection over union of two equal-size square masks, optionally only for rows whose centre lies in [yMin, yMax). */
export function maskIoU(a: Uint8Array, b: Uint8Array, size: number, region?: { yMin: number; yMax: number }): number {
  if (a.length !== size * size || b.length !== size * size) throw new Error('mask size mismatch');
  const r0 = region ? Math.max(0, Math.ceil(region.yMin * size - 0.5)) : 0;
  const r1 = region ? Math.min(size, Math.ceil(region.yMax * size - 0.5)) : size;
  let inter = 0;
  let uni = 0;
  for (let i = r0 * size; i < r1 * size; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni === 0 ? 1 : inter / uni;
}
