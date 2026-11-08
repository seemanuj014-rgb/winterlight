// Smooth "outline normals" for the inverted hull (no three import: pure, unit-tested).
// A hull pushed out along per-face normals tears open at hard edges (cube corners, cone base).
// Vertices that share a position are welded and their normals averaged, so the hull stays closed.
// The 4th component is a taper factor: vertices whose face normals disagree strongly (tips, sharp
// corners) get a thinner line, like a pen lifting at the end of a stroke.

export const MIN_TAPER = 0.6;

export function buildOutlineNormals(positions: ArrayLike<number>, normals: ArrayLike<number>, weldEps: number): Float32Array {
  const count = Math.floor(positions.length / 3);
  const key = (i: number): string =>
    `${Math.round(positions[i * 3]! / weldEps)},${Math.round(positions[i * 3 + 1]! / weldEps)},${Math.round(positions[i * 3 + 2]! / weldEps)}`;

  const groups = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const k = key(i);
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  }

  const out = new Float32Array(count * 4);
  for (const g of groups.values()) {
    let sx = 0, sy = 0, sz = 0;
    for (const i of g) {
      const nx = normals[i * 3]!, ny = normals[i * 3 + 1]!, nz = normals[i * 3 + 2]!;
      const l = Math.hypot(nx, ny, nz) || 1;
      sx += nx / l;
      sy += ny / l;
      sz += nz / l;
    }
    let al = Math.hypot(sx, sy, sz);
    if (al < 1e-6) {
      // Normals cancel (a flat double-sided sheet): fall back to the first one.
      const i0 = g[0]!;
      sx = normals[i0 * 3]!;
      sy = normals[i0 * 3 + 1]!;
      sz = normals[i0 * 3 + 2]!;
      al = Math.hypot(sx, sy, sz) || 1;
    }
    const ax = sx / al, ay = sy / al, az = sz / al;

    let minDot = 1;
    for (const i of g) {
      const nx = normals[i * 3]!, ny = normals[i * 3 + 1]!, nz = normals[i * 3 + 2]!;
      const l = Math.hypot(nx, ny, nz) || 1;
      minDot = Math.min(minDot, (nx * ax + ny * ay + nz * az) / l);
    }
    const sharp = Math.min(1, Math.max(0, 1 - minDot));
    const t = Math.min(1, Math.max(0, (sharp - 0.2) / 0.8));
    const taper = 1 - (1 - MIN_TAPER) * (t * t * (3 - 2 * t));

    for (const i of g) {
      out[i * 4] = ax;
      out[i * 4 + 1] = ay;
      out[i * 4 + 2] = az;
      out[i * 4 + 3] = taper;
    }
  }
  return out;
}
