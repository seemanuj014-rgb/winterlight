import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  buildCabin, buildDoor, buildNook, cabinStats, nookStats, triCount, vertCount,
  CABIN, CABIN_FACING_DEG, CABIN_RIDGE_Y, CABIN_SMOKE_ORIGIN, DOOR, NOOK, NOOK_ORIGIN,
  SMOKE_COUNT, STEAM_COUNT, REDUCED_PLUME_SHARE, REDUCED_PLUME_TIME, plumeCount, makePlume,
  type MeshData, type PlumeTier,
} from '../src/world/cabinMath';
import { CABIN_SITE } from '../src/world/groundMath';
import { createCabin } from '../src/world/cabin';
import { createNook } from '../src/world/nook';
import { createDoorProps } from '../src/world/props';

const TIERS: PlumeTier[] = ['low', 'mid', 'high'];

// Budgets from docs/PERF_BUDGET.md (low tier scene), and the Phase 13 ground cost (read from ?world&debug).
const PB_LOW = { calls: 60, triangles: 80_000 };
const GROUND_LOW = { calls: 12, triangles: 25_254 };

const cabin = buildCabin();
const nook = buildNook();
const door = buildDoor();

const meshes: [string, MeshData][] = [
  ['cabin toon', cabin.toon], ['cabin glow', cabin.glow], ['cabin spill', cabin.spill], ['cabin door', cabin.door],
  ['nook toon', nook.toon], ['nook glow', nook.glow], ['nook halo', nook.halo], ['nook door', nook.door],
  ['door', door],
];

/** every triangle whose geometric normal (from its winding) points against the stored vertex normals: the bug that drew the logs black */
function wrongWay(m: MeshData): number {
  let bad = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.idx[t]!, m.idx[t + 1]!, m.idx[t + 2]!];
    const P = (i: number): [number, number, number] => [m.pos[i * 3]!, m.pos[i * 3 + 1]!, m.pos[i * 3 + 2]!];
    const [pa, pb, pc] = [P(a), P(b), P(c)];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const g = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const len = Math.hypot(g[0]!, g[1]!, g[2]!);
    if (len < 1e-12) continue; // a degenerate sliver has no side
    const n = [0, 1, 2].map((k) => (m.nrm[a * 3 + k]! + m.nrm[b * 3 + k]! + m.nrm[c * 3 + k]!) / 3);
    if ((g[0]! * n[0]! + g[1]! * n[1]! + g[2]! * n[2]!) / len < 0) bad++;
  }
  return bad;
}

/** horizontal bounds of the mesh in its own frame */
function extent(m: MeshData): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; maxR: number } {
  const e = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity, maxR: 0 };
  for (let i = 0; i < m.pos.length; i += 3) {
    const [x, y, z] = [m.pos[i]!, m.pos[i + 1]!, m.pos[i + 2]!];
    e.minX = Math.min(e.minX, x); e.maxX = Math.max(e.maxX, x);
    e.minY = Math.min(e.minY, y); e.maxY = Math.max(e.maxY, y);
    e.minZ = Math.min(e.minZ, z); e.maxZ = Math.max(e.maxZ, z);
    e.maxR = Math.max(e.maxR, Math.hypot(x, z));
  }
  return e;
}

