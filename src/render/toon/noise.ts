// Baked tileable noise for the ink line (no three import: pure, deterministic, unit-tested).
// Channels: R = slow width variation, G and B = line wobble (x, y), A = 255.

export function mulberry32(seed: number): () => number {
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

/** Value noise on a cells x cells lattice that wraps, sampled at size x size. Values in 0..1. */
function tileable(size: number, cells: number, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * cells;
    const y0 = Math.floor(v) % cells;
    const y1 = (y0 + 1) % cells;
    const fy = smooth(v - Math.floor(v));
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells;
      const x0 = Math.floor(u) % cells;
      const x1 = (x0 + 1) % cells;
      const fx = smooth(u - Math.floor(u));
      const a = lat[y0 * cells + x0]! + (lat[y0 * cells + x1]! - lat[y0 * cells + x0]!) * fx;
      const b = lat[y1 * cells + x0]! + (lat[y1 * cells + x1]! - lat[y1 * cells + x0]!) * fx;
      out[y * size + x] = a + (b - a) * fy;
    }
  }
  return out;
}

/** Value noise bunches around 0.5; stretch it so the line visibly varies. */
const stretch = (v: number): number => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * 1.9));

export function makeNoiseTexels(size = 128, seed = 20261110): Uint8Array {
  const w1 = tileable(size, 2, seed), w2 = tileable(size, 4, seed + 11);
  const x1 = tileable(size, 5, seed + 23), x2 = tileable(size, 9, seed + 37);
  const y1 = tileable(size, 5, seed + 51), y2 = tileable(size, 9, seed + 67);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = Math.round(255 * stretch(0.65 * w1[i]! + 0.35 * w2[i]!));
    out[i * 4 + 1] = Math.round(255 * stretch(0.6 * x1[i]! + 0.4 * x2[i]!));
    out[i * 4 + 2] = Math.round(255 * stretch(0.6 * y1[i]! + 0.4 * y2[i]!));
    out[i * 4 + 3] = 255;
  }
  return out;
}
