// Phase 16: shape helpers for the cat and the snow bunny. Everything is made from a few soft primitives (ellipsoids, tapered capsules, flattened lathes),
// merged into ONE geometry per moving part with the colour in the vertices, so a whole animal is a handful of draw calls (PB).
// Units are metres, the animal faces +z, stands on y = 0. No textures, no files.
import * as THREE from 'three';

export type V3 = [number, number, number];
export interface Piece {
  geo: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
}

/** A soft ellipsoid: centre, radii, optional turn (radians, about x then y then z). */
export function ellipsoid(c: V3, r: V3, color: THREE.ColorRepresentation, o: { seg?: [number, number]; rot?: V3 } = {}): Piece {
  const [w, h] = o.seg ?? [12, 8];
  const geo = new THREE.SphereGeometry(1, w, h);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot ?? [0, 0, 0]), 'YXZ'));
  m.compose(new THREE.Vector3(...c), q, new THREE.Vector3(...r));
  geo.applyMatrix4(m);
  return { geo, color };
}

/** A rounded, tapered limb from a to b (radius r0 at a, r1 at b), capped with half spheres. */
export function limb(a: V3, b: V3, r0: number, r1: number, color: THREE.ColorRepresentation, seg = 8): Piece {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const profile: THREE.Vector2[] = [];
  const cap = 3;
  // start cap (pointing -y), body, end cap (pointing +y): x = radius, y = height along the limb
  for (let i = 0; i <= cap; i++) {
    const t = (i / cap) * (Math.PI / 2);
    profile.push(new THREE.Vector2(Math.sin(t) * r0, -Math.cos(t) * r0));
  }
  for (let i = 1; i <= cap; i++) {
    const t = (i / cap) * (Math.PI / 2);
    profile.push(new THREE.Vector2(Math.cos(t) * r1, len + Math.sin(t) * r1));
  }
  profile[0]!.x = 0;
  profile[profile.length - 1]!.x = 0;
  const geo = new THREE.LatheGeometry(profile, seg);
  const dir = vb.clone().sub(va).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geo.applyMatrix4(new THREE.Matrix4().compose(va, q, new THREE.Vector3(1, 1, 1)));
  return { geo, color };
}

/** A soft leaf or cone from a profile of [radius, height] pairs (first and last radius 0), flattened in z, then placed. */
export function leaf(profile: [number, number][], flatZ: number, at: V3, rot: V3, color: THREE.ColorRepresentation, seg = 8): Piece {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ'));
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), q, new THREE.Vector3(1, 1, flatZ)));
  return { geo, color };
}

/** Merge pieces into one indexed geometry (position, normal, colour), moved so that `pivot` is the origin. The pieces' own geometries are disposed. */
export function mergePieces(pieces: Piece[], pivot: V3 = [0, 0, 0]): THREE.BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const p of pieces) {
    verts += p.geo.getAttribute('position').count;
    idx += p.geo.index ? p.geo.index.count : p.geo.getAttribute('position').count;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const index = verts > 65000 ? new Uint32Array(idx) : new Uint16Array(idx);
  const c = new THREE.Color();
  let v = 0;
  let k = 0;
  for (const p of pieces) {
    const g = p.geo;
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    const na = g.getAttribute('normal') as THREE.BufferAttribute;
    c.set(p.color); // sRGB hex in, linear working colour out
    for (let i = 0; i < pa.count; i++) {
      pos[(v + i) * 3] = pa.getX(i) - pivot[0];
      pos[(v + i) * 3 + 1] = pa.getY(i) - pivot[1];
      pos[(v + i) * 3 + 2] = pa.getZ(i) - pivot[2];
      nor[(v + i) * 3] = na.getX(i);
      nor[(v + i) * 3 + 1] = na.getY(i);
      nor[(v + i) * 3 + 2] = na.getZ(i);
      col[(v + i) * 3] = c.r;
      col[(v + i) * 3 + 1] = c.g;
      col[(v + i) * 3 + 2] = c.b;
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index[k++] = g.index.getX(i) + v;
    else for (let i = 0; i < pa.count; i++) index[k++] = v + i;
    v += pa.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

export function triangleCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}