describe('mesh data: sane numbers', () => {
  for (const [name, m] of meshes) {
    it(`${name}: arrays line up, indices in range, everything finite`, () => {
      expect(m.pos.length % 3).toBe(0);
      expect(m.nrm.length).toBe(m.pos.length);
      expect(m.idx.length % 3).toBe(0);
      expect(m.idx.length).toBeGreaterThan(0);
      const nv = vertCount(m);
      expect(m.col.length === nv * 3 || m.col.length === nv * 4).toBe(true);
      for (const i of m.idx) {
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(nv);
      }
      for (const arr of [m.pos, m.nrm, m.col]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
    });
    it(`${name}: normals are unit length, colours are 0..1`, () => {
      for (let i = 0; i < m.nrm.length; i += 3) {
        expect(Math.abs(Math.hypot(m.nrm[i]!, m.nrm[i + 1]!, m.nrm[i + 2]!) - 1)).toBeLessThan(1e-3);
      }
      for (const v of m.col) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('winding: no triangle faces the wrong way (the first render drew the log walls black because of this)', () => {
  for (const [name, m] of meshes) {
    // the glow, the halo and the spill are drawn double-sided or additive and unlit, so a flipped face there cannot turn black; only the lit, inked meshes are strict
    const strict = /toon|door/.test(name);
    it(`${name}: ${strict ? '0 wrong-way triangles' : 'at most a few wrong-way triangles (unlit, double-sided)'}`, () => {
      const bad = wrongWay(m);
      if (strict) expect(bad).toBe(0);
      else expect(bad / triCount(m)).toBeLessThan(0.05);
    });
  }
});

describe('the door', () => {
  it('has its hinge at the origin and the panel along +x, DOOR.w wide and DOOR.h tall', () => {
    const e = extent(door);
    expect(e.minX).toBeGreaterThan(-0.05);
    expect(e.maxX).toBeGreaterThan(DOOR.w - 0.05);
    expect(e.maxX).toBeLessThan(DOOR.w + 0.05);
    expect(e.minY).toBeGreaterThanOrEqual(-0.01);
    expect(e.maxY).toBeLessThan(DOOR.h + 0.05);
    expect(e.maxY).toBeGreaterThan(DOOR.h - 0.05);
  });
  it('is the same mesh in the cabin and the nook', () => {
    expect(cabin.door.pos).toEqual(nook.door.pos);
    expect(cabin.door.idx).toEqual(nook.door.idx);
  });
  it('swings up to 105 degrees, and clamps any input, including NaN', () => {
    const c = createCabin({ tier: 'low', reducedMotion: false });
    c.setDoorOpen(0);
    expect(c.door.rotation.y).toBeCloseTo(0, 9);
    c.setDoorOpen(1);
    expect(Math.abs(c.door.rotation.y)).toBeCloseTo((105 * Math.PI) / 180, 6);
    c.setDoorOpen(7);
    expect(c.doorOpen).toBe(1);
    c.setDoorOpen(-3);
    expect(c.doorOpen).toBe(0);
    c.setDoorOpen(Number.NaN);
    expect(c.doorOpen).toBe(0);
    c.dispose();
    const n = createNook({ tier: 'low', reducedMotion: false });
    // the nook door hangs in the right wall, so its shut position is already a quarter turn; it swings 105 degrees from there, into the room
    n.setDoorOpen(0);
    const shut = n.door.rotation.y;
    expect(Math.abs(shut)).toBeCloseTo(Math.PI / 2, 6);
    n.setDoorOpen(1);
    expect(Math.abs(n.door.rotation.y - shut)).toBeCloseTo((105 * Math.PI) / 180, 6);
    n.setDoorOpen(Number.POSITIVE_INFINITY);
    expect(n.doorOpen).toBe(0);
    expect(n.door.rotation.y).toBeCloseTo(shut, 9);
    n.dispose();
  });
});

describe('the cabin, outside', () => {
  it('no log crosses the door opening', () => {
    const left = CABIN.hingeX, right = CABIN.hingeX + DOOR.w;
    const front = cabin.logs.filter((l) => l.axis === 'x' && l.c[2] > 0);
    expect(front.length).toBeGreaterThan(0);
    let checked = 0;
    for (const l of front) {
      if (l.c[1] - CABIN.logR >= DOOR.h) continue; // above the door: runs across, as it should
      checked++;
      const a = l.c[0] - l.len / 2, b = l.c[0] + l.len / 2;
      // the log lies wholly left of the opening or wholly right of it
      expect(b <= left + 1e-6 || a >= right - 1e-6).toBe(true);
    }
    expect(checked).toBeGreaterThan(10);
  });
  it('some logs do run over the top of the door (a lintel course), so the wall is not hollow above it', () => {
    const over = cabin.logs.filter((l) => l.axis === 'x' && l.c[2] > 0 && l.c[0] - l.len / 2 < CABIN.hingeX && l.c[0] + l.len / 2 > CABIN.hingeX + DOOR.w);
    expect(over.length).toBeGreaterThan(0);
  });
  it('the footprint (walls, roof overhang, step, snow mounds, light on the snow) lies inside the cabin clearing', () => {
    for (const m of [cabin.toon, cabin.glow, cabin.spill]) expect(extent(m).maxR).toBeLessThan(CABIN_SITE.radius);
  });
  it('faces the viewer at the origin: its door direction points from the site toward (0, 0)', () => {
    const ry = (CABIN_FACING_DEG * Math.PI) / 180;
    const face = [Math.sin(ry), Math.cos(ry)];
    const want = [-CABIN_SITE.x, -CABIN_SITE.z];
    const l = Math.hypot(want[0]!, want[1]!);
    expect(face[0]! * (want[0]! / l) + face[1]! * (want[1]! / l)).toBeGreaterThan(0.9999);
    const c = createCabin({ tier: 'low', reducedMotion: false });
    expect(c.root.position.x).toBe(CABIN_SITE.x);
    expect(c.root.position.z).toBe(CABIN_SITE.z);
    expect(c.root.position.y).toBe(0);
    expect(c.root.rotation.y).toBeCloseTo(ry, 9);
    c.dispose();
  });
  it('sits on the ground: nothing hangs below the snow by more than the few centimetres the snow mounds are sunk, and it is a believable size (a few metres)', () => {
    const e = extent(cabin.toon);
    expect(e.minY).toBeGreaterThanOrEqual(-0.1);
    expect(e.maxX - e.minX).toBeGreaterThan(5);
    expect(e.maxX - e.minX).toBeLessThan(8);
    expect(e.maxZ - e.minZ).toBeGreaterThan(4);
    expect(e.maxZ - e.minZ).toBeLessThan(8);
  });
  it('the chimney stands above the roof ridge and the smoke starts at its top', () => {
    const ch = CABIN.chimney;
    let top = -Infinity;
    const p = cabin.toon.pos;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i]! - ch.x) < ch.size / 2 + 0.1 && Math.abs(p[i + 2]! - ch.z) < ch.size / 2 + 0.1) top = Math.max(top, p[i + 1]!);
    }
    expect(top).toBeGreaterThan(CABIN_RIDGE_Y + 0.5);
    expect(CABIN_SMOKE_ORIGIN[0]).toBe(ch.x);
    expect(CABIN_SMOKE_ORIGIN[2]).toBe(ch.z);
    expect(CABIN_SMOKE_ORIGIN[1]).toBeGreaterThan(top - 0.2);
    expect(CABIN_SMOKE_ORIGIN[1]).toBeLessThan(top + 0.3);
  });
  it('the doorway glow panel sits inside the thickness of the wall, behind the door and in front of the room', () => {
    const hz = CABIN.hz, logR = CABIN.logR;
    const panelZ = new Set<number>();
    const g = cabin.glow;
    // the doorway panel is the glow vertices whose x lies in the opening and whose y runs from the ground to the door's height
    for (let i = 0; i < g.pos.length; i += 3) {
      const x = g.pos[i]!, y = g.pos[i + 1]!, z = g.pos[i + 2]!;
      if (x >= CABIN.hingeX - 0.1 && x <= CABIN.hingeX + DOOR.w + 0.1 && y <= DOOR.h + 0.01 && Math.abs(z - hz) < 0.3) panelZ.add(Math.round(z * 1e4) / 1e4);
    }
    expect(panelZ.size).toBeGreaterThan(0);
    for (const z of panelZ) {
      expect(z).toBeGreaterThan(hz - logR - 0.01); // not inside the room
      expect(z).toBeLessThan(hz + logR); // not in front of the wall's outer face, where the door's panel is
    }
  });
  it('the warm light is on: windows, doorway and lantern are in the glow mesh and use the warm palette', () => {
    expect(triCount(cabin.glow)).toBeGreaterThan(10);
    let warm = 0;
    for (let i = 0; i < cabin.glow.col.length; i += 3) {
      const [r, gc, b] = [cabin.glow.col[i]!, cabin.glow.col[i + 1]!, cabin.glow.col[i + 2]!];
      if (r > gc && gc > b) warm++;
    }
    expect(warm / (cabin.glow.col.length / 3)).toBeGreaterThan(0.9);
  });
});

describe('the nook, inside', () => {
  it('floats far above the ground and the pines, so it never meets them', () => {
    expect(NOOK_ORIGIN[1]).toBeGreaterThanOrEqual(40);
    const e = extent(nook.toon);
    expect(e.minY).toBeGreaterThanOrEqual(-0.15); // the floor slab's own thickness
    expect(NOOK_ORIGIN[1] + e.minY).toBeGreaterThan(40);
  });
  it('fits its own room: all geometry inside the room box (plus the door swing and a little thickness)', () => {
    const e = extent(nook.toon);
    expect(e.minX).toBeGreaterThan(-NOOK.hx - 0.5);
    expect(e.maxX).toBeLessThan(NOOK.hx + 0.5);
    expect(e.minZ).toBeGreaterThan(-NOOK.hz - 0.5);
    expect(e.maxZ).toBeLessThan(NOOK.hz + 0.5);
    expect(e.maxY).toBeLessThan(NOOK.h + 0.6);
  });
  it('has its open side toward +z: at the front there are only the side-wall ends and the ceiling beams, no wall across the middle', () => {
    const p = nook.toon.pos;
    let frontWallVerts = 0, sideEnds = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 2]! <= NOOK.hz - 0.05) continue;
      if (p[i + 1]! > 0.5 && p[i + 1]! < 2.2 && Math.abs(p[i]!) < NOOK.hx - 0.35) frontWallVerts++; // between the beams and the floor, away from the side walls
      if (Math.abs(p[i]!) >= NOOK.hx - 0.35) sideEnds++;
    }
    expect(frontWallVerts).toBe(0);
    expect(sideEnds).toBeGreaterThan(0); // the side walls do reach the open front
  });
  it('the sleep spot is on the bed and the cat spot beside it; the lamp and the cup are on the table', () => {
    const b = NOOK.bed;
    for (const s of [NOOK.sleepSpot, NOOK.catSpot]) {
      expect(s[1]).toBeGreaterThanOrEqual(b.top);
      expect(s[2]).toBeGreaterThan(b.z - b.wid / 2 - 0.2);
      expect(s[2]).toBeLessThan(b.z + b.wid / 2 + 0.2);
    }
    expect(NOOK.sleepSpot[0]).toBeGreaterThan(b.x - b.len / 2);
    expect(NOOK.sleepSpot[0]).toBeLessThan(b.x + b.len / 2);
    expect(Math.abs(NOOK.lamp[0] - NOOK.table.x)).toBeLessThan(0.5);
    expect(Math.abs(NOOK.cup[0] - NOOK.table.x)).toBeLessThan(0.5);
    expect(NOOK.cup[1]).toBeGreaterThan(0.4);
  });
  it('the lamp halo is additive-friendly: it has an alpha channel and the warm colour', () => {
    expect(nook.halo.col.length).toBe(vertCount(nook.halo) * 4);
    expect(triCount(nook.glow)).toBeGreaterThan(2);
  });
});

