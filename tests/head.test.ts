import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildHeadParts, sampleFrontZ, boundingRadius, outlineWidthFrac, patchWeight, INK_WORLD, type PartsJson, type BuiltHead } from '../src/character/chamgadad/parts';
import { computeNormals, pointInPolygon, distanceToPolygon, type InflatedMesh } from '../src/character/chamgadad/inflate';
import { rasterizeDepth, depthToMask, unionMasks, dilateMask } from '../src/character/chamgadad/meshMask';
import { FIDELITY_REGIONS, rasterizePolygon, maskIoU } from '../src/character/chamgadad/fidelity';
import { refToWorld, worldToRef, refOrthoBounds, REF_WORLD_SIZE } from '../src/character/refFrame';
import type { Silhouette } from '../src/core/silhouette';

const j = <T,>(f: string) => JSON.parse(readFileSync(f, 'utf8')) as T;
const parts = j<PartsJson>('character/traced/chamgadad_ref_01_head_front.parts.json');
const sil = j<Silhouette>('character/traced/chamgadad_ref_01_head_front.silhouette.json');
const built: BuiltHead = buildHeadParts(parts);
const all: [string, InflatedMesh][] = [
  ['head', built.head], ['neck', built.neck],
  ['upright flap', built.earUpright.flap], ['upright bowl', built.earUpright.bowl],
  ['angled flap', built.earAngled.flap], ['angled bowl', built.earAngled.bowl],
];
const SIZE = 256;

describe('reference frame', () => {
  it('maps the drawing to the world and back, y flipped', () => {
    expect(refToWorld(0.5, 0.5)).toEqual([0, 0]);
    expect(refToWorld(0, 0)).toEqual([-REF_WORLD_SIZE / 2, REF_WORLD_SIZE / 2]);
    const [u, v] = worldToRef(...refToWorld(0.31, 0.77));
    expect(u).toBeCloseTo(0.31, 12);
    expect(v).toBeCloseTo(0.77, 12);
  });
  it('the orthographic frustum shows the whole drawing at any aspect, and exactly the drawing when square', () => {
    expect(refOrthoBounds(1)).toEqual({ left: -2, right: 2, top: 2, bottom: -2 });
    const wide = refOrthoBounds(2);
    expect(wide.right - wide.left).toBe(8);
    expect(wide.top - wide.bottom).toBe(4);
    const tall = refOrthoBounds(0.5);
    expect(tall.right - tall.left).toBe(4);
    expect(tall.top - tall.bottom).toBe(8);
    expect(() => refOrthoBounds(0)).toThrow();
  });
});

