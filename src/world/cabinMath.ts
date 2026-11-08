// Phase 14: the geometry of the cabin (outside) and the sleepy nook (inside), as plain arrays. Pure: no three, no DOM, no clock, so it is unit-tested.
// Everything is built from a few primitives (box, cylinder, prism, fan) into merged meshes with per-vertex colour, so a whole cabin is a handful of draw calls.
// Units are metres, the same as the ground and the pines. `[A]`: every size and colour below is a first guess, tuned by eye.
// Layers (each one mesh): `toon` (the lit, inked parts), `door` (its own mesh so it can swing), `glow` (warm and window light, drawn unlit),
// `spill` (soft warm light on the snow, outside only). Colours are sRGB 0..1 here; the three.js side converts them.

import { rng, hexToRgb } from './backdropMath';
import { CABIN_SITE, SNOW_LIT } from './groundMath';

export type Vec3 = [number, number, number];

export interface MeshData {
  pos: number[];
  nrm: number[];
  /** r, g, b (sRGB 0..1), plus a fourth component (alpha) only on `spill` */
  col: number[];
  idx: number[];
}

export const newMesh = (): MeshData => ({ pos: [], nrm: [], col: [], idx: [] });
export const triCount = (m: MeshData): number => m.idx.length / 3;
export const vertCount = (m: MeshData): number => m.pos.length / 3;

// ---------------------------------------------------------------------------
// Palette. AD: warm window and lantern #ffb86b / #ffd9a0; snow lit #e8f1f8, snow shadow #a9bdd6; warmth is rare, so the wood is dark and a little cool.
// ---------------------------------------------------------------------------
export const WARM = 0xffb86b;
export const WARM_LIGHT = 0xffd9a0;
export const COL = {
  log: 0x7a5d4c,
  logDark: 0x4d3a30,
  frame: 0x3d2f2a,
  roof: 0x4c3b34,
  stone: 0x7d8794,
  stoneDark: 0x5f6977,
  door: 0x7b4b3a,
  doorPlank: 0x6c4132,
  metal: 0x2b2f38,
  snow: SNOW_LIT,
  floor: 0x4a382e,
  floorAlt: 0x42322a,
  wall: 0x65504a,
  groove: 0x45342b,
  glassTop: 0x1c3556,
  glassLow: 0x6f86b8,
  ridge: 0x3b5278,
  blanket: 0x8d86b0,
  blanketStripe: 0x756e9a,
  sheet: 0xc9d3e0,
  pillow: 0xe8f1f8,
  rug: 0x5d7480,
  rugRing: 0x7a909b,
  cup: 0xe8dfd6,
  cocoa: 0x5a3a2a,
  book: [0x7a4f58, 0x4f6a73, 0x8a7a5a, 0x5d5a7c, 0x6b7f66] as number[],
  jar: 0x9fb4c8,
} as const;

const rgb = (hex: number): Vec3 => {
  const c = hexToRgb(hex);
  return [c[0], c[1], c[2]];
};

// ---------------------------------------------------------------------------
// Primitives. A transform is: scale, then rotate (Y, then X, then Z), then move.
// ---------------------------------------------------------------------------
export interface Xf {
  c: Vec3;
  rx?: number;
  ry?: number;
  rz?: number;
  sc?: Vec3;
}

