import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  cabinPointLights, nookPointLights, CABIN_POINT_LIGHTS, NOOK_POINT_LIGHTS, flicker, heightMist, MIST, HEIGHT_MIST_GLSL,
  moonDirection, MOON_KEY, SKY_FILL, WARM,
} from '../src/world/lightingMath';
import { CABIN, NOOK } from '../src/world/cabinMath';
import { CABIN_SITE } from '../src/world/groundMath';
import { MOON_AZIMUTH_DEG } from '../src/world/backdropMath';

// Phase 15: the light and the mist (pure parts), and the rule that Chamgadad's files never touch them.

const tiers = ['low', 'mid', 'high'] as const;

describe('point lights per tier (PB: a tier budget, not a taste)', () => {
  it('2 / 3 / 4 at the cabin and 1 / 2 / 2 in the nook', () => {
    expect(tiers.map((t) => cabinPointLights(t).length)).toEqual([2, 3, 4]);
    expect(tiers.map((t) => nookPointLights(t).length)).toEqual([1, 2, 2]);
    expect(CABIN_POINT_LIGHTS).toEqual({ low: 2, mid: 3, high: 4 });
    expect(NOOK_POINT_LIGHTS).toEqual({ low: 1, mid: 2, high: 2 });
  });
  it('a lower tier never has more than a higher one', () => {
    for (let i = 1; i < 3; i++) {
      expect(cabinPointLights(tiers[i]!).length).toBeGreaterThanOrEqual(cabinPointLights(tiers[i - 1]!).length);
      expect(nookPointLights(tiers[i]!).length).toBeGreaterThanOrEqual(nookPointLights(tiers[i - 1]!).length);
    }
  });
  it('the lantern is always the first light', () => {
    for (const t of tiers) expect(cabinPointLights(t)[0]!.name).toBe('lantern');
  });
  it('every cabin light stands near the front of the cabin, inside its footprint plus a step, at a sensible height', () => {
    for (const t of tiers)
      for (const l of cabinPointLights(t)) {
        expect(Math.abs(l.pos[0])).toBeLessThanOrEqual(CABIN.hx + 0.01);
        expect(l.pos[2]).toBeGreaterThan(CABIN.hz - 0.1);
        expect(l.pos[2]).toBeLessThan(CABIN.hz + 1.2);
        expect(l.pos[1]).toBeGreaterThan(0.8);
        expect(l.pos[1]).toBeLessThan(CABIN.wallTop);
      }
  });
  it('the window lights sit at the windows', () => {
    const all = cabinPointLights('high');
    expect(all.find((l) => l.name === 'window-left')!.pos[0]).toBe(CABIN.frontWindowX[0]);
    expect(all.find((l) => l.name === 'window-right')!.pos[0]).toBe(CABIN.frontWindowX[1]);
  });
  it('the nook lamp sits at the real lamp, and every nook light is inside the room', () => {
    const lamp = nookPointLights('low')[0]!;
    expect(lamp.name).toBe('lamp');
    expect(Math.hypot(lamp.pos[0] - NOOK.lamp[0], lamp.pos[1] - NOOK.lamp[1], lamp.pos[2] - NOOK.lamp[2])).toBeLessThan(0.5);
    for (const l of nookPointLights('high')) {
      expect(Math.abs(l.pos[0])).toBeLessThan(NOOK.hx);
      expect(Math.abs(l.pos[2])).toBeLessThan(NOOK.hz + 0.01);
      expect(l.pos[1]).toBeLessThan(NOOK.h);
    }
  });
  it('lights are warm, finite and reach a sensible distance', () => {
    for (const l of [...cabinPointLights('high'), ...nookPointLights('high')]) {
      expect(Number.isFinite(l.intensity) && l.intensity > 0).toBe(true);
      expect(l.distance).toBeGreaterThan(2);
      expect(l.distance).toBeLessThan(12);
      const r = (l.color >> 16) & 255;
      const b = l.color & 255;
      expect(r).toBeGreaterThan(b); // warm: red above blue
    }
    expect([WARM.window, WARM.lantern].every((c) => ((c >> 16) & 255) > (c & 255))).toBe(true);
  });
  it('the cabin footprint is inside its clearing', () => {
    expect(Math.hypot(CABIN.hx, CABIN.hz)).toBeLessThan(CABIN_SITE.radius);
  });
});

describe('the key and the fill are cool', () => {
  it('moon key is blue-leaning and comes from the sky moon', () => {
    expect(MOON_KEY.color & 255).toBeGreaterThan((MOON_KEY.color >> 16) & 255);
    const d = moonDirection();
    expect(Math.hypot(...d)).toBeCloseTo(1, 5);
    expect(d[1]).toBeGreaterThan(0);
    expect(Math.sign(d[0])).toBe(Math.sign(Math.sin((MOON_AZIMUTH_DEG * Math.PI) / 180)));
  });
  it('fill is blue-leaning and weaker than the key', () => {
    expect(SKY_FILL.sky & 255).toBeGreaterThan((SKY_FILL.sky >> 16) & 255);
    expect(SKY_FILL.intensity).toBeLessThan(MOON_KEY.intensity);
  });
});

