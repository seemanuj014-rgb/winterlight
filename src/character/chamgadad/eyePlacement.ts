// Phase 7: where each eye patch goes. Pure maths, no three.
// Her drawing is the reference frame (refFrame.ts). The traced file `*.face.json` gives each eye as a square crop of her drawing
// (centred on the eye, in 0..1 of the image); the patch is that square, in the world, lying on the head's front surface.
import { refToWorld, REF_WORLD_SIZE } from '../refFrame';

export interface FaceCrop {
  cx: number;
  cy: number;
  size: number;
  px: number;
}
export interface FaceEyeJson {
  side: 'left' | 'right';
  crop: FaceCrop;
  body_px: number;
  body_centroid: [number, number];
  body_bbox: [number, number, number, number];
  white_px: number;
  tab_px: number;
  brow_px: number;
}
export interface FaceJson {
  source: string;
  eyes: FaceEyeJson[];
  note: string;
}

export interface EyePlacement {
  side: 'left' | 'right';
  /** World centre of the patch (x right, y up). */
  centre: [number, number];
  /** Side of the square patch in world units. */
  size: number;
  /** Where the eye's body is centred, world. Equals `centre` by construction of the trace. */
  bodyCentre: [number, number];
}

export function eyePlacement(e: FaceEyeJson): EyePlacement {
  const centre = refToWorld(e.crop.cx, e.crop.cy);
  const bodyCentre = refToWorld(e.body_centroid[0], e.body_centroid[1]);
  return { side: e.side, centre, size: e.crop.size * REF_WORLD_SIZE, bodyCentre };
}

/** uv (0..1, v up, texture row 0 at the top) of a world point inside a patch. */
export function patchUv(p: EyePlacement, x: number, y: number): [number, number] {
  return [(x - (p.centre[0] - p.size / 2)) / p.size, (y - (p.centre[1] - p.size / 2)) / p.size];
}

export interface PatchGrid {
  /** xy only; the caller fills z from the head surface. Row-major, `n + 1` by `n + 1` vertices. */
  xy: Float32Array;
  uv: Float32Array;
  indices: Uint16Array;
  n: number;
}

export function patchGrid(p: EyePlacement, n = 24): PatchGrid {
  const xy = new Float32Array((n + 1) * (n + 1) * 2);
  const uv = new Float32Array((n + 1) * (n + 1) * 2);
  const indices = new Uint16Array(n * n * 6);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const u = i / n, v = j / n;
      xy[k] = p.centre[0] + (u - 0.5) * p.size;
      xy[k + 1] = p.centre[1] + (v - 0.5) * p.size;
      uv[k] = u;
      uv[k + 1] = v;
      k += 2;
    }
  }
  let t = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + (n + 1), d = c + 1;
      indices.set([a, b, d, a, d, c], t);
      t += 6;
    }
  }
  return { xy, uv, indices, n };
}