function apply(xf: Xf, p: Vec3, isNormal = false): Vec3 {
  let [x, y, z] = p;
  if (xf.sc && !isNormal) {
    x *= xf.sc[0];
    y *= xf.sc[1];
    z *= xf.sc[2];
  } else if (xf.sc && isNormal) {
    x /= xf.sc[0];
    y /= xf.sc[1];
    z /= xf.sc[2];
  }
  const ry = xf.ry ?? 0, rx = xf.rx ?? 0, rz = xf.rz ?? 0;
  if (ry) {
    const c = Math.cos(ry), s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (rx) {
    const c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (rz) {
    const c = Math.cos(rz), s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  if (isNormal) {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }
  return [x + xf.c[0], y + xf.c[1], z + xf.c[2]];
}

function push(m: MeshData, xf: Xf, p: Vec3, n: Vec3, color: Vec3, alpha?: number): number {
  const q = apply(xf, p);
  const nn = apply(xf, n, true);
  m.pos.push(q[0], q[1], q[2]);
  m.nrm.push(nn[0], nn[1], nn[2]);
  m.col.push(color[0], color[1], color[2]);
  if (alpha !== undefined) m.col.push(alpha);
  return m.pos.length / 3 - 1;
}

/** Tiny seeded brightness change so no two logs are exactly alike. */
export function tint(color: Vec3, k: number): Vec3 {
  return [Math.min(1, color[0] * k), Math.min(1, color[1] * k), Math.min(1, color[2] * k)];
}

/** A box of size s (w, h, d) centred at xf.c. Flat shaded: 24 vertices, 12 triangles. */
export function box(m: MeshData, xf: Xf, s: Vec3, hex: number | Vec3, k = 1): void {
  const color = tint(typeof hex === 'number' ? rgb(hex) : hex, k);
  const [w, h, d] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const faces: { n: Vec3; v: Vec3[] }[] = [
    { n: [0, 0, 1], v: [[-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]] },
    { n: [0, 0, -1], v: [[w, -h, -d], [-w, -h, -d], [-w, h, -d], [w, h, -d]] },
    { n: [1, 0, 0], v: [[w, -h, d], [w, -h, -d], [w, h, -d], [w, h, d]] },
    { n: [-1, 0, 0], v: [[-w, -h, -d], [-w, -h, d], [-w, h, d], [-w, h, -d]] },
    { n: [0, 1, 0], v: [[-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d]] },
    { n: [0, -1, 0], v: [[-w, -h, -d], [w, -h, -d], [w, -h, d], [-w, -h, d]] },
  ];
  for (const f of faces) {
    const a = f.v.map((p) => push(m, xf, p, f.n, color));
    m.idx.push(a[0]!, a[1]!, a[2]!, a[0]!, a[2]!, a[3]!);
  }
}

/** A cylinder (or cone frustum) of length h along `axis`, radius r0 at the start and r1 at the end. Smooth sides, flat caps. */
export function cyl(m: MeshData, xf: Xf, r0: number, r1: number, h: number, seg: number, axis: 'x' | 'y' | 'z', hex: number | Vec3, caps = true, k = 1): void {
  const color = tint(typeof hex === 'number' ? rgb(hex) : hex, k);
  // local frame: build along y, then swing to the axis
  const to = (p: Vec3): Vec3 => (axis === 'y' ? p : axis === 'x' ? [p[1], -p[0], p[2]] : [p[0], p[2], -p[1]]);
  const slope = (r0 - r1) / h;
  const ring: [number, number][] = [];
  for (let i = 0; i <= seg; i++) ring.push([Math.cos((i / seg) * Math.PI * 2), Math.sin((i / seg) * Math.PI * 2)]);
  const base = m.pos.length / 3;
  for (let i = 0; i <= seg; i++) {
    const [cx, sz] = ring[i]!;
    const n = to([cx, slope, sz]);
    push(m, xf, to([cx * r0, -h / 2, sz * r0]), n, color);
    push(m, xf, to([cx * r1, h / 2, sz * r1]), n, color);
  }
  for (let i = 0; i < seg; i++) {
    const a = base + i * 2;
    m.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  if (!caps) return;
  for (const side of [-1, 1] as const) {
    const r = side < 0 ? r0 : r1;
    if (r <= 0) continue;
    const n = to([0, side, 0]);
    const centre = push(m, xf, to([0, (side * h) / 2, 0]), n, color);
    const first = m.pos.length / 3;
    for (let i = 0; i < seg; i++) push(m, xf, to([ring[i]![0] * r, (side * h) / 2, ring[i]![1] * r]), n, color);
    for (let i = 0; i < seg; i++) {
      const a = first + i, b = first + ((i + 1) % seg);
      if (side > 0) m.idx.push(centre, b, a);
      else m.idx.push(centre, a, b);
    }
  }
}

/** A triangular prism: the gable. Base width w along x, height h along y (apex in the middle), thickness d along z. */
export function prism(m: MeshData, xf: Xf, w: number, h: number, d: number, hex: number | Vec3): void {
  const color = typeof hex === 'number' ? rgb(hex) : hex;
  const [hw, hd] = [w / 2, d / 2];
  const A: Vec3 = [-hw, 0, hd], B: Vec3 = [hw, 0, hd], C: Vec3 = [0, h, hd];
  const A2: Vec3 = [-hw, 0, -hd], B2: Vec3 = [hw, 0, -hd], C2: Vec3 = [0, h, -hd];
  const tri = (p: Vec3, q: Vec3, r: Vec3, n: Vec3): void => {
    const a = push(m, xf, p, n, color), b = push(m, xf, q, n, color), c = push(m, xf, r, n, color);
    m.idx.push(a, b, c);
  };
  tri(A, B, C, [0, 0, 1]);
  tri(B2, A2, C2, [0, 0, -1]);
  const sl = Math.hypot(h, hw);
  const nr: Vec3 = [h / sl, hw / sl, 0], nl: Vec3 = [-h / sl, hw / sl, 0];
  const quad = (p: Vec3, q: Vec3, r: Vec3, s: Vec3, n: Vec3): void => {
    const a = push(m, xf, p, n, color), b = push(m, xf, q, n, color), c = push(m, xf, r, n, color), e = push(m, xf, s, n, color);
    m.idx.push(a, b, c, a, c, e);
  };
  quad(B, B2, C2, C, nr);
  quad(A2, A, C, C2, nl);
  quad(A2, B2, B, A, [0, -1, 0]);
}

/** A flat polygon fan facing `n`, centre colour and rim colour (and alphas on `spill`). Used for glass and for the warm spill on the snow. */
export function fan(m: MeshData, xf: Xf, pts: [number, number][], n: Vec3, centre: Vec3, rim: Vec3 | Vec3[], alphaCentre?: number, alphaRim?: number, centreAt: [number, number] = [0, 0]): void {
  const c = push(m, xf, [centreAt[0], centreAt[1], 0], n, centre, alphaCentre);
  const first = m.pos.length / 3;
  pts.forEach((p, i) => push(m, xf, [p[0], p[1], 0], n, Array.isArray(rim[0]) ? (rim as Vec3[])[i]! : (rim as Vec3), alphaRim));
  for (let i = 0; i < pts.length; i++) m.idx.push(c, first + i, first + ((i + 1) % pts.length));
}

// ---------------------------------------------------------------------------
// The door: its own piece, hinge at the local origin, panel stretching along +x, facing +z. Same builder for the cabin and the nook.
// ---------------------------------------------------------------------------
export const DOOR = { w: 1.0, h: 2.0, t: 0.09, maxOpenDeg: 105 };

export function buildDoor(): MeshData {
  const m = newMesh();
  const r = rng(777);
  const planks = 4;
  const pw = DOOR.w / planks;
  for (let i = 0; i < planks; i++) {
    box(m, { c: [pw * (i + 0.5), DOOR.h / 2, 0] }, [pw - 0.012, DOOR.h, DOOR.t], i % 2 ? COL.doorPlank : COL.door, 0.95 + r() * 0.1);
  }
  box(m, { c: [DOOR.w / 2, DOOR.h * 0.22, DOOR.t / 2 + 0.01] }, [DOOR.w - 0.06, 0.12, 0.03], COL.logDark); // lower rail
  box(m, { c: [DOOR.w / 2, DOOR.h * 0.8, DOOR.t / 2 + 0.01] }, [DOOR.w - 0.06, 0.12, 0.03], COL.logDark); // upper rail
  cyl(m, { c: [DOOR.w - 0.12, DOOR.h * 0.5, DOOR.t / 2 + 0.05] }, 0.03, 0.03, 0.06, 6, 'z', COL.metal); // handle
  box(m, { c: [0.06, DOOR.h * 0.22, DOOR.t / 2 + 0.03] }, [0.14, 0.04, 0.02], COL.metal); // hinge straps
  box(m, { c: [0.06, DOOR.h * 0.8, DOOR.t / 2 + 0.03] }, [0.14, 0.04, 0.02], COL.metal);
  return m;
}

// ---------------------------------------------------------------------------
// The cabin, outside.
// ---------------------------------------------------------------------------
/** Local frame: origin at the middle of the footprint on the ground, the door on the +z face. */
export const CABIN = {
  /** half footprint */
  hx: 2.6,
  hz: 2.1,
  wallTop: 2.8,
  roofDeg: 32,
  overhang: 0.45,
  logR: 0.17,
  courseGap: 0.29,
  courses: 9,
  /** the door opening in the front wall */
  doorX: 0,
  hingeX: -0.5,
  /** windows: centre x (front) or z (ends), centre y, width, height */
  windowY: 1.5,
  windowW: 0.95,
  windowH: 0.8,
  frontWindowX: [-1.6, 1.6] as number[],
  endWindowZ: 0,
  chimney: { x: 1.4, z: -0.6, size: 0.55 },
};
/** The cabin stands on the cabin clearing and its door faces the viewer (the camera at the origin). Degrees about y. */
export const CABIN_FACING_DEG = (Math.atan2(0 - CABIN_SITE.x, 0 - CABIN_SITE.z) * 180) / Math.PI;
export const CABIN_RIDGE_Y = CABIN.wallTop + CABIN.hz * Math.tan((CABIN.roofDeg * Math.PI) / 180);
export const CABIN_SMOKE_ORIGIN: Vec3 = [CABIN.chimney.x, 5.0, CABIN.chimney.z];

export interface CabinMeshes {
  toon: MeshData;
  glow: MeshData;
  spill: MeshData;
  door: MeshData;
  /** one entry per log, so a test can prove none crosses the door opening */
  logs: { axis: 'x' | 'z'; c: Vec3; len: number }[];
}

export function buildCabin(): CabinMeshes {
  const toon = newMesh(), glow = newMesh(), spill = newMesh();
  const logs: CabinMeshes['logs'] = [];
  const r = rng(4141);
  const { hx, hz, logR, courseGap, courses } = CABIN;
  const rad = (CABIN.roofDeg * Math.PI) / 180;
  const doorL = CABIN.hingeX - 0.04, doorR = CABIN.hingeX + DOOR.w + 0.04;

  // foundation of stones
  box(toon, { c: [0, 0.1, 0] }, [hx * 2 + 0.3, 0.3, hz * 2 + 0.3], COL.stoneDark);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    box(toon, { c: [Math.cos(a) * (hx + 0.12), 0.08, Math.sin(a) * (hz + 0.12)], ry: r() }, [0.34 + r() * 0.2, 0.22, 0.3 + r() * 0.15], COL.stone, 0.9 + r() * 0.15);
  }

  // log walls: front and back run along x, the two ends along z, shifted half a course so the corners interleave
  for (let i = 0; i < courses; i++) {
    const y = 0.32 + i * courseGap;
    const k = (i % 2 ? 0.88 : 1.06) + (r() - 0.5) * 0.1; // alternate courses a little lighter and darker, so the logs read
    for (const z of [hz, -hz]) {
      const len = hx * 2 + 0.5;
      const doorway = z > 0 && y - logR < DOOR.h + 0.02;
      if (doorway) {
        const lA = doorL - (-len / 2), lB = len / 2 - doorR;
        cyl(toon, { c: [(-len / 2 + doorL) / 2, y, z] }, logR, logR, lA, 7, 'x', COL.log, true, k);
        cyl(toon, { c: [(doorR + len / 2) / 2, y, z] }, logR, logR, lB, 7, 'x', COL.log, true, k * 0.97);
        logs.push({ axis: 'x', c: [(-len / 2 + doorL) / 2, y, z], len: lA }, { axis: 'x', c: [(doorR + len / 2) / 2, y, z], len: lB });
      } else {
        cyl(toon, { c: [0, y, z] }, logR, logR, len, 7, 'x', COL.log, true, k);
        logs.push({ axis: 'x', c: [0, y, z], len });
      }
    }
    for (const x of [hx, -hx]) {
      const len = hz * 2 + 0.5;
      cyl(toon, { c: [x, y + courseGap / 2, 0] }, logR, logR, len, 7, 'z', COL.log, true, k * 0.97);
      logs.push({ axis: 'z', c: [x, y + courseGap / 2, 0], len });
    }
  }
  // gable ends above the end walls, the lintel over the door, boards for the front and back gables
  const gableH = CABIN_RIDGE_Y - CABIN.wallTop;
  for (const x of [hx, -hx]) prism(toon, { c: [x, CABIN.wallTop, 0], ry: Math.PI / 2 }, hz * 2 + 0.2, gableH + 0.1, 0.3, COL.logDark);
  box(toon, { c: [CABIN.hingeX + DOOR.w / 2, DOOR.h + 0.2, hz] }, [DOOR.w + 0.4, 0.2, 0.34], COL.logDark); // lintel

  // roof: two wooden slabs and a snow blanket on each; the ridge and the eaves carry a roll of snow
  const run = hz + CABIN.overhang;
  const slabLen = run / Math.cos(rad);
  const slabW = hx * 2 + 0.7;
  for (const s of [1, -1]) {
    const cy = CABIN_RIDGE_Y - (run / 2) * Math.tan(rad) + 0.0;
    box(toon, { c: [0, cy, (s * run) / 2], rx: s * rad }, [slabW, 0.14, slabLen + 0.05], COL.roof);
    box(toon, { c: [0, cy + 0.12 / Math.cos(rad), (s * run) / 2], rx: s * rad }, [slabW - 0.12, 0.17, slabLen - 0.1], COL.snow, 0.98);
    cyl(toon, { c: [0, CABIN_RIDGE_Y - run * Math.tan(rad) + 0.06, s * (run - 0.03)] }, 0.11, 0.11, slabW - 0.15, 6, 'x', COL.snow, true, 0.96);
  }
  cyl(toon, { c: [0, CABIN_RIDGE_Y + 0.12, 0] }, 0.2, 0.2, slabW - 0.1, 6, 'x', COL.snow, true, 1);

  // chimney of stones with a snow cap
  const ch = CABIN.chimney;
  box(toon, { c: [ch.x, 4.05, ch.z] }, [ch.size, 1.7, ch.size], COL.stone);
  for (let i = 0; i < 5; i++) box(toon, { c: [ch.x, 3.4 + i * 0.35, ch.z] }, [ch.size + 0.04, 0.04, ch.size + 0.04], COL.stoneDark);
  box(toon, { c: [ch.x, 4.98, ch.z] }, [ch.size + 0.16, 0.13, ch.size + 0.16], COL.snow);

  // step, with snow on it
  box(toon, { c: [CABIN.hingeX + DOOR.w / 2, 0.1, hz + 0.5] }, [1.7, 0.2, 0.75], COL.stone);
  box(toon, { c: [CABIN.hingeX + DOOR.w / 2, 0.23, hz + 0.5] }, [1.5, 0.07, 0.6], COL.snow);

  // windows: frame, muntins, sill, glass; light on the glass is in the glow layer
  const win = (cx: number, cz: number, face: 'front' | 'end', side: 1 | -1): void => {
    const W = CABIN.windowW, H = CABIN.windowH, y = CABIN.windowY;
    const off = (face === 'front' ? hz : hx) + logR + 0.012;
    const place = (u: number, v: number, depth: number): Vec3 => (face === 'front' ? [cx + u, y + v, side * (off + depth)] : [side * (off + depth), y + v, cz + u]);
    const sz = (w: number, h: number, d: number): Vec3 => (face === 'front' ? [w, h, d] : [d, h, w]);
    const ry = 0;
    box(toon, { c: place(0, H / 2 + 0.05, 0.03), ry }, sz(W + 0.2, 0.1, 0.07), COL.frame);
    box(toon, { c: place(0, -H / 2 - 0.05, 0.03), ry }, sz(W + 0.2, 0.1, 0.07), COL.frame);
    box(toon, { c: place(-W / 2 - 0.05, 0, 0.03), ry }, sz(0.1, H, 0.07), COL.frame);
    box(toon, { c: place(W / 2 + 0.05, 0, 0.03), ry }, sz(0.1, H, 0.07), COL.frame);
    box(toon, { c: place(0, 0, 0.05), ry }, sz(0.05, H, 0.04), COL.frame); // muntins
    box(toon, { c: place(0, 0, 0.05), ry }, sz(W, 0.05, 0.04), COL.frame);
    box(toon, { c: place(0, -H / 2 - 0.13, 0.08), ry }, sz(W + 0.4, 0.07, 0.2), COL.logDark); // sill
    box(toon, { c: place(0, -H / 2 - 0.08, 0.1), ry }, sz(W + 0.3, 0.05, 0.16), COL.snow); // snow on the sill
    // the glass: warm in the middle, deeper at the rim
    const g = (u: number, v: number): Vec3 => place(u, v, 0.0);
    const pts: [number, number][] = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]];
    const q: Vec3[] = pts.map(([u, v]) => g(u, v));
    const n: Vec3 = face === 'front' ? [0, 0, side] : [side, 0, 0];
    const c = push(glow, { c: [0, 0, 0] }, g(0, -0.05), n, rgb(WARM_LIGHT));
    const first = glow.pos.length / 3;
    q.forEach((p) => push(glow, { c: [0, 0, 0] }, p, n, rgb(WARM)));
    for (let i = 0; i < 4; i++) {
      const a = first + i, b = first + ((i + 1) % 4);
      if (face === 'front' ? side > 0 : side < 0) glow.idx.push(c, a, b);
      else glow.idx.push(c, b, a);
    }
  };
  for (const x of CABIN.frontWindowX) win(x, 0, 'front', 1);
  win(0, CABIN.endWindowZ, 'end', 1);
  win(0, CABIN.endWindowZ, 'end', -1);

  // the doorway: a warm panel just inside the opening, hidden by the door while it is closed
  const dw = DOOR.w + 0.08;
  const dn: Vec3 = [0, 0, 1];
  const dc = push(glow, { c: [0, 0, 0] }, [CABIN.hingeX + DOOR.w / 2, 1.0, hz - 0.12], dn, rgb(WARM_LIGHT));
  const df = glow.pos.length / 3;
  for (const [u, v, w] of [[-dw / 2, 0, 0], [dw / 2, 0, 0], [dw / 2, DOOR.h, 0], [-dw / 2, DOOR.h, 0]] as [number, number, number][]) push(glow, { c: [0, 0, 0] }, [CABIN.hingeX + DOOR.w / 2 + u, v + w, hz - 0.12], dn, rgb(WARM));
  for (let i = 0; i < 4; i++) glow.idx.push(dc, df + i, df + ((i + 1) % 4));

  // a lantern by the door: cap, frame, and a small bright box
  const lx = CABIN.hingeX + DOOR.w + 0.55, ly = 2.0, lz = hz + logR + 0.2;
  box(toon, { c: [lx, ly + 0.17, lz] }, [0.2, 0.05, 0.2], COL.metal);
  box(toon, { c: [lx, ly - 0.17, lz] }, [0.2, 0.05, 0.2], COL.metal);
  box(toon, { c: [lx, ly + 0.28, lz - 0.1] }, [0.03, 0.22, 0.03], COL.metal);
  box(glow, { c: [lx, ly, lz] }, [0.13, 0.28, 0.13], rgb(WARM_LIGHT));

  // snow banked against the walls: low squashed mounds
  const mounds: [number, number, number, number][] = [[-hx - 0.2, hz + 0.4, 0.9, 0.3], [hx + 0.3, hz + 0.2, 1.1, 0.34], [-hx - 0.5, -0.4, 0.8, 0.28], [hx + 0.5, -hz - 0.3, 1.0, 0.3], [-1.2, -hz - 0.5, 1.2, 0.3], [1.4, hz + 0.75, 0.6, 0.2]];
  for (const [x, z, rr, hh] of mounds) cyl(toon, { c: [x, hh * 0.35, z], sc: [1, 1, 0.8], ry: x }, rr, rr * 0.7, hh, 7, 'y', COL.snow, true, 0.97);

  // soft warm light lying on the snow in front of the door and the front windows
  const ring = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2), Math.sin((i / n) * Math.PI * 2)]);
  const spillAt = (cx: number, cz: number, rx: number, rz: number, a: number): void => {
    const pts = ring(14).map(([x, y]) => [x * rx, y * rz] as [number, number]);
    // laid on the ground: a fan facing up, built from the xz plane
    const c = push(spill, { c: [cx, 0.06, cz] }, [0, 0, 0], [0, 1, 0], rgb(WARM), a);
    const f = spill.pos.length / 3;
    for (const p of pts) push(spill, { c: [cx, 0.06, cz] }, [p[0], 0, p[1]], [0, 1, 0], rgb(WARM), 0);
    for (let i = 0; i < pts.length; i++) spill.idx.push(c, f + ((i + 1) % pts.length), f + i);
  };
  spillAt(CABIN.hingeX + DOOR.w / 2, hz + 1.5, 1.5, 1.8, 0.5);
  for (const x of CABIN.frontWindowX) spillAt(x, hz + 1.1, 1.1, 1.2, 0.28);

  void fan;
  return { toon, glow, spill, door: buildDoor(), logs };
}

