// Phase 6: look at a mesh from the reference camera without a GPU. Pure maths, no three.
// Used by the tests and by tools/ to score the front silhouette of the built head against the traced drawing,
// and to find which part is in front where two parts overlap. It is a plain software rasteriser: the same
// orthographic projection the reference camera uses (refFrame.ts), not a stand-in for the WebGL render.
import { worldToRef } from '../refFrame';

/**
 * Front-most z per pixel of a size x size image that covers the reference plane (u, v in 0..1, v down).
 * Empty pixels are -Infinity. The viewer is at +z, so "front-most" is the largest z.
 */
export function rasterizeDepth(positions: ArrayLike<number>, indices: ArrayLike<number>, size: number, into?: Float32Array): Float32Array {
  const depth = into ?? new Float32Array(size * size).fill(-Infinity);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    const [ua, va] = worldToRef(positions[a * 3]!, positions[a * 3 + 1]!);
    const [ub, vb] = worldToRef(positions[b * 3]!, positions[b * 3 + 1]!);
    const [uc, vc] = worldToRef(positions[c * 3]!, positions[c * 3 + 1]!);
    const ax = ua * size, ay = va * size, bx = ub * size, by = vb * size, cx = uc * size, cy = vc * size;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
    const za = positions[a * 3 + 2]!, zb = positions[b * 3 + 2]!, zc = positions[c * 3 + 2]!;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
        const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const z = w0 * za + w1 * zb + w2 * zc;
        if (z > depth[y * size + x]!) depth[y * size + x] = z;
      }
    }
  }
  return depth;
}

/** 1 where anything is drawn. */
export function depthToMask(depth: Float32Array): Uint8Array {
  const m = new Uint8Array(depth.length);
  for (let i = 0; i < depth.length; i++) m[i] = depth[i]! > -Infinity ? 1 : 0;
  return m;
}

/** Union of several masks of the same size. */
export function unionMasks(masks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(masks[0]!.length);
  for (const m of masks) for (let i = 0; i < m.length; i++) if (m[i]) out[i] = 1;
  return out;
}

/** Grows a mask by a radius in pixels (a disc). Used to add the ink line, which the hull draws outward from the mesh edge, to a surface-only mask. */
export function dilateMask(mask: Uint8Array, size: number, radiusPx: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  const r = Math.ceil(radiusPx);
  const offsets: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= radiusPx * radiusPx + 0.25) offsets.push([dx, dy]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue;
      for (const [dx, dy] of offsets) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) out[yy * size + xx] = 1;
      }
    }
  }
  return out;
}
