import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANTERN_COUNT, RELEASE, lanternCount, lanternPose, makeLanterns, releaseCamera, releaseEndS, type Lantern } from '../src/fx/lanternMath';
import { GLITTER, GLITTER_COUNT, glitterAlpha, glitterCount, glitterOffset, makeGlitter } from '../src/fx/glitterMath';
import { PARTICLE_BUDGET, SNOW_COUNT } from '../src/world/groundMath';
import { STAR_COUNT } from '../src/world/backdropMath';

const TIERS = ['low', 'mid', 'high'] as const;
const src = (p: string): string => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('lanterns: the flock', () => {
  const L = makeLanterns();
  it('is made from a seed, the same every time, and a lower tier is the first part of it', () => {
    expect(makeLanterns(26)).toEqual(makeLanterns(26));
    expect(makeLanterns(27)).not.toEqual(makeLanterns(26));
    expect(L).toHaveLength(LANTERN_COUNT.high);
    expect(lanternCount('low', false)).toBe(7);
    expect(lanternCount('mid', false)).toBe(12);
    expect(lanternCount('high', false)).toBe(18);
    for (const t of TIERS) expect(lanternCount(t, true)).toBe(Math.ceil(LANTERN_COUNT[t] / 2));
  });
  it('lets go one by one: delays rise, none before the hush, all inside the spread', () => {
    for (const l of L) {
      expect(l.delay).toBeGreaterThanOrEqual(0);
      expect(l.delay).toBeLessThanOrEqual(RELEASE.spreadS);
    }
    const first7 = L.slice(0, 7).map((l) => l.delay);
    // the small tier is the first seven: they must not all go at once
    expect(Math.max(...first7) - Math.min(...first7)).toBeGreaterThan(0.5);
    expect(new Set(L.map((l) => l.delay.toFixed(2))).size).toBeGreaterThan(12);
  });
  it('every number is finite and in its range, and every lantern starts on the table top', () => {
    for (const l of L) {
      for (const v of Object.values(l)) expect(Number.isFinite(v)).toBe(true);
      expect(Math.hypot(l.x0, l.z0)).toBeLessThan(0.5);
      expect(l.size).toBeGreaterThan(0.8);
      expect(l.size).toBeLessThan(1.25);
      expect(l.rise).toBeGreaterThan(0.5);
    }
  });
});