// ---------------------------------------------------------------------------
// The nook, inside. Local frame: origin at the middle of the floor, the open side (no wall) toward +z, where the camera stands.
// ---------------------------------------------------------------------------
/** Where the nook lives in the world: well above the ground, so the two never meet. The camera director (Phase 17) moves the camera there. */
export const NOOK_ORIGIN: Vec3 = [0, 50, 0];
export const NOOK = {
  hx: 2.2,
  hz: 1.7,
  h: 2.5,
  /** the bed and where Chamgadad sleeps on it (Phase 19). Chamgadad is about 7 units tall in her own units: the rig is scaled down to fit (`[A]`, about 0.2). */
  bed: { x: -0.85, z: -1.05, len: 2.0, wid: 1.1, top: 0.46 },
  sleepSpot: [-0.95, 0.5, -1.05] as Vec3,
  /** the cat's place at the foot of the bed (Phase 16) */
  catSpot: [-0.05, 0.6, -1.0] as Vec3,
  window: { x: 1.45, y: 1.4, w: 1.0, h: 0.9 },
  table: { x: 0.55, z: -1.35 },
  /** the lamp's light and the cup's steam */
  lamp: [0.55, 0.98, -1.35] as Vec3,
  cup: [0.7, 0.66, -1.3] as Vec3,
  rug: { x: 0.2, z: 0.35, r: 0.95 },
  /** the door in the right wall, hinge at z, swinging into the room */
  doorZ: 0.55,
};

