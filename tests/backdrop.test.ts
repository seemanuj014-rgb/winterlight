import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  rng, makeNoise1D, MOUNTAIN_LAYERS, LAYER_COLUMNS, makeRidge, layerTriangles, EYE_HEIGHT, STAR_COUNT, makeStars, dirFromAngles,
  MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, MOON_RADIUS_DEG, AURORA, DRIFT, driftOffset, fitBackdropView, inView, luma,
} from '../src/world/backdropMath';
import { settingsFor } from '../src/core/quality';

describe('seeded helpers', () => {
  it('rng is deterministic and in [0,1)', () => {
    const a = rng(5), b = rng(5);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('value noise is smooth, bounded and wraps for any x', () => {
    const n = makeNoise1D(3);
    for (const x of [-1e6, -3.2, 0, 0.5, 17.9, 1e6]) {
      const v = n(x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(n(4.5) - n(4.5001))).toBeLessThan(0.01);
  });
});

describe('mountains', () => {
  it('four layers, far to near: nearer is lower, darker and moves more in the drift (hazier with distance)', () => {
    expect(MOUNTAIN_LAYERS).toHaveLength(4);
    for (let i = 1; i < MOUNTAIN_LAYERS.length; i++) {
      const far = MOUNTAIN_LAYERS[i - 1]!, near = MOUNTAIN_LAYERS[i]!;
      expect(near.dist).toBeLessThan(far.dist);
      expect(near.elevDeg[1]).toBeLessThan(far.elevDeg[1]);
      expect(luma(near.body)).toBeLessThan(luma(far.body));
      expect(near.parallax).toBeGreaterThan(far.parallax);
      expect(near.sharp).toBeLessThan(far.sharp);
      expect(near.hazeAmount).toBeLessThan(far.hazeAmount);
    }
  });
  it('body colours stay inside the art-direction range (far mountains #3b5278 to #5a7196)', () => {
    for (const l of MOUNTAIN_LAYERS) {
      expect(l.body).toBeGreaterThanOrEqual(0x3b5278);
      expect(luma(l.body)).toBeLessThanOrEqual(luma(0x5a7196) + 1e-9);
      expect(luma(l.body)).toBeGreaterThanOrEqual(luma(0x3b5278) - 1e-9);
    }
  });
  it('ridges are deterministic, finite and inside their elevation band', () => {
    for (const l of MOUNTAIN_LAYERS) {
      const a = makeRidge(l), b = makeRidge(l);
      expect(Array.from(a.y)).toEqual(Array.from(b.y));
      const lo = Math.tan((l.elevDeg[0] * Math.PI) / 180) * l.dist + EYE_HEIGHT;
      const hi = Math.tan((l.elevDeg[1] * Math.PI) / 180) * l.dist + EYE_HEIGHT;
      expect(a.y.length).toBe(LAYER_COLUMNS + 1);
      for (let i = 0; i < a.y.length; i++) {
        expect(Number.isFinite(a.y[i]!)).toBe(true);
        expect(a.y[i]!).toBeGreaterThanOrEqual(lo - 1e-3);
        expect(a.y[i]!).toBeLessThanOrEqual(hi + 1e-3);
        expect(Math.abs(a.light[i]!)).toBeLessThanOrEqual(1);
      }
    }
  });
  it('every layer has real peaks and real saddles, not a flat line', () => {
    for (const l of MOUNTAIN_LAYERS) {
      const r = makeRidge(l);
      const lo = Math.tan((l.elevDeg[0] * Math.PI) / 180) * l.dist + EYE_HEIGHT;
      const hi = Math.tan((l.elevDeg[1] * Math.PI) / 180) * l.dist + EYE_HEIGHT;
      const spread = Math.max(...r.y) - Math.min(...r.y);
      expect(spread).toBeGreaterThan((hi - lo) * 0.45);
    }
  });
  it('the far layer is jagged and the near layer rolls (mean step between columns)', () => {
    const step = (l: (typeof MOUNTAIN_LAYERS)[number]) => {
      const r = makeRidge(l);
      let s = 0;
      for (let i = 1; i < r.y.length; i++) s += Math.abs(r.y[i]! - r.y[i - 1]!);
      return s / (r.y.length - 1) / (l.dist * Math.tan((l.elevDeg[1] * Math.PI) / 180));
    };
    expect(step(MOUNTAIN_LAYERS[0]!)).toBeGreaterThan(step(MOUNTAIN_LAYERS[3]!));
  });
  it('the whole layer stack fits the budget (triangles)', () => {
    expect(layerTriangles() * MOUNTAIN_LAYERS.length).toBeLessThan(5000);
  });
});

describe('stars', () => {
  const s = makeStars(7, STAR_COUNT.high);
  it('counts fit the particle budget with room left for snow (Phase 13)', () => {
    for (const tier of ['low', 'mid', 'high'] as const) {
      expect(STAR_COUNT[tier]).toBeLessThanOrEqual(settingsFor(tier).maxParticles * 0.4);
    }
    expect(STAR_COUNT.low).toBeLessThan(STAR_COUNT.mid);
    expect(STAR_COUNT.mid).toBeLessThan(STAR_COUNT.high);
  });
  it('are deterministic, unit-length, above the horizon, finite', () => {
    const t = makeStars(7, STAR_COUNT.high);
    expect(Array.from(t.dir)).toEqual(Array.from(s.dir));
    for (let i = 0; i < s.count; i++) {
      const x = s.dir[i * 3]!, y = s.dir[i * 3 + 1]!, z = s.dir[i * 3 + 2]!;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
      expect(y).toBeGreaterThan(0.02);
      expect(s.size[i]!).toBeGreaterThan(1);
      expect(s.size[i]!).toBeLessThan(8);
      expect(s.depth[i]!).toBeGreaterThan(0);
      expect(s.depth[i]!).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.phase[i]! + s.speed[i]!)).toBe(true);
    }
  });
  it('none sits behind the moon', () => {
    const m = dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
    const lim = Math.cos((MOON_RADIUS_DEG * Math.PI) / 180);
    for (let i = 0; i < s.count; i++) expect(s.dir[i * 3]! * m[0] + s.dir[i * 3 + 1]! * m[1] + s.dir[i * 3 + 2]! * m[2]).toBeLessThan(lim);
  });
  it('any prefix is evenly scattered: a step-down to fewer stars leaves no empty half of the sky', () => {
    const p = makeStars(7, STAR_COUNT.low);
    let left = 0, right = 0, ahead = 0, behind = 0;
    for (let i = 0; i < p.count; i++) {
      p.dir[i * 3]! < 0 ? left++ : right++;
      p.dir[i * 3 + 2]! < 0 ? ahead++ : behind++;
    }
    for (const n of [left, right, ahead, behind]) expect(n).toBeGreaterThan(p.count * 0.3);
  });
  it('the horizon stays clean: fewer stars low than high up', () => {
    let low = 0, high = 0;
    for (let i = 0; i < s.count; i++) (s.dir[i * 3 + 1]! < 0.2 ? low++ : high++);
    // the band below elevation 0.2 (11.5 degrees) is a sixth of the upper sky by area
    expect(low / s.count).toBeLessThan(0.16);
    expect(high).toBeGreaterThan(low);
  });
  it('a smaller set is the start of the bigger one (tier step-down just draws fewer)', () => {
    const a = makeStars(7, 100), b = makeStars(7, 300);
    expect(Array.from(a.dir.slice(0, 30))).toEqual(Array.from(b.dir.slice(0, 30)));
  });
});

describe('moon, aurora, drift', () => {
  it('the moon is left and behind, like the rim light of the toon ramp (negative azimuth, above the horizon)', () => {
    expect(MOON_AZIMUTH_DEG).toBeLessThan(0);
    expect(MOON_ELEVATION_DEG).toBeGreaterThan(10);
    const d = dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
    expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    expect(d[0]).toBeLessThan(0);
    expect(d[2]).toBeLessThan(0);
  });
  it('the aurora sits behind the farthest mountain layer and uses the three art-direction colours', () => {
    expect(AURORA.dist).toBeGreaterThan(MOUNTAIN_LAYERS[0]!.dist + DRIFT.amplitude * 2);
    expect(AURORA.teal).toBe(0x58e0c0);
    expect(AURORA.violet).toBe(0x9a86ff);
    expect(AURORA.pink).toBe(0xf0a0d0);
    expect(AURORA.topDeg).toBeGreaterThan(AURORA.bottomDeg);
    for (const t of ['low', 'mid', 'high'] as const) {
      expect(AURORA.strength[t]).toBeGreaterThan(0.2);
      expect(AURORA.strength[t]).toBeLessThanOrEqual(0.8); // soft on purpose
    }
    expect(AURORA.octaves.low).toBeLessThan(AURORA.octaves.high);
  });
  it('the sky parts all sit beyond the mountains and inside the camera far plane (100)', () => {
    const far = Math.max(...MOUNTAIN_LAYERS.map((l) => l.dist)) + DRIFT.amplitude;
    for (const d of [AURORA.dist, 86, 88]) {
      expect(d).toBeGreaterThan(far);
      expect(d).toBeLessThan(100);
    }
  });
  it('drift is slow, bounded, periodic, and exactly zero under reduced motion', () => {
    expect(driftOffset(0, false)).toBeCloseTo(0, 9);
    let max = 0, maxStep = 0, prev = 0;
    for (let t = 0; t <= DRIFT.periodSec * 2; t += 0.1) {
      const v = driftOffset(t, false);
      max = Math.max(max, Math.abs(v));
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
      expect(driftOffset(t, true)).toBe(0);
    }
    expect(max).toBeLessThanOrEqual(DRIFT.amplitude + 1e-9);
    expect(max).toBeGreaterThan(DRIFT.amplitude * 0.99);
    expect(maxStep).toBeLessThan(0.01); // units per tenth of a second
    expect(driftOffset(DRIFT.periodSec, false)).toBeCloseTo(0, 6);
    expect(driftOffset(NaN, false)).toBe(0);
    expect(driftOffset(Infinity, false)).toBe(0);
  });
  it('even the near layer moves less than a hand-width on a phone over a second', () => {
    const near = MOUNTAIN_LAYERS[3]!;
    const perSec = (DRIFT.amplitude * near.parallax * 2 * Math.PI) / DRIFT.periodSec;
    expect(perSec).toBeLessThan(0.1);
  });
});

describe('view', () => {
  it('moon and the tallest far peak stay in frame on a tall phone, a square screen and a wide screen', () => {
    for (const aspect of [360 / 640, 390 / 780, 1, 1280 / 720, 2.2]) {
      const v = fitBackdropView(aspect);
      expect(inView(v, aspect, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, MOON_RADIUS_DEG + 1)).toBe(true);
      expect(inView(v, aspect, 0, MOUNTAIN_LAYERS[0]!.elevDeg[1], 0)).toBe(true);
    }
  });
  it('is finite for silly aspects', () => {
    for (const a of [0, -1, NaN, Infinity]) {
      const v = fitBackdropView(a);
      expect(Number.isFinite(v.fovDeg + v.pitchDeg + v.halfHorizontalDeg)).toBe(true);
    }
  });
});

describe('files', () => {
  it('the pure maths file has no three import; the world files do not import character, acts or ui', () => {
    expect(readFileSync('src/world/backdropMath.ts', 'utf8')).not.toMatch(/from\s+['"]three/);
    for (const f of readdirSync('src/world').filter((n) => n.endsWith('.ts'))) {
      // Phase 24: actWorld.ts (Phase 19) is the one bridge that names the character types, and only as `import type` (no code from them)
      const text = readFileSync(`src/world/${f}`, 'utf8').replace(/^import type .*$/gm, '');
      expect(text).not.toMatch(/from\s+['"]\.\.\/(character|acts|ui)\//);
    }
  });
  it('the backdrop draws no ink line and needs no texture (AD: background drops the outline; PB: nothing baked)', () => {
    for (const f of ['sky', 'mountains', 'aurora', 'moon', 'backdrop']) {
      const t = readFileSync(`src/world/${f}.ts`, 'utf8');
      expect(t).not.toMatch(/render\/toon/);
      expect(t).not.toMatch(/TextureLoader|CanvasTexture|DataTexture/);
    }
  });
});
