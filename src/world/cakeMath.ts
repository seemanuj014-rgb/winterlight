// Phase 25: the geometry of the snow-table and its small cake, as plain arrays (pure: no three, no DOM, no clock). Built from the Phase 14 primitives into ONE merged,
// ink-lined mesh. Winter, not romantic (CLAUDE_MUST_READ rule 3): a plain round plank table with a cap of snow, a snow-dusted sponge in two layers, little snow dollops and
// a few pine sprigs on top, and five candles (the five names; no age is encoded). No heart, no flower. Units are metres, the same as the world. `[A]`: every size and colour.

import { box, cyl, newMesh, triCount, vertCount, type MeshData, type Vec3 } from './cabinMath';
import { SNOW_LIT, STAGE, terrainHeight } from './groundMath';

export const CAKE_DIMS = {
  tableR: 0.3,
  tableTopY: 0.7,
  plateR: 0.2,
  bottomR: 0.15,
  bottomH: 0.085,
  topR: 0.11,
  topH: 0.07,
  candleH: 0.075,
  candleR: 0.007,
} as const;

const C = {
  wood: 0x6c4a3a,
  woodDark: 0x4d3a30,
  plate: 0xd9e2ec,
  sponge: 0xd9b48a,
  spongeTop: 0xe0be94,
  sprig: 0x4f7a5e,
  wick: 0x2b2f38,
  candle: [0xe8f1f8, 0xb9c7da, 0xe8f1f8, 0x9fb4c8, 0xe8f1f8] as number[],
};

/** where the table stands: on the flat stage clearing, a little off its middle toward the pines, so the camera sees the pines and mountains behind it */
export const CAKE_SITE = { x: 0.35, z: STAGE.z + 1.3 };
export const cakeGroundY = (): number => terrainHeight(CAKE_SITE.x, CAKE_SITE.z);

const TOP_CAP_Y = CAKE_DIMS.tableTopY + 0.0415 + CAKE_DIMS.bottomH + CAKE_DIMS.topH + 0.01; // top of the snow cap on the upper layer, local y

export const CANDLE_COUNT = 5;
/** candle bases on the top cap (local x, z): a shallow arc, so five stand side by side as seen from the front */
export const CAKE_CANDLES: readonly { x: number; z: number }[] = Array.from({ length: CANDLE_COUNT }, (_, k) => {
  const u = k - (CANDLE_COUNT - 1) / 2;
  return { x: u * 0.036, z: 0.006 * u * u - 0.01 };
});
/** the tip of each wick, where its flame is born (local) */
export const FLAME_ANCHORS: readonly Vec3[] = CAKE_CANDLES.map((c) => [c.x, TOP_CAP_Y + CAKE_DIMS.candleH + 0.012, c.z] as Vec3);
/** the whole cake as one touch target: centre (local) and radius (m) */
export const CAKE_TARGET = { centre: [0, TOP_CAP_Y - 0.06, 0] as Vec3, radius: 0.2 };
/** each candle's own touch target radius (m): small candles get a generous reach on screen from the picker's minimum radius */
export const CANDLE_TARGET_R = 0.03;

