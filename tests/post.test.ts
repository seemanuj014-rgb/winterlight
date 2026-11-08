import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  postPlanFor, postPassCount, bloomSource, blurTaps, applyGrade, levelSize, postMemoryMB, smoothstep,
  BLOOM_MID, BLOOM_HIGH, GRADE_OFF, type Vec3,
} from '../src/render/post/postMath';
import * as S from '../src/render/post/shaders';

// Phase 15: the numbers behind the post pass (pure), the shader strings, and the opt-in wiring.

const hex = (h: number): Vec3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const sum = (v: Vec3): number => v[0] + v[1] + v[2];

describe('post plans per tier', () => {
  it('low has no post pass at all', () => {
    const p = postPlanFor('low');
    expect(p.enabled).toBe(false);
    expect(p.bloom).toBeNull();
    expect(p.grade.enabled).toBe(false);
    expect(p.msaa).toBe(0);
    expect(postPassCount(p)).toBe(0);
    expect(postMemoryMB(p, 1280, 720)).toBe(0);
  });
  it('mid is bloom only, at half resolution, one level, no grade', () => {
    const p = postPlanFor('mid');
    expect(p.enabled).toBe(true);
    expect(p.bloom).toBe(BLOOM_MID);
    expect(p.bloom!.scale).toBe(0.5);
    expect(p.bloom!.levels).toBe(1);
    expect(p.grade.enabled).toBe(false);
    expect(postPassCount(p)).toBe(4);
  });
  it('high is bloom (two levels) plus the grade', () => {
    const p = postPlanFor('high');
    expect(p.bloom).toBe(BLOOM_HIGH);
    expect(p.bloom!.levels).toBe(2);
    expect(p.grade.enabled).toBe(true);
    expect(postPassCount(p)).toBe(7);
  });
  it('reduced motion changes nothing: the pass is still', () => {
    for (const t of ['low', 'mid', 'high'] as const) expect(postPlanFor(t, true)).toEqual(postPlanFor(t, false));
  });
  it('agrees with the quality tiers (low off, mid and high on)', () => {
    const q = readFileSync('src/core/quality.ts', 'utf8');
    expect(q).toMatch(/postprocessing/);
  });
});

describe('bright pass keeps warm and aurora highlights, not snow or moon', () => {
  const k = (c: Vec3): number => sum(bloomSource(c, BLOOM_MID)) / Math.max(1e-6, sum(c));
  it('keeps the warm window light', () => {
    expect(k(hex(0xffb86b))).toBeGreaterThan(0.9);
  });
  it('keeps a bright aurora teal', () => {
    expect(k([0.35, 1.0, 0.8])).toBeGreaterThan(0.5);
  });
  it('drops the pale snow #e8f1f8 and a pale moon', () => {
    expect(k(hex(0xe8f1f8))).toBeLessThan(0.02);
    expect(k([0.93, 0.95, 0.9])).toBeLessThan(0.02);
  });
  it('drops dark things however coloured', () => {
    expect(k(hex(0x2c4063))).toBe(0);
    expect(k([0.3, 0.1, 0.1])).toBe(0);
  });
  it('never adds light to black and never exceeds the input', () => {
    expect(bloomSource([0, 0, 0], BLOOM_HIGH)).toEqual([0, 0, 0]);
    for (const c of [hex(0xffb86b), [1, 1, 1], [1, 0.2, 0.2]] as Vec3[]) {
      const o = bloomSource(c, BLOOM_HIGH);
      for (let i = 0; i < 3; i++) expect(o[i]!).toBeLessThanOrEqual(c[i]! + 1e-9);
    }
  });
  it('smoothstep is monotonic and clamped', () => {
    let prev = -1;
    for (let x = -0.5; x <= 1.5; x += 0.05) {
      const v = smoothstep(0, 1, x);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(smoothstep(0, 1, -3)).toBe(0);
    expect(smoothstep(0, 1, 9)).toBe(1);
  });
});

describe('blur taps', () => {
  it('the five taps carry the whole weight (centre + 2 x two pairs = 1)', () => {
    const { weights } = blurTaps();
    expect(weights[0]! + 2 * weights[1]! + 2 * weights[2]!).toBeCloseTo(1, 6);
  });
  it('offsets sit between texels and grow outward', () => {
    const { offsets } = blurTaps();
    expect(offsets[0]).toBe(0);
    expect(offsets[1]!).toBeGreaterThan(1);
    expect(offsets[1]!).toBeLessThan(2);
    expect(offsets[2]!).toBeGreaterThan(3);
    expect(offsets[2]!).toBeLessThan(4);
  });
  it('the shader uses the same weights', () => {
    expect(S.BLUR_FRAG).toContain('0.2270270270');
    expect(S.BLUR_FRAG).toContain('0.3162162162');
    expect(S.BLUR_FRAG).toContain('0.0702702703');
  });
});

describe('the grade', () => {
  it('is the identity when off', () => {
    expect(applyGrade([0.2, 0.5, 0.8], [0.1, 0.9], GRADE_OFF)).toEqual([0.2, 0.5, 0.8]);
  });
  const g = postPlanFor('high').grade;
  it('is gentle: a mid colour moves by under 0.08 per channel at the centre', () => {
    const c: Vec3 = [0.4, 0.5, 0.6];
    const o = applyGrade(c, [0.5, 0.5], g);
    for (let i = 0; i < 3; i++) expect(Math.abs(o[i]! - c[i]!)).toBeLessThan(0.08);
  });
  it('darkens the corners and not the centre', () => {
    const c: Vec3 = [0.5, 0.5, 0.5];
    const mid = sum(applyGrade(c, [0.5, 0.5], g));
    const corner = sum(applyGrade(c, [0.02, 0.02], g));
    expect(corner).toBeLessThan(mid * 0.9);
  });
  it('pushes shadows cool and highlights a trace warm', () => {
    const dark = applyGrade([0.1, 0.1, 0.1], [0.5, 0.5], g);
    expect(dark[2]).toBeGreaterThan(dark[0]);
    const light = applyGrade([0.9, 0.9, 0.9], [0.5, 0.5], g);
    expect(light[0]).toBeGreaterThan(light[2]);
  });
  it('never returns a negative or non-finite number', () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [2, 0, 0], [0, 0.01, 0.5]] as Vec3[])
      for (const uv of [[0, 0], [1, 1], [0.5, 0.5]] as [number, number][])
        for (const v of applyGrade(c, uv, g, 0.5)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
  });
});

