import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  makeNoise2D, terrainHeight, clearingMask, STAGE, CABIN_SITE, TERRAIN_RADIUS, TERRAIN_RINGS, TERRAIN_SECTORS, buildTerrain, ringRadius,
  SNOW_COUNT, SNOW_BOX, PARTICLE_BUDGET, REDUCED_SNOW_SHARE, snowCount, makeFlakes, WIND, windDisplacement, particleShare,
  PINE_COUNT, PINE_MIN_RADIUS, PINE_MAX_RADIUS, PINE_SPACING, PINE_MAX_ELEVATION_DEG, maxPineHeight, placePines, buildPineGeometry, pineMatrix,
  PINE_TIERS, PINE_SEGMENTS, buildShadows, shadowDirection, SHADOW_TRIS_PER_PINE, groundStats, elevationFromEye, nearestRidgeFloorDeg,
  SNOW_LIT, SNOW_SHADOW, PINE, PINE_SNOW, GROUND_FOG, SPARKLE_STRENGTH, type Tier,
} from '../src/world/groundMath';
import { MOON_ELEVATION_DEG, MOON_RADIUS_DEG, EYE_HEIGHT, STAR_COUNT, MOUNTAIN_LAYERS, hexToRgb } from '../src/world/backdropMath';
import { settingsFor } from '../src/core/quality';

const TIERS: Tier[] = ['low', 'mid', 'high'];

