import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeNoiseTexels } from '../src/render/toon/noise';
import { RAMP_SOFT3, RAMP_SOFT4, buildRampTexels } from '../src/render/toon/ramp';
import { buildOutlineNormals, MIN_TAPER } from '../src/render/toon/weld';
import { makeToon, patchToonFragment } from '../src/render/toon/material';
import { patchOutlineVertex, prepareOutlineGeometry } from '../src/render/toon/outline';

describe('baked noise', () => {
  const N = 64;
  const a = makeNoiseTexels(N, 7);
  it('is deterministic and seed-dependent', () => {
    expect(Array.from(makeNoiseTexels(N, 7))).toEqual(Array.from(a));
    expect(Array.from(makeNoiseTexels(N, 8))).not.toEqual(Array.from(a));
  });
  it('is RGBA with opaque alpha and real variation in R, G, B', () => {
    expect(a.length).toBe(N * N * 4);
    for (let c = 0; c < 3; c++) {
      let min = 255, max = 0;
      for (let i = 0; i < N * N; i++) {
        const v = a[i * 4 + c]!;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(max - min).toBeGreaterThan(100);
    }
    expect(a[3]).toBe(255);
  });
  it('tiles: the seam is no rougher than the interior', () => {
    let seam = 0, inner = 0;
    for (let y = 0; y < N; y++) {
      seam += Math.abs(a[(y * N + (N - 1)) * 4]! - a[(y * N) * 4]!);
      inner += Math.abs(a[(y * N + 31) * 4]! - a[(y * N + 32) * 4]!);
    }
    expect(seam).toBeLessThanOrEqual(inner * 2 + 64);
  });
});

describe('ramp', () => {
  const lum = (t: Uint8Array, i: number): number => t[i * 4]! + t[i * 4 + 1]! + t[i * 4 + 2]!;
  it('is non-decreasing from dark to light, starts at the darkest step and ends on the base colour', () => {
    for (const spec of [RAMP_SOFT4, RAMP_SOFT3]) {
      const t = buildRampTexels(spec, 64);
      for (let i = 1; i < 64; i++) expect(lum(t, i)).toBeGreaterThanOrEqual(lum(t, i - 1));
      expect(Array.from(t.slice(0, 3))).toEqual(spec.steps[0]!.mul.map((m) => Math.round(m * 255)));
      expect(Array.from(t.slice(63 * 4, 63 * 4 + 3))).toEqual([255, 255, 255]);
    }
  });
  it('has flat plateaus (cel steps), not a smooth gradient: 4 and 3 distinct levels', () => {
    const levels = (spec: typeof RAMP_SOFT4): number => {
      const t = buildRampTexels(spec, 256);
      const runs: number[] = [];
      let run = 1;
      for (let i = 1; i < 256; i++) {
        if (lum(t, i) === lum(t, i - 1)) run++;
        else {
          runs.push(run);
          run = 1;
        }
      }
      runs.push(run);
      return runs.filter((r) => r >= 8).length; // long flat runs = steps
    };
    expect(levels(RAMP_SOFT4)).toBe(4);
    expect(levels(RAMP_SOFT3)).toBe(3);
  });
  it('needs at least one step', () => {
    expect(() => buildRampTexels({ steps: [], softness: 0.05 })).toThrow();
  });
});

describe('outline normals (weld)', () => {
  // A cube corner as three separate faces: same position, three different normals.
  const pos = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const nor = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  it('gives coincident vertices one shared, averaged normal', () => {
    const o = buildOutlineNormals(pos, nor, 1e-4);
    const k = 1 / Math.sqrt(3);
    for (let i = 0; i < 3; i++) {
      expect(o[i * 4]).toBeCloseTo(k, 5);
      expect(o[i * 4 + 1]).toBeCloseTo(k, 5);
      expect(o[i * 4 + 2]).toBeCloseTo(k, 5);
    }
  });
  it('tapers sharp corners but never below the minimum', () => {
    const o = buildOutlineNormals(pos, nor, 1e-4);
    expect(o[3]).toBeLessThan(1);
    expect(o[3]).toBeGreaterThanOrEqual(MIN_TAPER - 1e-6);
  });
  it('leaves smooth surfaces at full width', () => {
    const o = buildOutlineNormals([0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 1], 1e-4);
    expect(o[3]).toBeCloseTo(1, 5);
  });
  it('does not weld vertices that are apart', () => {
    const o = buildOutlineNormals([0, 0, 0, 5, 0, 0], [0, 1, 0, 0, 0, 1], 1e-4);
    expect([o[0], o[1], o[2]]).toEqual([0, 1, 0]);
    expect([o[4], o[5], o[6]]).toEqual([0, 0, 1]);
  });
  it('survives opposite normals (a flat double-sided sheet)', () => {
    const o = buildOutlineNormals([0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, -1], 1e-4);
    expect(Number.isFinite(o[0]! + o[1]! + o[2]! + o[3]!)).toBe(true);
  });
});

describe('shader patches match the installed three.js', () => {
  it('toon fragment patch applies and keeps three\'s opaque_fragment include', () => {
    const out = patchToonFragment(THREE.ShaderLib.toon.fragmentShader, THREE.ShaderChunk.gradientmap_pars_fragment);
    expect(out).toContain('uRimColor');
    expect(out).toContain('texture2D( gradientMap, coord ).rgb');
    expect(out).toContain('#include <opaque_fragment>');
  });
  it('outline vertex patch applies on MeshBasicMaterial\'s vertex shader', () => {
    const out = patchOutlineVertex(THREE.ShaderLib.basic.vertexShader);
    expect(out).toContain('attribute vec4 aOutline;');
    expect(out).toContain('gl_Position = projectionMatrix * mvPosition;');
  });
  it('the patches fail loudly if the shaders change', () => {
    expect(() => patchToonFragment('void main(){}', '')).toThrow();
    expect(() => patchOutlineVertex('void main(){}')).toThrow();
  });
});

describe('makeToon', () => {
  it('builds a mesh with an ink hull child that shares the geometry and is drawn back-face only', () => {
    const toon = makeToon({ base: '#a7b9c3' });
    const g = new THREE.SphereGeometry(1, 16, 12);
    const m = toon.mesh(g);
    const hull = m.userData.outline as THREE.Mesh;
    expect(hull.parent).toBe(m);
    expect(hull.geometry).toBe(g);
    expect((hull.material as THREE.MeshBasicMaterial).side).toBe(THREE.BackSide);
    expect((hull.material as THREE.MeshBasicMaterial).color.getHexString()).toBe(new THREE.Color('#010102').getHexString());
    expect(g.getAttribute('aOutline').count).toBe(g.getAttribute('position').count);
    expect(g.getAttribute('aOutline').itemSize).toBe(4);
    toon.dispose();
  });
  it('outline:false gives a bare mesh', () => {
    const toon = makeToon({ base: '#ffffff', outline: false });
    const m = toon.mesh(new THREE.SphereGeometry(1, 8, 6));
    expect(m.children).toHaveLength(0);
  });
  it('a closed mesh with hard edges keeps one welded normal per position (no hull gaps)', () => {
    const g = new THREE.ConeGeometry(0.9, 2, 24, 1);
    prepareOutlineGeometry(g);
    const pos = g.getAttribute('position'), out = g.getAttribute('aOutline');
    const seen = new Map<string, string>();
    for (let i = 0; i < pos.count; i++) {
      const k = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => v.toFixed(4)).join(',');
      const v = [out.getX(i), out.getY(i), out.getZ(i)].map((n) => n.toFixed(4)).join(',');
      if (seen.has(k)) expect(v).toBe(seen.get(k));
      else seen.set(k, v);
    }
  });
  it('different outlines get different noise seeds', () => {
    const toon = makeToon({ base: '#ffffff' });
    const a = toon.mesh(new THREE.SphereGeometry(1, 8, 6)).userData.outline as THREE.Mesh;
    const b = toon.mesh(new THREE.SphereGeometry(1, 8, 6)).userData.outline as THREE.Mesh;
    const seed = (h: THREE.Mesh): number => (h.material as THREE.Material).userData.outlineUniforms.uSeed.value as number;
    expect(seed(a)).not.toBe(seed(b));
  });
});