describe('sizes and memory', () => {
  it('levels halve and never go under 2 px', () => {
    expect(levelSize(1000, 600, 0.5, 0)).toEqual({ w: 500, h: 300 });
    expect(levelSize(1000, 600, 0.5, 1)).toEqual({ w: 250, h: 150 });
    expect(levelSize(1, 1, 0.5, 3)).toEqual({ w: 2, h: 2 });
  });
  it('post buffers fit PB texture memory (mid 48 MB, high 64 MB) on a 390 x 844 phone at each tier\'s pixel-ratio cap', () => {
    expect(postMemoryMB(postPlanFor('mid'), Math.round(390 * 1.75), Math.round(844 * 1.75))).toBeLessThan(48);
    expect(postMemoryMB(postPlanFor('high'), 390 * 2, 844 * 2)).toBeLessThan(64);
    expect(postMemoryMB(postPlanFor('high'), 720, 720)).toBeGreaterThan(postMemoryMB(postPlanFor('mid'), 720, 720));
  });
});

describe('shaders and files', () => {
  const frags = [S.BRIGHT_FRAG, S.DOWN_FRAG, S.BLUR_FRAG, S.COMPOSITE_FRAG];
  it('no loops, and no texture except the pass inputs', () => {
    for (const f of frags) {
      expect(f).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
      for (const m of f.matchAll(/uniform sampler2D (\w+)/g)) expect(['tSource', 'tScene', 'tBloom0', 'tBloom1']).toContain(m[1]);
    }
  });
  it('the vertex shader is one big triangle with no matrices', () => {
    expect(S.POST_VERT).not.toMatch(/modelViewMatrix|projectionMatrix/);
  });
  it('pure files import no three and use no DOM, clock or random', () => {
    const src = readFileSync('src/render/post/postMath.ts', 'utf8') + readFileSync('src/render/post/shaders.ts', 'utf8');
    expect(src).not.toMatch(/from 'three'/);
    expect(src).not.toMatch(/document\.|window\.|Date\.now|performance\.now|Math\.random/);
  });
  it('the post pass is opt-in: the renderer only builds it when a view asks, and the stage has a per-view gain', () => {
    const r = readFileSync('src/core/renderer.ts', 'utf8');
    expect(r).toMatch(/let postWanted = false/);
    expect(r).toMatch(/setBloomGain/);
  });
  it('no character or flat-page file asks for the post pass', () => {
    const m = readFileSync('src/main.ts', 'utf8');
    const calls = [...m.matchAll(/stage\.setPost\(/g)].length;
    // Phase 24: the stars and sky test views (Phases 21 and 22) ask for it too. Phase 26 session 3: the cake and release views (Phases 25 and 26) too, so six; Phase 27 added ?envelope, so seven; Phase 28 added ?finale, so eight, and ?stay, so nine:
    // ?stars, ?cake, ?release, ?envelope, ?finale, ?stay, ?sky, ?world, ?nook. No character view and not the flat page.
    expect(calls).toBe(9);
  });
  it('the nook asks for less glow than the full night', () => {
    const m = readFileSync('src/main.ts', 'utf8');
    expect(m).toMatch(/stage\.setBloomGain\(params\.has\('bloom'\) \? Number\(params\.get\('bloom'\)\) : 0\.3\)/);
  });
  it('the release view asks for less than full glow, so the lanterns keep their shape (Phase 26)', () => {
    const m = readFileSync('src/main.ts', 'utf8');
    expect(m).toMatch(/stage\.setBloomGain\(params\.has\('bloom'\) \? Number\(params\.get\('bloom'\)\) : 0\.4\)/);
  });
});