describe('lanterns: one lantern in time', () => {
  const l: Lantern = makeLanterns()[3]!;
  const t0 = RELEASE.hushS + l.delay;
  it('is not there during the hush or before its turn, and not after its life', () => {
    expect(lanternPose(l, 0).visible).toBe(false);
    expect(lanternPose(l, RELEASE.hushS - 0.01).visible).toBe(false);
    expect(lanternPose(l, t0 - 0.01).visible).toBe(false);
    expect(lanternPose(l, t0 + 0.2).visible).toBe(true);
    expect(lanternPose(l, t0 + RELEASE.lifeS + 0.01).visible).toBe(false);
  });
  it('is small and dim at lift-off, full and lit a moment later, and gone (alpha 0) at the end', () => {
    const a = lanternPose(l, t0 + 0.05);
    const b = lanternPose(l, t0 + 3);
    expect(a.scale).toBeLessThan(0.2 * l.size);
    expect(a.glow).toBeLessThan(0.1);
    expect(b.scale).toBeCloseTo(l.size, 5);
    expect(b.glow).toBeGreaterThan(0.7);
    const end = lanternPose(l, t0 + RELEASE.lifeS - 0.001);
    expect(end.alpha).toBeLessThan(0.02);
  });
  it('only ever goes up and toward the aurora (away from the camera: z falls), a little at a time', () => {
    let prev = lanternPose(l, t0 + 0.01);
    for (let t = t0 + 0.05; t < t0 + RELEASE.lifeS; t += 0.05) {
      const p = lanternPose(l, t);
      expect(p.y).toBeGreaterThanOrEqual(prev.y - 1e-9);
      expect(Math.abs(p.x - prev.x)).toBeLessThan(0.2); // no jump
      expect(Math.abs(p.z - prev.z)).toBeLessThan(0.2);
      prev = p;
    }
    const top = lanternPose(l, t0 + RELEASE.lifeS - 0.01);
    expect(top.y).toBeGreaterThan(6);
    expect(top.y).toBeLessThan(30);
    expect(top.z).toBeLessThan(-4);
  });
  it('sways, rolls only a little, and flickers inside bounds', () => {
    let minG = 1, maxG = 0, maxRoll = 0;
    for (let t = t0 + 3; t < t0 + 12; t += 0.02) {
      const p = lanternPose(l, t);
      minG = Math.min(minG, p.glow);
      maxG = Math.max(maxG, p.glow);
      maxRoll = Math.max(maxRoll, Math.abs(p.roll), Math.abs(p.pitch));
      expect(p.glow).toBeGreaterThanOrEqual(0);
      expect(p.glow).toBeLessThanOrEqual(1);
      expect(p.alpha).toBeGreaterThanOrEqual(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
    }
    expect(maxG - minG).toBeGreaterThan(0.03);
    expect(maxRoll).toBeLessThan(0.2);
  });
  it('reduced motion climbs slower, sways less, rolls less and does not flicker', () => {
    const t = t0 + 8;
    const full = lanternPose(l, t);
    const red = lanternPose(l, t, true);
    expect(red.y).toBeLessThan(full.y);
    expect(Math.abs(red.roll)).toBeLessThanOrEqual(Math.abs(full.roll) * 0.26 + 1e-9);
    const gl: number[] = [];
    for (let k = 0; k < 40; k++) gl.push(lanternPose(l, t0 + 6 + k * 0.05, true).glow);
    expect(Math.max(...gl) - Math.min(...gl)).toBe(0);
  });
  it('is the same every time (a pure function), and bad input never throws or gives NaN', () => {
    expect(lanternPose(l, t0 + 4)).toEqual(lanternPose(l, t0 + 4));
    for (const bad of [NaN, Infinity, -Infinity, -5, 1e9]) {
      const p = lanternPose(l, bad);
      expect(p.visible).toBe(false);
      for (const v of Object.values(p)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
    expect(lanternPose(l, t0 + 2, false, 1.2).y).toBeCloseTo(lanternPose(l, t0 + 2, false, 0).y + 1.2, 9);
  });
  it('the whole release ends when the last lantern is gone', () => {
    expect(releaseEndS()).toBe(RELEASE.hushS + RELEASE.spreadS + RELEASE.lifeS);
    for (const x of makeLanterns()) expect(lanternPose(x, releaseEndS() + 0.01).visible).toBe(false);
    // and at the very start nothing is up
    for (const x of makeLanterns()) expect(lanternPose(x, 0).visible).toBe(false);
  });
});

describe('the release camera', () => {
  it('is finite and looks up and away at every aspect, wider on a tall phone', () => {
    for (const a of [0.46, 0.56, 0.75, 1, 1.78, NaN, 0]) {
      const c = releaseCamera(a);
      for (const v of [...c.eye, ...c.look, c.fovDeg]) expect(Number.isFinite(v)).toBe(true);
      expect(c.look[1]).toBeGreaterThan(c.eye[1]);
      expect(c.look[2]).toBeLessThan(c.eye[2]);
    }
    expect(releaseCamera(0.5).fovDeg).toBeGreaterThan(releaseCamera(1.78).fovDeg);
  });
});

describe('glitter', () => {
  const g = makeGlitter();
  it('is made from a seed, the same every time; a lower tier is the first part; reduced is half', () => {
    expect(makeGlitter(52).vel).toEqual(makeGlitter(52).vel);
    expect(g.count).toBe(GLITTER_COUNT.high);
    for (const t of TIERS) {
      expect(glitterCount(t, false)).toBe(GLITTER_COUNT[t]);
      expect(glitterCount(t, true)).toBe(Math.ceil(GLITTER_COUNT[t] / 2));
    }
  });
  it('every spark leaves upward-leaning, at a sane speed, with finite numbers', () => {
    for (let i = 0; i < g.count; i++) {
      const vy = g.vel[i * 3 + 1]!;
      const sp = Math.hypot(g.vel[i * 3]!, vy, g.vel[i * 3 + 2]!);
      expect(vy).toBeGreaterThan(0);
      expect(sp).toBeGreaterThanOrEqual(GLITTER.speedMin - 1e-6);
      expect(sp).toBeLessThanOrEqual(GLITTER.speedMax + 1e-6);
      expect(g.size[i]).toBeGreaterThanOrEqual(GLITTER.sizeMin);
      expect(g.size[i]).toBeLessThanOrEqual(GLITTER.sizeMax);
      expect([0, 1, 2]).toContain(g.tint[i]);
      expect(g.delay[i]).toBeLessThan(0.36);
    }
    const tints = [0, 1, 2].map((k) => Array.from(g.tint).filter((v) => v === k).length);
    expect(tints[0]).toBeGreaterThan(tints[1]!); // mostly frost
    expect(tints[2]).toBeGreaterThan(0);
  });
  it('flies out, slows in the air, hangs, and is gone (alpha 0) by its life', () => {
    const i = 10;
    const d = (t: number): number => Math.hypot(...glitterOffset(g, i, t));
    expect(d(0)).toBe(0);
    expect(d(0.5)).toBeGreaterThan(0);
    // slowing: the second half-second covers less ground than the first
    const first = Math.hypot(...glitterOffset(g, i, 0.5 + g.delay[i]!));
    const second = Math.hypot(...glitterOffset(g, i, 1 + g.delay[i]!)) - first;
    expect(second).toBeLessThan(first);
    expect(glitterAlpha(g, i, -1)).toBe(0);
    expect(glitterAlpha(g, i, GLITTER.lifeS + g.delay[i]! + 0.01)).toBe(0);
    expect(glitterAlpha(g, i, g.delay[i]! + 0.3, true)).toBeGreaterThan(0.5);
  });
  it('twinkles (alpha moves) unless reduced motion, and stays in 0..1 for every spark and time', () => {
    const i = 4;
    const a: number[] = [];
    const b: number[] = [];
    for (let t = 1; t < 3; t += 0.03) {
      a.push(glitterAlpha(g, i, t));
      b.push(glitterAlpha(g, i, t, true));
    }
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.05);
    // reduced: only the slow fade, so it never rises after the flash
    for (let k = 1; k < b.length; k++) expect(b[k]!).toBeLessThanOrEqual(b[k - 1]! + 1e-9);
    for (let k = 0; k < g.count; k += 7) for (let t = -1; t < 7; t += 0.37) {
      const v = glitterAlpha(g, k, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('bad time never gives NaN', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      for (const v of glitterOffset(g, 0, bad)) expect(Number.isFinite(v) || v === -Infinity || bad === Infinity).toBe(true);
      expect(Number.isNaN(glitterAlpha(g, 0, bad))).toBe(false);
    }
    expect(glitterOffset(g, 0, NaN)).toEqual([0, 0, 0]);
  });
});

describe('the budget (docs/PERF_BUDGET.md)', () => {
  it('stars + snow + the cake\'s 10 flame and smoke points + lantern halos + glitter fit the particle budget at every tier', () => {
    for (const t of TIERS) {
      const used = STAR_COUNT[t] + SNOW_COUNT[t] + 10 + LANTERN_COUNT[t] + GLITTER_COUNT[t];
      expect(used).toBeLessThanOrEqual(PARTICLE_BUDGET[t]);
    }
  });
  it('the lanterns cost 2 draw calls and the glitter 1, counted from the real scene graph (three, no GPU)', async () => {
    const { createLanterns } = await import('../src/fx/lanterns');
    const { createGlitter } = await import('../src/fx/glitter');
    for (const tier of TIERS) {
      const lan = createLanterns({ tier, reducedMotion: false });
      const gl = createGlitter({ tier, reducedMotion: false });
      let calls = 0;
      for (const root of [lan.root, gl.points]) root.traverse((o) => { const m = o as unknown as { isMesh?: boolean; isPoints?: boolean; isInstancedMesh?: boolean }; if (m.isMesh || m.isPoints) calls++; });
      expect(calls).toBe(3);
      expect(lan.stats().drawCalls).toBe(2);
      expect(lan.count).toBe(LANTERN_COUNT[tier]);
      expect(gl.count).toBe(GLITTER_COUNT[tier]);
      lan.update(8);
      lan.update(0);
      lan.dispose();
      gl.dispose();
    }
    const lr = createLanterns({ tier: 'high', reducedMotion: true });
    expect(lr.count).toBe(9);
    lr.dispose();
  });
});

describe('purity, and nothing romantic', () => {
  it('the two pure files import no three, no DOM, no clock, no random', () => {
    for (const f of ['fx/lanternMath.ts', 'fx/glitterMath.ts']) {
      const code = src(f).replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/from 'three'|document\.|window\.|Date\.now|performance\.now|Math\.random|requestAnimationFrame/);
    }
  });
  it('no heart, rose, bouquet, candlelit or couple words in the fx sources', () => {
    for (const f of ['fx/lanternMath.ts', 'fx/glitterMath.ts', 'fx/lanterns.ts', 'fx/glitter.ts']) {
      expect(src(f).toLowerCase()).not.toMatch(/heart|rose\b|bouquet|candlelit|romantic|couple|valentine/);
    }
  });
});