describe('cost: draw calls and triangles (PB, low scene 60 calls, 80k triangles)', () => {
  const countScene = (root: THREE.Object3D): { calls: number; triangles: number; points: number } => {
    let calls = 0, triangles = 0, points = 0;
    root.traverse((o) => {
      if (!o.visible) return;
      if (o instanceof THREE.Mesh) {
        calls++;
        const g = o.geometry as THREE.BufferGeometry;
        triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      } else if (o instanceof THREE.Points) {
        calls++;
        points += (o.geometry as THREE.BufferGeometry).drawRange.count === Infinity ? 0 : (o.geometry as THREE.BufferGeometry).drawRange.count;
      }
    });
    return { calls, triangles, points };
  };

  it('the cabin object is 7 draw calls (counted from the real scene graph) and matches its own stats', () => {
    const c = createCabin({ tier: 'low', reducedMotion: false });
    const s = countScene(c.root);
    expect(s.calls).toBe(7);
    expect(c.stats().drawCalls).toBe(7);
    // the ink hulls reuse the geometry, so the scene-graph count equals the stats
    expect(Math.abs(s.triangles - c.stats().triangles)).toBeLessThanOrEqual(2);
    c.dispose();
  });
  it('the nook object is 7 draw calls and matches its own stats', () => {
    const n = createNook({ tier: 'low', reducedMotion: false });
    const s = countScene(n.root);
    expect(s.calls).toBe(7);
    expect(n.stats().drawCalls).toBe(7);
    expect(Math.abs(s.triangles - n.stats().triangles)).toBeLessThanOrEqual(2);
    n.dispose();
  });
  it('the ground plus the cabin fit the low budget with room left for Chamgadad and the animals', () => {
    const cs = cabinStats(cabin);
    expect(GROUND_LOW.calls + cs.drawCalls).toBeLessThanOrEqual(PB_LOW.calls - 30); // Chamgadad is about 30 calls as built
    expect(GROUND_LOW.triangles + cs.triangles).toBeLessThanOrEqual(PB_LOW.triangles - 30_000);
  });
  it('the nook alone (the camera is inside it, the ground is hidden) is far inside the budget', () => {
    const ns = nookStats(nook);
    expect(ns.drawCalls).toBeLessThanOrEqual(10);
    expect(ns.triangles).toBeLessThan(15_000);
  });
  it('each part stays modest (a guard against a runaway primitive)', () => {
    expect(triCount(cabin.toon)).toBeLessThan(8_000);
    expect(triCount(nook.toon)).toBeLessThan(8_000);
    expect(triCount(cabin.door)).toBeLessThan(500);
  });
  it('the cabin and the nook use no textures at all', () => {
    for (const root of [createCabin({ tier: 'low', reducedMotion: false }).root, createNook({ tier: 'low', reducedMotion: false }).root]) {
      root.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          const anyM = m as THREE.Material & { map?: unknown };
          expect(anyM.map ?? null).toBeNull();
        }
      });
    }
  });
});

