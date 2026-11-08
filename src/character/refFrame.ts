// Phase 6: the reference frame. Pure maths, no three, so it can be unit-tested.
// Her drawing is the image plane: u, v in 0..1 with v pointing DOWN (the convention of every file in character/traced/).
// World: the plane is a square REF_WORLD_SIZE wide centred on the origin, x right, y UP, z toward the viewer.
// main.ts already drew the Phase 0 silhouette at this scale (4 units), so Phase 6 sits where the flat shape sat.

export const REF_WORLD_SIZE = 4;
/** Distance of the reference camera from the image plane. Orthographic, so it changes nothing but clipping. */
export const REF_CAMERA_Z = 20;

export type Pt = readonly [number, number];

export function refToWorld(u: number, v: number): [number, number] {
  return [(u - 0.5) * REF_WORLD_SIZE, (0.5 - v) * REF_WORLD_SIZE];
}

export function worldToRef(x: number, y: number): [number, number] {
  return [x / REF_WORLD_SIZE + 0.5, 0.5 - y / REF_WORLD_SIZE];
}

export interface OrthoBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Orthographic frustum that shows the whole drawing ("contain"): a viewport that is square shows exactly
 * the drawing's square, so a screenshot taken from a square canvas maps 1:1 onto the reference image.
 * A wider or taller viewport shows more empty space at the sides and never crops the drawing.
 */
export function refOrthoBounds(aspect: number): OrthoBounds {
  const h = REF_WORLD_SIZE / 2;
  if (!(aspect > 0)) throw new Error('refOrthoBounds: aspect must be positive');
  return aspect >= 1 ? { left: -h * aspect, right: h * aspect, top: h, bottom: -h } : { left: -h, right: h, top: h / aspect, bottom: -h / aspect };
}