describe('parts file (tools/split_parts.py)', () => {
  it('has a head, a neck and two ears each with a bowl, a fold and a base', () => {
    for (const poly of [parts.head.points, parts.neck.points, parts.ear_upright.points, parts.ear_upright.bowl, parts.ear_angled.points, parts.ear_angled.bowl]) {
      expect(poly.length).toBeGreaterThan(20);
      for (const [u, v] of poly) {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(parts.ear_upright.base).toHaveLength(2);
    expect(parts.ear_angled.base).toHaveLength(2);
  });
});

describe('the built head (Phase 6)', () => {
  it('every part is a closed surface with finite numbers', () => {
    for (const [name, m] of all) {
      expect(m.positions.every(Number.isFinite)).toBe(true);
      const edges = new Map<string, number>();
      for (let t = 0; t < m.indices.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const a = m.indices[t + k]!, b = m.indices[t + ((k + 1) % 3)]!;
          const key = a < b ? `${a}_${b}` : `${b}_${a}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      const bad = [...edges.values()].filter((n) => n !== 2).length;
      expect(`${name}: ${bad} open or over-shared edges`).toBe(`${name}: 0 open or over-shared edges`);
    }
  });

  it('no fold-overs: every front triangle faces the viewer in the front view', () => {
    for (const [name, m] of all) {
      const half = m.indices.length / 2;
      let bad = 0;
      for (let t = 0; t < half; t += 3) {
        const a = m.indices[t]!, b = m.indices[t + 1]!, c = m.indices[t + 2]!;
        const ar = (m.positions[b * 3]! - m.positions[a * 3]!) * (m.positions[c * 3 + 1]! - m.positions[a * 3 + 1]!) - (m.positions[c * 3]! - m.positions[a * 3]!) * (m.positions[b * 3 + 1]! - m.positions[a * 3 + 1]!);
        if (!(ar > 0)) bad++;
      }
      expect(`${name}: ${bad} folded triangles`).toBe(`${name}: 0 folded triangles`);
    }
  });

  it('no spikes or pinches: neighbouring faces never turn sharply, except at real corners of the outline', () => {
    for (const [name, m] of all) {
      const rimCount = m.rim.length;
      // rays where the outline itself turns by more than 25 degrees are real corners (crop edge, closures); a crease there is expected
      const corner = new Set<number>();
      for (let i = 0; i < rimCount; i++) {
        const a = m.rim[(i + rimCount - 1) % rimCount]!, c = m.rim[i]!, d = m.rim[(i + 1) % rimCount]!;
        const turn = (Math.atan2((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0]), (c[0] - a[0]) * (d[0] - c[0]) + (c[1] - a[1]) * (d[1] - c[1])) * 180) / Math.PI;
        if (Math.abs(turn) > 25) for (let k = -3; k <= 3; k++) corner.add((i + k + rimCount) % rimCount);
      }
      // ray index of a vertex: front vertices are ring * N + i, back vertices mirror front ring >= 1 (rim vertices are shared)
      const rayOf = (v: number): number => (v < m.backStart ? v % rimCount : (v - m.backStart + rimCount) % rimCount);
      const nTri = m.indices.length / 3;
      const faceN = new Float32Array(nTri * 3);
      for (let t = 0; t < nTri; t++) {
        const a = m.indices[t * 3]!, b = m.indices[t * 3 + 1]!, c = m.indices[t * 3 + 2]!;
        const ux = m.positions[b * 3]! - m.positions[a * 3]!, uy = m.positions[b * 3 + 1]! - m.positions[a * 3 + 1]!, uz = m.positions[b * 3 + 2]! - m.positions[a * 3 + 2]!;
        const vx = m.positions[c * 3]! - m.positions[a * 3]!, vy = m.positions[c * 3 + 1]! - m.positions[a * 3 + 1]!, vz = m.positions[c * 3 + 2]! - m.positions[a * 3 + 2]!;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        faceN[t * 3] = nx / l; faceN[t * 3 + 1] = ny / l; faceN[t * 3 + 2] = nz / l;
      }
      const owner = new Map<string, number>();
      let worst = 0;
      for (let t = 0; t < nTri; t++) {
        for (let k = 0; k < 3; k++) {
          const a = m.indices[t * 3 + k]!, b = m.indices[t * 3 + ((k + 1) % 3)]!;
          if (a < rimCount && b < rimCount) continue; // the rim edge, where front meets back, is meant to be a crease
          const key = a < b ? `${a}_${b}` : `${b}_${a}`;
          const o = owner.get(key);
          if (o === undefined) { owner.set(key, t); continue; }
          const centreV = (v: number) => v === m.backStart - 1 || v === m.positions.length / 3 - 1;
          if ((!centreV(a) && corner.has(rayOf(a))) || (!centreV(b) && corner.has(rayOf(b)))) continue;
          const d = faceN[t * 3]! * faceN[o * 3]! + faceN[t * 3 + 1]! * faceN[o * 3 + 1]! + faceN[t * 3 + 2]! * faceN[o * 3 + 2]!;
          worst = Math.max(worst, (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI);
        }
      }
      // A sphere sampled this coarsely turns up to ~30 degrees between faces at the rim rings; 50 leaves room for real shapes and still catches a spike (the first version had 179).
      expect(`${name}: worst ${worst < 50 ? 'ok' : worst.toFixed(1)}`).toBe(`${name}: worst ok`);
    }
  });

  it('front silhouette of the union equals her silhouette: IoU meets the Phase 5 targets', () => {
    // The meshes' rims are inset by one ink width and the ink hull draws that width back outward, so the drawn silhouette is the surface grown by INK_WORLD.
    const surface = unionMasks(all.map(([, m]) => depthToMask(rasterizeDepth(m.positions, m.indices, SIZE))));
    const mask = dilateMask(surface, SIZE, (INK_WORLD / REF_WORLD_SIZE) * SIZE);
    const truth = rasterizePolygon(sil.points as [number, number][], SIZE);
    const headEars = maskIoU(mask, truth, SIZE, FIDELITY_REGIONS.headAndEars);
    const neck = maskIoU(mask, truth, SIZE, FIDELITY_REGIONS.neckAndChest);
    expect(headEars).toBeGreaterThanOrEqual(FIDELITY_REGIONS.headAndEars.iouMin);
    expect(neck).toBeGreaterThanOrEqual(FIDELITY_REGIONS.neckAndChest.iouMin);
  });

  it('layering in the front view: the head covers the neck and both ears, each bowl covers its flap', () => {
    const depth = new Map(all.map(([n, m]) => [n, rasterizeDepth(m.positions, m.indices, SIZE)] as const));
    const inFront = (front: string, behind: string): [number, number] => {
      const f = depth.get(front)!, b = depth.get(behind)!;
      let both = 0, wrong = 0;
      for (let i = 0; i < f.length; i++) {
        if (f[i]! > -Infinity && b[i]! > -Infinity) {
          both++;
          if (!(f[i]! > b[i]!)) wrong++;
        }
      }
      return [both, wrong];
    };
    for (const behind of ['neck', 'upright flap', 'upright bowl', 'angled flap', 'angled bowl']) {
      const [both, wrong] = inFront('head', behind);
      expect(both).toBeGreaterThan(10);
      expect(`${behind} behind head: ${wrong} wrong pixels`).toBe(`${behind} behind head: 0 wrong pixels`);
    }
    for (const side of ['upright', 'angled']) {
      const [both, wrong] = inFront(`${side} bowl`, `${side} flap`);
      expect(both).toBeGreaterThan(200);
      expect(`${side} bowl in front of flap: ${wrong} wrong pixels`).toBe(`${side} bowl in front of flap: 0 wrong pixels`);
    }
  });

  it('each ear shows a flap band outside the bowl, and both ears stick out past the head', () => {
    const depth = (m: InflatedMesh) => rasterizeDepth(m.positions, m.indices, SIZE);
    const hd = depth(built.head);
    for (const ear of [built.earUpright, built.earAngled]) {
      const fd = depth(ear.flap), bd = depth(ear.bowl);
      let flapOnly = 0, outsideHead = 0;
      for (let i = 0; i < fd.length; i++) {
        if (fd[i]! > -Infinity && bd[i]! === -Infinity && hd[i]! === -Infinity) flapOnly++;
        if (fd[i]! > -Infinity && hd[i]! === -Infinity) outsideHead++;
      }
      expect(flapOnly).toBeGreaterThan(150); // the visible folded-over back, in teal-grey
      expect(outsideHead).toBeGreaterThan(1500);
    }
  });

  it('ears attach at their traced bases: the pivot is on or inside the head', () => {
    for (const ear of [built.earUpright, built.earAngled]) {
      const [x, y] = ear.pivot;
      const inside = pointInPolygon(x, y, built.head.rim);
      expect(inside || distanceToPolygon(x, y, built.head.rim) < 0.06).toBe(true);
    }
  });

  it('the head is deeper in front than behind the neck and ears, and the numbers are sane', () => {
    expect(built.head.frontZMax).toBeGreaterThan(built.neck.frontZMax);
    expect(built.head.frontZMax).toBeGreaterThan(built.earUpright.bowl.frontZMax);
    expect(built.head.frontZMax).toBeLessThan(2);
    for (const [, m] of all) {
      expect(m.frontZMax).toBeGreaterThan(m.backZMin);
    }
    expect(sampleFrontZ(built.head, built.head.centre[0], built.head.centre[1])).toBeGreaterThan(0.5);
  });

  it('normals are finite everywhere (three computes the same ones)', () => {
    for (const [, m] of all) expect(computeNormals(m.positions, m.indices).every(Number.isFinite)).toBe(true);
  });
});

describe('cost and helpers', () => {
  it('the whole head stays cheap: at most 14k triangles (28k with the ink hulls) against PERF_BUDGET low = 80k for the scene', () => {
    const tris = all.reduce((n, [, m]) => n + m.indices.length / 3, 0);
    expect(tris).toBeLessThan(14000);
  });
  it('ink weight is the same in the world for every part: her 10.8 px of 1080', () => {
    expect(INK_WORLD).toBeCloseTo(0.04, 9);
    for (const [, m] of all) {
      const frac = outlineWidthFrac(m);
      expect(frac * boundingRadius(m.positions)).toBeCloseTo(INK_WORLD, 9);
      expect(frac).toBeGreaterThan(0.01);
      expect(frac).toBeLessThan(0.2);
    }
  });
  it('the lavender patch is full in its middle and gone outside it', () => {
    for (const ear of [built.earUpright, built.earAngled]) {
      expect(ear.patch).toBeTruthy();
      const p = ear.patch!;
      expect(patchWeight(p.cx, p.cy, p)).toBeCloseTo(1, 6);
      expect(patchWeight(p.cx + 3 * p.rx, p.cy, p)).toBe(0);
      expect(patchWeight(p.cx, p.cy + 3 * p.ry, p)).toBe(0);
    }
  });
});