describe('smoke and steam', () => {
  it('counts per tier grow, and stay small next to the particle budget (PB low 800, with snow and stars)', () => {
    for (const base of [SMOKE_COUNT, STEAM_COUNT]) {
      expect(base.low).toBeLessThan(base.mid);
      expect(base.mid).toBeLessThan(base.high);
    }
    expect(SMOKE_COUNT.low + STEAM_COUNT.low).toBeLessThan(40);
    expect(SMOKE_COUNT.high + STEAM_COUNT.high).toBeLessThan(100);
  });
  it('reduced motion: 0.6 as many puffs (at least 1), 2.2 times slower, and not frozen', () => {
    expect(REDUCED_PLUME_SHARE).toBe(0.6);
    expect(REDUCED_PLUME_TIME).toBe(2.2);
    for (const t of TIERS) {
      for (const base of [SMOKE_COUNT, STEAM_COUNT]) {
        const normal = plumeCount(base, t, false);
        const reduced = plumeCount(base, t, true);
        expect(normal).toBe(base[t]);
        expect(reduced).toBe(Math.round(base[t] * 0.6));
        expect(reduced).toBeGreaterThanOrEqual(1);
        expect(reduced).toBeLessThan(normal);
      }
    }
    expect(REDUCED_PLUME_TIME).toBeGreaterThan(1);
    expect(REDUCED_PLUME_TIME).toBeLessThan(10); // slower, not frozen
  });
  it('the real objects pick those counts for each tier and under reduced motion', () => {
    for (const t of TIERS) {
      const c = createCabin({ tier: t, reducedMotion: false });
      expect(c.stats().smokePuffs).toBe(SMOKE_COUNT[t]);
      c.setReducedMotion(true);
      expect(c.stats().smokePuffs).toBe(plumeCount(SMOKE_COUNT, t, true));
      c.dispose();
      const n = createNook({ tier: t, reducedMotion: true });
      expect(n.stats().steamPuffs).toBe(plumeCount(STEAM_COUNT, t, true));
      n.setReducedMotion(false);
      expect(n.stats().steamPuffs).toBe(STEAM_COUNT[t]);
      n.dispose();
    }
  });
  it('the tier only steps down: a lower tier draws fewer puffs', () => {
    const c = createCabin({ tier: 'high', reducedMotion: false });
    expect(c.stats().smokePuffs).toBe(SMOKE_COUNT.high);
    c.setTier('low');
    expect(c.stats().smokePuffs).toBe(SMOKE_COUNT.low);
    c.dispose();
  });
  it('plume data is deterministic and in range', () => {
    const a = makePlume(614, 40), b = makePlume(614, 40);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('any prefix (what a lower tier draws) is evenly spread in age, so the column has no gaps and no clumps', () => {
    const all = makePlume(614, 40);
    for (const n of [6, 9, 12, 14, 24, 40]) {
      const ages: number[] = [];
      for (let i = 0; i < n; i++) ages.push(all[i * 3]!);
      ages.sort((x, y) => x - y);
      let maxGap = ages[0]! + 1 - ages[n - 1]!;
      for (let i = 1; i < n; i++) maxGap = Math.max(maxGap, ages[i]! - ages[i - 1]!);
      expect(maxGap).toBeLessThan(3 / n);
    }
  });
  it('the puffs are a pure function of time: the shader keeps no state', () => {
    const src = readFileSync('src/world/cabinShaders.ts', 'utf8');
    expect(src).toMatch(/uTime/);
    expect(src).not.toMatch(/\bsampler2D\b/);
  });
});

describe('door props: off by default, and no words in the code', () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  const literals = (s: string): string[] => Array.from(s.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)).map((m) => m[2]!);

  it('a prop with no text, or only blanks, does not exist and cannot be shown', () => {
    for (const text of [{}, { plaque: '', sign: '' }, { plaque: '   ', sign: '\n\t' }, { plaque: undefined, sign: undefined }]) {
      const pivot = new THREE.Group();
      const props = createDoorProps(pivot, text);
      for (const k of ['plaque', 'sign'] as const) {
        expect(props.has(k)).toBe(false);
        expect(props.visible(k)).toBe(false);
        props.setVisible(k, true);
        expect(props.visible(k)).toBe(false);
      }
      expect(pivot.children.length).toBe(0);
      props.dispose();
    }
  });
  it('with text supplied but never shown, nothing is built (no canvas, no mesh): they are off by default', () => {
    const pivot = new THREE.Group();
    const props = createDoorProps(pivot, { plaque: 'sample', sign: 'sample too' });
    expect(props.has('plaque')).toBe(true);
    expect(props.has('sign')).toBe(true);
    expect(props.visible('plaque')).toBe(false);
    expect(props.visible('sign')).toBe(false);
    expect(pivot.children.length).toBe(0);
    props.dispose();
  });
  it('the cabin and the nook create no props of their own', () => {
    const c = createCabin({ tier: 'low', reducedMotion: false });
    const names: string[] = [];
    c.root.traverse((o) => names.push(o.name));
    expect(names.some((n) => /plaque|sign/i.test(n))).toBe(false);
    c.dispose();
  });
  it('props.ts holds no sentence: the only string with a space in it is the font stack', () => {
    const lits = literals(strip(readFileSync('src/world/props.ts', 'utf8')));
    const withWords = lits.filter((s) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(s) && !/sans-serif/.test(s) && !/\$\{p\}px/.test(s));
    expect(withWords).toEqual([]);
  });
  it('no cabin, nook or props source carries a word of the optional door text, even in a comment-free reading', () => {
    for (const f of ['cabinMath', 'cabin', 'nook', 'props', 'meshBuild', 'cabinShaders']) {
      const code = strip(readFileSync(`src/world/${f}.ts`, 'utf8')).toLowerCase();
      expect(code).not.toMatch(/roommate/);
      expect(code).not.toMatch(/\bdr\./);
      expect(code).not.toMatch(/no\s+roommates/);
    }
  });
  it('the test-only text in main.ts comes from the URL, never from a literal', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toMatch(/params\.get\('plaque'\)/);
    expect(main).toMatch(/params\.get\('sign'\)/);
    expect(strip(main).toLowerCase()).not.toMatch(/roommate/);
  });
});