describe('flicker', () => {
  it('is exactly 1 when reduced, for zero amplitude and for bad time', () => {
    expect(flicker(12.3, 0.07, 2.3, 1, true)).toBe(1);
    expect(flicker(12.3, 0, 2.3, 1, false)).toBe(1);
    expect(flicker(NaN, 0.07, 2.3, 1, false)).toBe(1);
    expect(flicker(Infinity, 0.07, 2.3, 1, false)).toBe(1);
  });
  it('stays within the amplitude and never jumps', () => {
    let prev = flicker(0, 0.07, 2.3, 1, false);
    let lo = 9;
    let hi = 0;
    for (let t = 0; t < 120; t += 1 / 60) {
      const v = flicker(t, 0.07, 2.3, 1, false);
      expect(Math.abs(v - 1)).toBeLessThanOrEqual(0.07 + 1e-9);
      expect(Math.abs(v - prev)).toBeLessThan(0.01);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      prev = v;
    }
    expect(hi - lo).toBeGreaterThan(0.05); // it does breathe
  });
  it('two lights with different seeds do not breathe together', () => {
    let same = 0;
    for (let t = 0; t < 30; t += 0.5) if (Math.abs(flicker(t, 0.05, 1.3, 2, false) - flicker(t, 0.05, 1.3, 3, false)) < 1e-6) same++;
    expect(same).toBeLessThan(3);
  });
});

describe('height mist', () => {
  it('is 0 for no distance and for bad input, and never above max', () => {
    expect(heightMist(0, 1, 1)).toBe(0);
    expect(heightMist(-4, 1, 1)).toBe(0);
    expect(heightMist(NaN, 1, 1)).toBe(0);
    for (const d of [1, 10, 100, 1e6]) expect(heightMist(d, 1.6, 0)).toBeLessThanOrEqual(MIST.max + 1e-12);
  });
  it('grows with distance', () => {
    let prev = 0;
    for (const d of [1, 3, 8, 20, 40]) {
      const v = heightMist(d, 1.6, 0.2);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
  it('is thinner higher up (a tree top is clearer than its foot) and for a raised eye line', () => {
    expect(heightMist(20, 1.6, 12)).toBeLessThan(heightMist(20, 1.6, 0));
    expect(heightMist(20, 10, 10)).toBeLessThan(heightMist(20, 1, 1));
  });
  it('is continuous across the flat-ray switch', () => {
    const a = heightMist(15, 2, 2);
    const b = heightMist(15, 2, 2 + 1e-3);
    expect(Math.abs(a - b)).toBeLessThan(1e-3);
  });
  it('is symmetric: the same ray read from either end', () => {
    expect(heightMist(12, 0.5, 6)).toBeCloseTo(heightMist(12, 6, 0.5), 9);
  });
  it('the GLSL twin uses the same constants and arithmetic', () => {
    expect(HEIGHT_MIST_GLSL).toContain('uMist.z * (1.0 - exp(-uMist.x * dist * meanD))');
    expect(HEIGHT_MIST_GLSL).toContain('(exp(-uMist.y * a) - exp(-uMist.y * b)) / dy');
    for (const f of ['src/world/terrain.ts', 'src/world/pines.ts']) {
      const t = readFileSync(f, 'utf8');
      expect(t).toContain('new THREE.Vector4(MIST.density, MIST.falloff, MIST.max, 0)'); // one source of numbers, shared with the JS twin
    }
    expect(readFileSync('src/world/groundShaders.ts', 'utf8')).toContain('${HEIGHT_MIST_GLSL}'); // the terrain and pine shaders share the one GLSL twin
  });
  it('the mist is subtle at arm\'s length and real at the far snow', () => {
    expect(heightMist(2, 1.6, 0)).toBeLessThan(0.05);
    expect(heightMist(30, 1.6, 0)).toBeGreaterThan(0.1);
  });
});

describe('the pure light files and Chamgadad', () => {
  it('lightingMath has no three, DOM, clock or random', () => {
    const s = readFileSync('src/world/lightingMath.ts', 'utf8');
    expect(s).not.toMatch(/from 'three'/);
    expect(s).not.toMatch(/document\.|window\.|Date\.now|performance\.now|Math\.random/);
  });
  it('no character file imports the lighting or the post pass', () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.ts') ? [`${d}/${e.name}`] : []));
    for (const f of walk('src/character')) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/world\/lighting|render\/post|lightingMath/);
    }
  });
  it('only the world and nook views build the rig', () => {
    const m = readFileSync('src/main.ts', 'utf8');
    expect([...m.matchAll(/createWorldLighting\(/g)].length).toBe(1);
    expect([...m.matchAll(/createNookLighting\(/g)].length).toBe(1);
  });
});