export interface NookMeshes {
  toon: MeshData;
  glow: MeshData;
  /** the soft warm halo of the lamp on the wall behind it (alpha), additive */
  halo: MeshData;
  door: MeshData;
}

export function buildNook(): NookMeshes {
  const toon = newMesh(), glow = newMesh(), halo = newMesh();
  const r = rng(5151);
  const { hx, hz, h } = NOOK;

  // floor: planks in two tones; ceiling and beams
  const planks = 12;
  for (let i = 0; i < planks; i++) box(toon, { c: [-hx + ((i + 0.5) / planks) * hx * 2, -0.05, 0] }, [(hx * 2) / planks - 0.015, 0.1, hz * 2 + 0.2], i % 2 ? COL.floorAlt : COL.floor, 0.95 + r() * 0.1);
  box(toon, { c: [0, h + 0.05, 0] }, [hx * 2 + 0.3, 0.1, hz * 2 + 0.2], COL.logDark);
  for (const x of [-1.5, 0, 1.5]) box(toon, { c: [x, h - 0.1, 0] }, [0.2, 0.2, hz * 2], COL.log, 0.9 + r() * 0.1);

  // walls: a stack of log courses in two tones (no thin groove boxes: their ink lines came out as heavy black bars), the right wall split round the door
  const course = 0.28;
  const nCourses = Math.ceil(h / course);
  const wallCourses = (face: 'back' | 'left' | 'right', a: number, b: number): void => {
    for (let i = 0; i < nCourses; i++) {
      const y0 = i * course;
      const hh = Math.min(course, h - y0);
      const k = (i % 2 ? 0.9 : 1.04) + (r() - 0.5) * 0.06;
      const len = b - a;
      const bulge = i % 2 ? 0.012 : 0;
      if (face === 'back') box(toon, { c: [(a + b) / 2, y0 + hh / 2, -hz - 0.05 + bulge] }, [len, hh, 0.1], COL.wall, k);
      else box(toon, { c: [face === 'left' ? -hx - 0.05 - bulge : hx + 0.05 + bulge, y0 + hh / 2, (a + b) / 2] }, [0.1, hh, len], COL.wall, k);
    }
  };
  wallCourses('back', -hx - 0.1, hx + 0.1);
  wallCourses('left', -hz, hz);
  const dz = NOOK.doorZ;
  wallCourses('right', -hz, dz - 0.04);
  wallCourses('right', dz + DOOR.w + 0.04, hz);
  box(toon, { c: [hx + 0.05, DOOR.h + (h - DOOR.h) / 2 + 0.02, dz + DOOR.w / 2] }, [0.1, h - DOOR.h - 0.04, DOOR.w + 0.08], COL.logDark); // lintel
  // the cold outside, seen through the doorway when the door opens
  fan(glow, { c: [hx + 0.08, 0, dz + DOOR.w / 2], ry: -Math.PI / 2 }, [[-DOOR.w / 2 - 0.04, 0], [DOOR.w / 2 + 0.04, 0], [DOOR.w / 2 + 0.04, DOOR.h], [-DOOR.w / 2 - 0.04, DOOR.h]], [0, 0, 1], rgb(0xa9bdd6), [rgb(0x6f86b8), rgb(0x6f86b8), rgb(0x3b5278), rgb(0x3b5278)], undefined, undefined, [0, 1]);

  // the window in the back wall, onto the snow: cool, so the room's warmth reads as warm
  const W = NOOK.window;
  const wz = -hz + 0.01;
  box(toon, { c: [W.x, W.y + W.h / 2 + 0.06, wz + 0.04] }, [W.w + 0.24, 0.12, 0.1], COL.frame);
  box(toon, { c: [W.x, W.y - W.h / 2 - 0.06, wz + 0.04] }, [W.w + 0.24, 0.12, 0.1], COL.frame);
  box(toon, { c: [W.x - W.w / 2 - 0.06, W.y, wz + 0.04] }, [0.12, W.h, 0.1], COL.frame);
  box(toon, { c: [W.x + W.w / 2 + 0.06, W.y, wz + 0.04] }, [0.12, W.h, 0.1], COL.frame);
  box(toon, { c: [W.x, W.y, wz + 0.06] }, [0.05, W.h, 0.04], COL.frame);
  box(toon, { c: [W.x, W.y, wz + 0.06] }, [W.w, 0.05, 0.04], COL.frame);
  box(toon, { c: [W.x, W.y - W.h / 2 - 0.15, wz + 0.1] }, [W.w + 0.4, 0.06, 0.24], COL.logDark);
  box(toon, { c: [W.x, W.y - W.h / 2 - 0.115, wz + 0.1] }, [W.w + 0.3, 0.05, 0.18], COL.snow);
  const gz = wz + 0.0;
  const glass: [number, number, Vec3][] = [[-W.w / 2, -W.h / 2, rgb(COL.glassLow)], [W.w / 2, -W.h / 2, rgb(COL.glassLow)], [W.w / 2, W.h / 2, rgb(COL.glassTop)], [-W.w / 2, W.h / 2, rgb(COL.glassTop)]];
  const gi = glow.pos.length / 3;
  for (const [u, v, c] of glass) push(glow, { c: [W.x, W.y, gz] }, [u, v, 0], [0, 0, 1], c);
  glow.idx.push(gi, gi + 1, gi + 2, gi, gi + 2, gi + 3);
  // far mountains in the pane, snow on the ground below, a few flakes
  const ridge: [number, number][] = [[-0.5, -0.1], [-0.32, 0.08], [-0.2, -0.02], [0.02, 0.2], [0.2, 0.02], [0.34, 0.1], [0.5, -0.08]];
  for (let i = 0; i < ridge.length - 1; i++) {
    const [u0, v0] = ridge[i]!, [u1, v1] = ridge[i + 1]!;
    const base = -0.2;
    const a = push(glow, { c: [W.x, W.y, gz + 0.004] }, [u0 * W.w, v0 * W.h, 0], [0, 0, 1], rgb(COL.ridge));
    const b = push(glow, { c: [W.x, W.y, gz + 0.004] }, [u1 * W.w, v1 * W.h, 0], [0, 0, 1], rgb(COL.ridge));
    const c = push(glow, { c: [W.x, W.y, gz + 0.004] }, [u1 * W.w, base * W.h - 0.2, 0], [0, 0, 1], rgb(COL.ridge));
    const d = push(glow, { c: [W.x, W.y, gz + 0.004] }, [u0 * W.w, base * W.h - 0.2, 0], [0, 0, 1], rgb(COL.ridge));
    glow.idx.push(a, d, c, a, c, b);
  }
  box(glow, { c: [W.x, W.y - W.h * 0.38, gz + 0.006] }, [W.w, W.h * 0.24, 0.002], rgb(0xa9bdd6));
  for (let i = 0; i < 9; i++) box(glow, { c: [W.x + (r() - 0.5) * W.w * 0.9, W.y + (r() - 0.45) * W.h * 0.85, gz + 0.008] }, [0.03, 0.03, 0.002], rgb(0xe8f1f8));

  // the bed: frame, sheet, pillow, blanket in lumps with stripes, head and foot boards
  const B = NOOK.bed;
  box(toon, { c: [B.x, 0.17, B.z] }, [B.len, 0.28, B.wid], COL.logDark);
  box(toon, { c: [B.x, 0.34, B.z] }, [B.len - 0.06, 0.14, B.wid - 0.06], COL.sheet);
  box(toon, { c: [B.x - B.len / 2 - 0.05, 0.5, B.z] }, [0.1, 0.8, B.wid + 0.1], COL.log);
  box(toon, { c: [B.x + B.len / 2 + 0.04, 0.38, B.z] }, [0.08, 0.5, B.wid + 0.1], COL.log);
  cyl(toon, { c: [B.x - 0.7, 0.5, B.z], rz: 0, sc: [1, 0.55, 1] }, 0.24, 0.24, 0.62, 8, 'z', COL.pillow); // pillow
  cyl(toon, { c: [B.x + 0.28, 0.5, B.z], sc: [1, 0.42, 1] }, 0.55, 0.55, 1.28, 9, 'x', COL.blanket); // the blanket, a soft long lump
  for (const sx of [-0.1, 0.28, 0.66]) cyl(toon, { c: [B.x + sx, 0.5, B.z], sc: [1, 0.42, 1] }, 0.557, 0.557, 0.09, 9, 'x', COL.blanketStripe, false);
  box(toon, { c: [B.x + 0.28, 0.4, B.z + B.wid / 2 + 0.02] }, [1.28, 0.2, 0.05], COL.blanket, 0.92); // the blanket hangs over the front edge

  // bedside table, lamp, cup
  const T = NOOK.table;
  box(toon, { c: [T.x, 0.28, T.z] }, [0.55, 0.56, 0.45], COL.log);
  box(toon, { c: [T.x, 0.57, T.z] }, [0.6, 0.04, 0.5], COL.logDark);
  box(toon, { c: [T.x, 0.2, T.z + 0.226] }, [0.4, 0.28, 0.02], COL.groove);
  cyl(toon, { c: [T.x - 0.1, 0.62, T.z] }, 0.08, 0.08, 0.05, 8, 'y', COL.metal);
  cyl(toon, { c: [T.x - 0.1, 0.8, T.z] }, 0.018, 0.018, 0.32, 6, 'y', COL.metal);
  cyl(glow, { c: [T.x - 0.1, 1.0, T.z] }, 0.15, 0.09, 0.2, 10, 'y', rgb(WARM), false); // the shade, lit from inside
  cyl(glow, { c: [T.x - 0.1, 0.96, T.z] }, 0.05, 0.05, 0.1, 6, 'y', rgb(WARM_LIGHT));
  cyl(toon, { c: [NOOK.cup[0], 0.6, NOOK.cup[2]] }, 0.075, 0.075, 0.015, 10, 'y', COL.cup); // saucer
  cyl(toon, { c: [NOOK.cup[0], 0.65, NOOK.cup[2]] }, 0.05, 0.04, 0.085, 10, 'y', COL.cup);
  cyl(toon, { c: [NOOK.cup[0], 0.688, NOOK.cup[2]] }, 0.043, 0.043, 0.004, 10, 'y', COL.cocoa);
  box(toon, { c: [NOOK.cup[0] + 0.065, 0.655, NOOK.cup[2]] }, [0.03, 0.04, 0.012], COL.cup);

  // shelf above the bed, with books and a jar
  box(toon, { c: [-0.9, 1.55, -hz + 0.12] }, [1.3, 0.05, 0.22], COL.logDark);
  box(toon, { c: [-1.4, 1.5, -hz + 0.04] }, [0.04, 0.1, 0.06], COL.metal);
  box(toon, { c: [-0.4, 1.5, -hz + 0.04] }, [0.04, 0.1, 0.06], COL.metal);
  let bx = -1.45;
  COL.book.forEach((c, i) => {
    const bw = 0.05 + r() * 0.04, bh = 0.2 + r() * 0.1;
    box(toon, { c: [bx + bw / 2, 1.575 + bh / 2, -hz + 0.12], rz: i === 4 ? 0.12 : 0 }, [bw, bh, 0.15], c);
    bx += bw + 0.005;
  });
  cyl(toon, { c: [-0.55, 1.67, -hz + 0.12] }, 0.07, 0.07, 0.17, 8, 'y', COL.jar);
  cyl(toon, { c: [-0.55, 1.77, -hz + 0.12] }, 0.05, 0.05, 0.03, 8, 'y', COL.cup);

  // a round rug with a ring
  cyl(toon, { c: [NOOK.rug.x, 0.012, NOOK.rug.z] }, NOOK.rug.r, NOOK.rug.r, 0.024, 24, 'y', COL.rug);
  cyl(toon, { c: [NOOK.rug.x, 0.026, NOOK.rug.z] }, NOOK.rug.r * 0.78, NOOK.rug.r * 0.78, 0.01, 24, 'y', COL.rugRing);

  // the lamp's halo: warm light on the wall behind the lamp, strongest at the shade, gone at the rim
  const hp: [number, number][] = Array.from({ length: 18 }, (_, i) => [Math.cos((i / 18) * Math.PI * 2) * 1.15, Math.sin((i / 18) * Math.PI * 2) * 0.95]);
  const hc = push(halo, { c: [NOOK.lamp[0], NOOK.lamp[1], -hz + 0.015] }, [0, 0, 0], [0, 0, 1], rgb(WARM), 0.42);
  const hf = halo.pos.length / 3;
  for (const p of hp) push(halo, { c: [NOOK.lamp[0], NOOK.lamp[1], -hz + 0.015] }, [p[0], p[1], 0], [0, 0, 1], rgb(WARM), 0);
  for (let i = 0; i < hp.length; i++) halo.idx.push(hc, hf + i, hf + ((i + 1) % hp.length));
  return { toon, glow, halo, door: buildDoor() };
}