export function buildCake(): MeshData {
  const m = newMesh();
  const D = CAKE_DIMS;
  // table: a round plank top with a cap of snow, three legs
  cyl(m, { c: [0, D.tableTopY, 0] }, D.tableR, D.tableR, 0.04, 28, 'y', C.wood);
  cyl(m, { c: [0, D.tableTopY + 0.0275, 0] }, D.tableR * 0.97, D.tableR * 0.93, 0.015, 28, 'y', SNOW_LIT);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    cyl(m, { c: [Math.cos(a) * 0.2, (D.tableTopY - 0.02) / 2, Math.sin(a) * 0.2], rz: 0 }, 0.026, 0.02, D.tableTopY - 0.02, 8, 'y', C.woodDark);
  }
  box(m, { c: [0, 0.32, 0], ry: 0.5 }, [0.36, 0.02, 0.03], C.woodDark);
  // plate
  cyl(m, { c: [0, D.tableTopY + 0.0415, 0] }, D.plateR, D.plateR * 0.9, 0.012, 28, 'y', C.plate);
  // two sponge layers and their snow caps
  const y0 = D.tableTopY + 0.0475;
  cyl(m, { c: [0, y0 + D.bottomH / 2, 0] }, D.bottomR, D.bottomR, D.bottomH, 28, 'y', C.sponge);
  cyl(m, { c: [0, y0 + D.bottomH + 0.008, 0] }, D.bottomR * 1.03, D.bottomR, 0.02, 28, 'y', SNOW_LIT);
  const y1 = y0 + D.bottomH + 0.018;
  cyl(m, { c: [0, y1 + D.topH / 2, 0] }, D.topR, D.topR, D.topH, 28, 'y', C.spongeTop);
  cyl(m, { c: [0, y1 + D.topH + 0.004, 0] }, D.topR * 1.04, D.topR, 0.02, 28, 'y', SNOW_LIT);
  // snow dollops round the lower cap's rim
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    cyl(m, { c: [Math.cos(a) * D.bottomR * 0.96, y0 + D.bottomH + 0.03, Math.sin(a) * D.bottomR * 0.96] }, 0.02, 0.008, 0.026, 8, 'y', SNOW_LIT);
  }
  // pine sprigs at the back of the top (away from the candles' arc)
  for (let i = 0; i < 3; i++) {
    const a = Math.PI * (0.35 + 0.15 * i) * -1 - 0.2;
    cyl(m, { c: [Math.cos(a) * 0.07, TOP_CAP_Y + 0.02, Math.sin(a) * 0.07 - 0.02], rz: (i - 1) * 0.15 }, 0.02, 0.0, 0.045, 8, 'y', C.sprig);
  }
  // candles and wicks
  CAKE_CANDLES.forEach((c, k) => {
    cyl(m, { c: [c.x, TOP_CAP_Y + D.candleH / 2, c.z] }, D.candleR, D.candleR, D.candleH, 10, 'y', C.candle[k % C.candle.length]!);
    cyl(m, { c: [c.x, TOP_CAP_Y + D.candleH + 0.005, c.z] }, 0.0022, 0.0022, 0.012, 5, 'y', C.wick);
  });
  return m;
}

export interface CakeStats { triangles: number; vertices: number; drawCalls: number }
export function cakeStats(m: MeshData): CakeStats {
  // body (surface + ink hull) = 2, flames and smoke wisps = 1
  return { triangles: triCount(m) * 2, vertices: vertCount(m), drawCalls: 3 };
}

// ---------------------------------------------------------------------------
// Flames: how many, how big, per tier (they are Points, one draw call for flames and wisps together)
// ---------------------------------------------------------------------------
export const FLAME = {
  /** height of a lit flame in metres */
  height: 0.05,
  /** screen size of the point sprite is this many times the flame height (the shader cuts the teardrop out of it) */
  spriteScale: 2.6,
  core: 0xffd9a0,
  edge: 0xffb86b,
  /** the soft smoke wisp after a candle goes out: lasts this long (s) */
  wispLife: 2.4,
  wispRise: 0.16,
  wispColor: 0xb9c7da,
} as const;

/** the camera for the cake view: a little above the cake, looking at it; wide enough to frame it on a narrow phone, never closer than a metre and a half on a wide screen */
export function cakeCamera(aspect: number): { eye: Vec3; look: Vec3; fovDeg: number } {
  const a = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 0.5;
  const fov = 36;
  const t = Math.tan((fov * Math.PI) / 360);
  const dist = Math.max(0.33 / (t * Math.min(a, 1.2)), 0.52 / t);
  const gy = cakeGroundY();
  const look: Vec3 = [CAKE_SITE.x, gy + TOP_CAP_Y - 0.1, CAKE_SITE.z];
  return { eye: [CAKE_SITE.x + 0.12, gy + TOP_CAP_Y + 0.12, CAKE_SITE.z + dist], look, fovDeg: fov };
}
export const CAKE_TOP_Y = TOP_CAP_Y;