describe('purity and boundaries', () => {
  it('cabinMath.ts and cabinShaders.ts do not import three, and cabinMath has no DOM, clock or Math.random', () => {
    for (const f of ['cabinMath', 'cabinShaders']) {
      const src = readFileSync(`src/world/${f}.ts`, 'utf8');
      expect(src).not.toMatch(/from\s*['"]three/);
      expect(src).not.toMatch(/require\(\s*['"]three/);
    }
    const math = readFileSync('src/world/cabinMath.ts', 'utf8');
    const code = math.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bdocument\.|\bwindow\.|performance\.now|Date\.now|Math\.random/);
  });
  it('the geometry is deterministic: building twice gives identical arrays', () => {
    const a = buildCabin(), b = buildCabin();
    expect(a.toon.pos).toEqual(b.toon.pos);
    expect(a.toon.col).toEqual(b.toon.col);
    const c = buildNook(), d = buildNook();
    expect(c.toon.pos).toEqual(d.toon.pos);
  });
  it('the cabin adds no ink or look to Chamgadad: no character file imports the cabin', () => {
    for (const f of ['src/character/chamgadad/body.ts', 'src/character/chamgadad/head.ts', 'src/character/chamgadad/rig.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/world\/(cabin|nook|props)/);
    }
  });
});