// ---------------------------------------------------------------------------
// Smoke and steam: stateless puffs, one Points object each. Numbers per tier (PB particles are for the whole scene, so these are small).
// ---------------------------------------------------------------------------
export type PlumeTier = 'low' | 'mid' | 'high';
export const SMOKE_COUNT: Record<PlumeTier, number> = { low: 14, mid: 24, high: 40 };
export const STEAM_COUNT: Record<PlumeTier, number> = { low: 6, mid: 9, high: 12 };
export const REDUCED_PLUME_SHARE = 0.6;
export const REDUCED_PLUME_TIME = 2.2;

export function plumeCount(base: Record<PlumeTier, number>, tier: PlumeTier, reduced: boolean): number {
  return Math.max(1, Math.round(base[tier] * (reduced ? REDUCED_PLUME_SHARE : 1)));
}

/** Three random numbers per puff (its age offset, a phase, a spread), in random order so a lower tier just draws the first N. */
export function makePlume(seed: number, count: number): Float32Array {
  const rr = rng(seed);
  const out = new Float32Array(count * 3);
  // age offsets spread evenly (a low-discrepancy walk), then shuffled by pairing with random phase; any prefix stays well spread
  const gold = 0.6180339887;
  for (let i = 0; i < count; i++) {
    out[i * 3] = (i * gold + 0.13) % 1;
    out[i * 3 + 1] = rr();
    out[i * 3 + 2] = rr();
  }
  return out;
}

export interface CabinStats {
  toonTriangles: number;
  glowTriangles: number;
  spillTriangles: number;
  doorTriangles: number;
  triangles: number;
  /** outlined meshes cost two draw calls (surface + ink hull) */
  drawCalls: number;
}

export function cabinStats(c: CabinMeshes): CabinStats {
  const t = triCount(c.toon), g = triCount(c.glow), s = triCount(c.spill), d = triCount(c.door);
  // toon x2 (hull), door x2, glow, spill, smoke
  return { toonTriangles: t, glowTriangles: g, spillTriangles: s, doorTriangles: d, triangles: t * 2 + g + s + d * 2, drawCalls: 2 + 2 + 1 + 1 + 1 };
}

export function nookStats(n: NookMeshes): { triangles: number; drawCalls: number } {
  const t = triCount(n.toon), g = triCount(n.glow), h = triCount(n.halo), d = triCount(n.door);
  // toon x2, door x2, glow, halo, steam
  return { triangles: t * 2 + g + h + d * 2, drawCalls: 2 + 2 + 1 + 1 + 1 };
}