describe('noise', () => {
  it('2D value noise is deterministic, bounded and smooth for any input', () => {
    const a = makeNoise2D(9), b = makeNoise2D(9);
    for (const [x, y] of [[0, 0], [1.5, -2.25], [-1e5, 3e5], [17.9, 0.001]] as [number, number][]) {
      expect(a(x, y)).toBe(b(x, y));
      expect(a(x, y)).toBeGreaterThanOrEqual(0);
      expect(a(x, y)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(a(4.5, 4.5) - a(4.5001, 4.5001))).toBeLessThan(0.01);
  });
});

describe('terrain height', () => {
  it('is exactly flat (y = 0) inside the stage and the cabin site, so the cast and the cabin stand level', () => {
    for (const c of [STAGE, CABIN_SITE]) {
      for (let a = 0; a < 360; a += 15) {
        for (const f of [0, 0.5, 0.98]) {
          const x = c.x + Math.cos((a * Math.PI) / 180) * c.radius * f;
          const z = c.z + Math.sin((a * Math.PI) / 180) * c.radius * f;
          expect(terrainHeight(x, z)).toBe(0);
        }
      }
    }
    expect(terrainHeight(0, 0)).toBe(0); // under the camera
    expect(clearingMask(STAGE.x, STAGE.z)).toBe(0);
    expect(clearingMask(0, -60)).toBe(1);
  });
  it('is finite everywhere on the disc, and rolls: real drifts, real foothills, nothing wild', () => {
    let lo = Infinity, hi = -Infinity;
    for (let r = 0; r <= TERRAIN_RADIUS; r += 0.75) {
      for (let a = 0; a < 360; a += 4) {
        const h = terrainHeight(Math.sin((a * Math.PI) / 180) * r, -Math.cos((a * Math.PI) / 180) * r);
        expect(Number.isFinite(h)).toBe(true);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    expect(hi).toBeGreaterThan(0.6); // foothills toward the mountains
    expect(hi).toBeLessThan(2.2);
    expect(lo).toBeGreaterThan(-0.9); // dips between drifts, never a pit
    expect(lo).toBeLessThan(-0.05); // and there ARE dips
  });
  it('is soft: no step larger than a gentle slope over 10 cm', () => {
    let worst = 0;
    for (let x = -30; x <= 30; x += 1.3) {
      for (let z = -30; z <= 30; z += 1.7) {
        worst = Math.max(worst, Math.abs(terrainHeight(x + 0.1, z) - terrainHeight(x, z)), Math.abs(terrainHeight(x, z + 0.1) - terrainHeight(x, z)));
      }
    }
    expect(worst).toBeLessThan(0.05); // a slope of 0.5 at the very steepest
  });
  it('the ground never rises into the nearest mountain layer: seen from the eye it stays under that layer\'s lowest ridge', () => {
    let worst = -Infinity;
    for (let r = 4; r <= TERRAIN_RADIUS; r += 0.5) {
      for (let a = 0; a < 360; a += 3) {
        const x = Math.sin((a * Math.PI) / 180) * r;
        const z = -Math.cos((a * Math.PI) / 180) * r;
        worst = Math.max(worst, elevationFromEye(r, terrainHeight(x, z)));
      }
    }
    expect(worst).toBeLessThan(nearestRidgeFloorDeg());
    expect(TERRAIN_RADIUS).toBeLessThan(MOUNTAIN_LAYERS[MOUNTAIN_LAYERS.length - 1]!.dist); // the ground ends just short of the nearest mountains
  });
});

describe('terrain mesh', () => {
  const t = buildTerrain();
  it('has the counts the constants promise, finite numbers and valid indices', () => {
    expect(t.vertexCount).toBe(1 + TERRAIN_RINGS * TERRAIN_SECTORS);
    expect(t.position.length).toBe(t.vertexCount * 3);
    expect(t.normal.length).toBe(t.vertexCount * 3);
    expect(t.triangles).toBe(TERRAIN_SECTORS + (TERRAIN_RINGS - 1) * TERRAIN_SECTORS * 2);
    for (const v of t.position) expect(Number.isFinite(v)).toBe(true);
    for (let i = 0; i < t.index.length; i++) expect(t.index[i]!).toBeLessThan(t.vertexCount);
    expect(t.vertexCount).toBeLessThan(65536); // 16-bit indices
  });
  it('vertices lie on the height function, the outer ring is at the terrain radius, and rings get coarser outward', () => {
    for (let v = 0; v < t.vertexCount; v += 97) {
      expect(t.position[v * 3 + 1]!).toBeCloseTo(terrainHeight(t.position[v * 3]!, t.position[v * 3 + 2]!), 5);
    }
    const last = t.vertexCount - 1;
    expect(Math.hypot(t.position[last * 3]!, t.position[last * 3 + 2]!)).toBeCloseTo(TERRAIN_RADIUS, 3);
    let prev = 0;
    for (let i = 1; i <= TERRAIN_RINGS; i++) {
      const step = ringRadius(i) - ringRadius(i - 1);
      expect(step).toBeGreaterThan(prev - 1e-9);
      prev = step;
    }
    expect(ringRadius(TERRAIN_RINGS - 1) - ringRadius(TERRAIN_RINGS - 2)).toBeLessThan(2); // far rings are still under two metres apart
  });
  it('normals are unit length and point up (the ground is a hill, never an overhang)', () => {
    for (let v = 0; v < t.vertexCount; v++) {
      const l = Math.hypot(t.normal[v * 3]!, t.normal[v * 3 + 1]!, t.normal[v * 3 + 2]!);
      expect(l).toBeCloseTo(1, 4);
      expect(t.normal[v * 3 + 1]!).toBeGreaterThan(0.7);
    }
  });
  it('every triangle faces up (counter-clockwise seen from above, so it is not culled)', () => {
    for (let k = 0; k < t.index.length; k += 3) {
      const [a, b, c] = [t.index[k]!, t.index[k + 1]!, t.index[k + 2]!];
      const ux = t.position[b * 3]! - t.position[a * 3]!, uz = t.position[b * 3 + 2]! - t.position[a * 3 + 2]!;
      const vx = t.position[c * 3]! - t.position[a * 3]!, vz = t.position[c * 3 + 2]! - t.position[a * 3 + 2]!;
      expect(uz * vx - ux * vz).toBeGreaterThan(0); // y component of the cross product, the flat projection
    }
  });
});

describe('snowfall', () => {
  it('counts are tier-aware, grow with the tier, and halve under reduced motion', () => {
    expect(SNOW_COUNT.low).toBeLessThan(SNOW_COUNT.mid);
    expect(SNOW_COUNT.mid).toBeLessThan(SNOW_COUNT.high);
    for (const t of TIERS) {
      expect(snowCount(t, false)).toBe(SNOW_COUNT[t]);
      expect(snowCount(t, true)).toBe(Math.ceil(SNOW_COUNT[t] * REDUCED_SNOW_SHARE));
      expect(snowCount(t, true)).toBeLessThan(snowCount(t, false));
    }
  });
  it('stars plus snow stay inside the PB particle budget with room left for lanterns, glitter and sparks (at most 85 percent)', () => {
    for (const t of TIERS) {
      expect(PARTICLE_BUDGET[t]).toBe(settingsFor(t).maxParticles);
      expect(STAR_COUNT[t] + SNOW_COUNT[t]).toBeLessThanOrEqual(PARTICLE_BUDGET[t] * 0.85);
      expect(particleShare(t, false)).toBeLessThanOrEqual(0.85);
      expect(particleShare(t, true)).toBeLessThan(particleShare(t, false));
    }
  });
  it('the air box gets smaller and sparser on a weaker tier, and the density is calm', () => {
    for (const t of TIERS) {
      const b = SNOW_BOX[t];
      const density = SNOW_COUNT[t] / (b.w * b.d * b.h);
      expect(density).toBeGreaterThan(0.02);
      expect(density).toBeLessThan(0.07);
    }
    expect(SNOW_BOX.low.w).toBeLessThan(SNOW_BOX.high.w);
  });
  it('flakes are deterministic, in range, and any prefix is evenly scattered (a tier step-down just draws fewer)', () => {
    const a = makeFlakes(31), b = makeFlakes(31);
    expect(Array.from(a.base)).toEqual(Array.from(b.base));
    for (let i = 0; i < a.count; i++) {
      expect(a.speed[i]!).toBeGreaterThanOrEqual(0.5);
      expect(a.speed[i]!).toBeLessThanOrEqual(1.1);
      expect(a.size[i]!).toBeGreaterThan(1.5);
      expect(a.size[i]!).toBeLessThan(6.5);
      expect(a.windK[i]!).toBeGreaterThanOrEqual(0.7);
      expect(a.windK[i]!).toBeLessThanOrEqual(1.3);
      for (let k = 0; k < 3; k++) {
        expect(a.base[i * 3 + k]!).toBeGreaterThanOrEqual(0);
        expect(a.base[i * 3 + k]!).toBeLessThan(1);
      }
    }
    for (const n of [SNOW_COUNT.low, SNOW_COUNT.mid]) {
      // each octant of the box holds close to its share of the first n flakes
      const cells = new Array(8).fill(0);
      for (let i = 0; i < n; i++) cells[(a.base[i * 3]! > 0.5 ? 1 : 0) + (a.base[i * 3 + 1]! > 0.5 ? 2 : 0) + (a.base[i * 3 + 2]! > 0.5 ? 4 : 0)]++;
      for (const c of cells) expect(Math.abs(c - n / 8)).toBeLessThan(n / 8 * 0.45);
    }
  });
  it('the wind is slow, smooth, continuous, and gone (a steady drift only) under reduced motion', () => {
    expect(windDisplacement(0, false)).toBe(0);
    let maxV = 0, prev = 0;
    for (let t = 0.05; t < 600; t += 0.05) {
      const w = windDisplacement(t, false);
      maxV = Math.max(maxV, Math.abs(w - prev) / 0.05);
      prev = w;
    }
    expect(maxV).toBeLessThanOrEqual(WIND.base + WIND.gust + 1e-6); // never more than 0.75 m/s
    expect(maxV).toBeGreaterThan(WIND.base - WIND.gust - 1e-6);
    expect(windDisplacement(10, false)).toBeGreaterThan(0); // blows toward +x
    for (const t of [3, 120]) expect(windDisplacement(t, true)).toBeCloseTo(WIND.reducedBase * t, 9);
    expect(windDisplacement(NaN, false)).toBe(0);
    expect(windDisplacement(Infinity, true)).toBe(0);
  });
});

describe('pines', () => {
  const all = placePines(PINE_COUNT.high);
  it('places the full count of the high tier, deterministically', () => {
    expect(all.count).toBe(PINE_COUNT.high);
    const again = placePines(PINE_COUNT.high);
    expect(Array.from(again.x)).toEqual(Array.from(all.x));
    expect(Array.from(again.height)).toEqual(Array.from(all.height));
  });
  it('counts grow with the tier and the lower tiers are the first trees of the high one (a step-down only draws fewer)', () => {
    expect(PINE_COUNT.low).toBeLessThan(PINE_COUNT.mid);
    expect(PINE_COUNT.mid).toBeLessThan(PINE_COUNT.high);
    const low = placePines(PINE_COUNT.low);
    for (let i = 0; i < low.count; i++) {
      expect(low.x[i]!).toBe(all.x[i]!);
      expect(low.z[i]!).toBe(all.z[i]!);
    }
  });
  it('no tree stands in the stage or the cabin site, all are in the forest band, and none touch', () => {
    for (let i = 0; i < all.count; i++) {
      for (const c of [STAGE, CABIN_SITE]) expect(Math.hypot(all.x[i]! - c.x, all.z[i]! - c.z)).toBeGreaterThan(c.radius + 1.5);
      const r = Math.hypot(all.x[i]!, all.z[i]!);
      expect(r).toBeGreaterThanOrEqual(PINE_MIN_RADIUS - 1e-3);
      expect(r).toBeLessThanOrEqual(PINE_MAX_RADIUS + 1e-3);
    }
    for (let i = 0; i < all.count; i++) for (let j = i + 1; j < all.count; j++) expect(Math.hypot(all.x[i]! - all.x[j]!, all.z[i]! - all.z[j]!)).toBeGreaterThanOrEqual(PINE_SPACING - 1e-6);
  });
  it('feet stand on the snow (a hair below the surface) and the trees are a sane size', () => {
    for (let i = 0; i < all.count; i++) {
      expect(all.y[i]!).toBeCloseTo(terrainHeight(all.x[i]!, all.z[i]!) - 0.05, 5);
      expect(all.height[i]!).toBeGreaterThanOrEqual(3);
      expect(all.height[i]!).toBeLessThanOrEqual(8 + 1e-6);
      expect(all.height[i]!).toBeLessThanOrEqual(maxPineHeight(Math.hypot(all.x[i]!, all.z[i]!)) + 1e-6);
      expect(all.width[i]!).toBeGreaterThanOrEqual(0.85);
      expect(all.width[i]!).toBeLessThanOrEqual(1.15);
    }
  });
  it('the sky stays open: no tree, seen from the eye, rises above the pine elevation limit, which is well under the moon', () => {
    expect(PINE_MAX_ELEVATION_DEG).toBeLessThan(MOON_ELEVATION_DEG - MOON_RADIUS_DEG);
    for (let i = 0; i < all.count; i++) {
      const r = Math.hypot(all.x[i]!, all.z[i]!);
      expect(elevationFromEye(r, all.y[i]! + all.height[i]!)).toBeLessThanOrEqual(PINE_MAX_ELEVATION_DEG);
    }
  });
  it('they are spread round the valley, in front more than behind, not in one lump', () => {
    let front = 0, left = 0;
    for (let i = 0; i < all.count; i++) {
      if (all.z[i]! < 0) front++;
      if (all.x[i]! < 0) left++;
    }
    expect(front).toBeGreaterThan(all.count * 0.55);
    expect(left).toBeGreaterThan(all.count * 0.25);
    expect(left).toBeLessThan(all.count * 0.75);
  });
  it('the unit pine is a closed-looking tree of five tiers: finite, indexed, unit normals, snow and tier in range, height 0 to 1', () => {
    const g = buildPineGeometry();
    expect(g.position.length).toBe(g.vertexCount * 3);
    expect(g.normal.length).toBe(g.vertexCount * 3);
    expect(g.aSnow.length).toBe(g.vertexCount);
    expect(g.aTier.length).toBe(g.vertexCount);
    let minY = Infinity, maxY = -Infinity, maxR = 0;
    for (let v = 0; v < g.vertexCount; v++) {
      for (let k = 0; k < 3; k++) expect(Number.isFinite(g.position[v * 3 + k]!)).toBe(true);
      expect(Math.hypot(g.normal[v * 3]!, g.normal[v * 3 + 1]!, g.normal[v * 3 + 2]!)).toBeCloseTo(1, 4);
      expect(g.aSnow[v]!).toBeGreaterThanOrEqual(0);
      expect(g.aSnow[v]!).toBeLessThanOrEqual(1);
      expect(g.aTier[v]!).toBeGreaterThanOrEqual(0);
      expect(g.aTier[v]!).toBeLessThanOrEqual(1);
      minY = Math.min(minY, g.position[v * 3 + 1]!);
      maxY = Math.max(maxY, g.position[v * 3 + 1]!);
      maxR = Math.max(maxR, Math.hypot(g.position[v * 3]!, g.position[v * 3 + 2]!));
    }
    for (let i = 0; i < g.index.length; i++) expect(g.index[i]!).toBeLessThan(g.vertexCount);
    expect(minY).toBeCloseTo(0, 6);
    expect(maxY).toBeCloseTo(1, 6);
    expect(maxR).toBeCloseTo(0.3, 6);
    expect(g.triangles).toBe(PINE_TIERS * PINE_SEGMENTS * 2 + 12);
  });
  it('every face of the unit pine looks outward (counter-clockwise from outside, so nothing is culled by mistake)', () => {
    const g = buildPineGeometry();
    for (let k = 0; k < g.index.length; k += 3) {
      const [a, b, c] = [g.index[k]!, g.index[k + 1]!, g.index[k + 2]!];
      const P = (v: number): number[] => [g.position[v * 3]!, g.position[v * 3 + 1]!, g.position[v * 3 + 2]!];
      const pa = P(a), pb = P(b), pc = P(c);
      const u = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
      const v = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      // the geometric face normal must agree with the vertex normals it was built with
      const vn = [0, 1, 2].map((q) => (g.normal[a * 3 + q]! + g.normal[b * 3 + q]! + g.normal[c * 3 + q]!) / 3);
      expect(n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]!).toBeGreaterThan(0);
    }
  });
  it('snow lies on the upper part of every tier and never on an underside or the trunk', () => {
    const g = buildPineGeometry();
    let tops = 0;
    for (let v = 0; v < g.vertexCount; v++) {
      if (g.aSnow[v]! > 0.99) {
        tops++;
        expect(g.normal[v * 3 + 1]!).toBeGreaterThan(0); // a tip, with an upward-leaning normal
      }
      if (g.normal[v * 3 + 1]! <= -0.99) expect(g.aSnow[v]!).toBe(0);
    }
    expect(tops).toBe(PINE_TIERS * PINE_SEGMENTS);
  });
  it('a pine\'s matrix puts the foot at its place and the tip at foot plus height; the matrix is rotation times scale', () => {
    const m = new Float32Array(16);
    for (const i of [0, 5, 77, 219]) {
      pineMatrix(all, i, m);
      expect(m[12]!).toBeCloseTo(all.x[i]!, 5);
      expect(m[13]!).toBeCloseTo(all.y[i]!, 5);
      expect(m[14]!).toBeCloseTo(all.z[i]!, 5);
      const H = all.height[i]!, W = H * all.width[i]!;
      expect(Math.hypot(m[0]!, m[1]!, m[2]!)).toBeCloseTo(W, 4);
      expect(Math.hypot(m[4]!, m[5]!, m[6]!)).toBeCloseTo(H, 4);
      expect(Math.hypot(m[8]!, m[9]!, m[10]!)).toBeCloseTo(W, 4);
      expect(m[5]!).toBeCloseTo(H, 5); // straight up
    }
  });
});

describe('blob shadows', () => {
  const p = placePines(PINE_COUNT.high);
  const s = buildShadows(p);
  it('one soft ellipse per tree, in whole blocks so a prefix is a smaller forest', () => {
    expect(s.triangles).toBe(p.count * SHADOW_TRIS_PER_PINE);
    expect(s.index.length).toBe(p.count * SHADOW_TRIS_PER_PINE * 3);
    for (let i = 0; i < s.index.length; i++) expect(s.index[i]!).toBeLessThan(s.vertexCount);
    for (const v of s.position) expect(Number.isFinite(v)).toBe(true);
    for (const e of s.aEdge) {
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });
  it('fall away from the moon (toward the camera, a hair to the right), lie on the snow, and every triangle faces up', () => {
    const [sx, sz] = shadowDirection();
    expect(sz).toBeGreaterThan(0.9);
    expect(sx).toBeGreaterThan(0);
    expect(Math.hypot(sx, sz)).toBeCloseTo(1, 6);
    for (let v = 0; v < s.vertexCount; v += 13) expect(s.position[v * 3 + 1]!).toBeCloseTo(terrainHeight(s.position[v * 3]!, s.position[v * 3 + 2]!) + 0.06, 5);
    for (let k = 0; k < s.index.length; k += 3) {
      const [a, b, c] = [s.index[k]!, s.index[k + 1]!, s.index[k + 2]!];
      const ux = s.position[b * 3]! - s.position[a * 3]!, uz = s.position[b * 3 + 2]! - s.position[a * 3 + 2]!;
      const vx = s.position[c * 3]! - s.position[a * 3]!, vz = s.position[c * 3 + 2]! - s.position[a * 3 + 2]!;
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });
});

describe('cost against the performance budget (PB)', () => {
  const pine = buildPineGeometry();
  const terrain = buildTerrain();
  // the Phase 12 backdrop: 8 draw calls and 4,794 triangles (measured then, read from ?world&debug)
  const BACKDROP = { drawCalls: 8, triangles: 4794 };
  const PB = {
    low: { calls: 60, tris: 80_000, particles: 800 },
    mid: { calls: 90, tris: 150_000, particles: 2500 },
    high: { calls: 130, tris: 250_000, particles: 6000 },
  } as const;
  it('backdrop plus ground stays well inside the draw-call, triangle and particle budgets at every tier, reduced motion or not', () => {
    for (const t of TIERS) {
      for (const reduced of [false, true]) {
        const g = groundStats(t, reduced, pine, terrain);
        expect(g.drawCalls).toBe(4);
        expect(BACKDROP.drawCalls + g.drawCalls).toBeLessThanOrEqual(PB[t].calls * 0.5); // leaves half for the cabin, the cast, the lights
        expect(BACKDROP.triangles + g.triangles).toBeLessThanOrEqual(PB[t].tris * 0.55); // leaves almost half for the cabin and the cast (Phase 9 alone is 60k)
        expect(g.particles).toBeLessThanOrEqual(PB[t].particles);
      }
    }
  });
  it('the pines are one instanced mesh of a modest unit tree, not hundreds of objects', () => {
    expect(pine.triangles).toBeLessThanOrEqual(100);
    expect(groundStats('high', false, pine, terrain).pines).toBe(PINE_COUNT.high);
  });
});

describe('look and files', () => {
  it('colours are the art-direction palette', () => {
    expect(SNOW_LIT).toBe(0xe8f1f8);
    expect(SNOW_SHADOW).toBe(0xa9bdd6);
    expect(PINE).toBe(0x1f3a3a);
    expect(PINE_SNOW).toBe(0xdfeaf2);
    const [r, g, b] = hexToRgb(GROUND_FOG);
    // the haze is a mix of the nearest layer's body (#3b5278) and haze (#2a3d60): it must sit between them, near the haze, so the ground meets the wall without a seam
    expect(r).toBeGreaterThanOrEqual(0x2a / 255 - 1e-6);
    expect(r).toBeLessThanOrEqual(0x3b / 255 + 1e-6);
    expect(g).toBeGreaterThanOrEqual(0x3d / 255 - 1e-6);
    expect(b).toBeGreaterThanOrEqual(0x60 / 255 - 1e-6);
    expect(b).toBeLessThanOrEqual(0x78 / 255 + 1e-6);
  });
  it('the low tier sparkles a little less, not not at all', () => {
    expect(SPARKLE_STRENGTH.low).toBeLessThan(SPARKLE_STRENGTH.high);
    expect(SPARKLE_STRENGTH.low).toBeGreaterThan(0.3);
  });
  it('the pure files do not import three; the ground draws no ink and reads no texture (AD: background drops the outline; PB: nothing baked)', () => {
    for (const f of ['groundMath', 'groundShaders']) expect(readFileSync(`src/world/${f}.ts`, 'utf8')).not.toMatch(/from\s+['"]three/);
    for (const f of ['terrain', 'snowfall', 'pines', 'ground', 'groundShaders']) {
      const t = readFileSync(`src/world/${f}.ts`, 'utf8');
      expect(t).not.toMatch(/render\/toon/);
      expect(t).not.toMatch(/TextureLoader|CanvasTexture|DataTexture|sampler2D|texture2D/);
      expect(t).not.toMatch(/from\s+['"]\.\.\/(character|acts|ui)\//);
    }
  });
  it('the shaders each end in the colour-space include (so the colours match the backdrop) and none contains a loop that could run away', () => {
    const t = readFileSync('src/world/groundShaders.ts', 'utf8');
    expect((t.match(/#include <colorspace_fragment>/g) ?? []).length).toBe(4);
    expect(t).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
  });
  it('the moon stands where the ground expects it (left of centre, ahead): the same constants the backdrop uses', () => {
    const [sx] = shadowDirection();
    expect(sx).toBeGreaterThan(0); // moon left, so shadows lean right
    expect(MOON_ELEVATION_DEG).toBeGreaterThan(10);
    expect(EYE_HEIGHT).toBeGreaterThan(1);
  });
});
