import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  newSpring, stepSpring, clampSpring, flickAt, FLICK, FLICK_TOTAL, earAxis, lagAngle, flickSign, earModeForTier, EarMotion,
  EAR_SPRING, EAR_LIMITS, AUTO_FLICK, MAX_DT, EAR_NAMES, type EarAxis, type SpringParams,
} from '../src/character/chamgadad/earSpring';
import { buildHeadParts, type PartsJson } from '../src/character/chamgadad/parts';

const P: SpringParams = { freq: 2.4, damping: 0.3 };
const upAxis: EarAxis = { dir: [0, 1], length: 1, outwardX: -1 };
const sideAxis: EarAxis = { dir: [0.8, 0.6], length: 1, outwardX: 1 };
const axes = { upright: upAxis, angled: sideAxis };
const run = (m: EarMotion, seconds: number, dt = 1 / 60, each?: (t: number) => void): void => {
  for (let t = 0; t < seconds; t += dt) {
    each?.(t);
    m.update(dt);
  }
};
const finiteAll = (m: EarMotion): boolean => EAR_NAMES.every((n) => Object.values(m.pose(n)).every(Number.isFinite));

describe('one spring', () => {
  it('settles on its target', () => {
    const s = newSpring();
    for (let i = 0; i < 600; i++) stepSpring(s, 0.2, 1 / 60, P);
    expect(s.x).toBeCloseTo(0.2, 4);
    expect(Math.abs(s.v)).toBeLessThan(1e-4);
  });
  it('wobbles when under-damped and does not when critically damped', () => {
    const a = newSpring();
    const b = newSpring();
    let maxA = 0;
    let maxB = 0;
    for (let i = 0; i < 300; i++) {
      stepSpring(a, 1, 1 / 60, { freq: 2.4, damping: 0.3 });
      stepSpring(b, 1, 1 / 60, { freq: 2.4, damping: 1 });
      maxA = Math.max(maxA, a.x);
      maxB = Math.max(maxB, b.x);
    }
    expect(maxA).toBeGreaterThan(1.1);
    expect(maxB).toBeLessThan(1.001);
  });
  it('is stable at any frame time, however large (no explosion)', () => {
    for (const dt of [1e-6, 1 / 240, 1 / 60, 1 / 30, 0.1, 0.5, 1, 10, 1e3, 1e9]) {
      const s = { x: 0.4, v: 25 };
      for (let i = 0; i < 400; i++) {
        stepSpring(s, 0, dt, P);
        expect(Number.isFinite(s.x) && Number.isFinite(s.v)).toBe(true);
        expect(Math.abs(s.x)).toBeLessThan(5);
      }
    }
  });
  it('a stiff, lightly damped spring does not explode either', () => {
    const s = { x: 1, v: 0 };
    for (let i = 0; i < 2000; i++) stepSpring(s, 0, 1 / 20, { freq: 40, damping: 0.01 });
    expect(Math.abs(s.x)).toBeLessThanOrEqual(1.0000001);
  });
  it('never gains energy while it moves toward zero, over a long random run of frame times', () => {
    let seed = 3;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const s = { x: 0.3, v: 0 };
    const energy = (): number => 0.5 * s.v * s.v + 0.5 * (2 * Math.PI * P.freq) ** 2 * s.x * s.x;
    let e = energy();
    for (let i = 0; i < 3000; i++) {
      stepSpring(s, 0, rnd() * 0.2, P);
      const e2 = energy();
      expect(e2).toBeLessThanOrEqual(e * (1 + 1e-9));
      e = e2;
    }
  });
  it('different frame rates give close results for the same second', () => {
    const end = (dt: number): number => {
      const s = newSpring();
      for (let t = 0; t < 1 - 1e-9; t += dt) stepSpring(s, 0.3, dt, P);
      return s.x;
    };
    expect(Math.abs(end(1 / 60) - end(1 / 30))).toBeLessThan(0.02);
    expect(Math.abs(end(1 / 60) - end(1 / 15))).toBeLessThan(0.04);
  });
  it('a frame longer than MAX_DT counts as MAX_DT, so a tab that slept does not fling the ear', () => {
    const a = { x: 0, v: 5 };
    const b = { x: 0, v: 5 };
    stepSpring(a, 0, 60, P);
    stepSpring(b, 0, MAX_DT, P);
    expect(a).toEqual(b);
  });
  it('ignores garbage: NaN, infinity, zero or negative time', () => {
    const s = { x: 0.1, v: 0.2 };
    stepSpring(s, NaN, 1 / 60, P);
    stepSpring(s, 0, NaN, P);
    stepSpring(s, 0, -1, P);
    stepSpring(s, 0, 0, P);
    stepSpring(s, Infinity, 1 / 60, P);
    expect(s).toEqual({ x: 0.1, v: 0.2 });
  });
  it('clamp stops the speed that pushes into the wall and keeps the speed that leaves it', () => {
    const a = { x: 2, v: 3 };
    clampSpring(a, 1);
    expect(a).toEqual({ x: 1, v: 0 });
    const b = { x: -2, v: 3 };
    clampSpring(b, 1);
    expect(b).toEqual({ x: -1, v: 3 });
  });
});

describe('the flick shape', () => {
  it('is zero before and after, one at the top, and never leaves 0..1', () => {
    expect(flickAt(0)).toBe(0);
    expect(flickAt(-1)).toBe(0);
    expect(flickAt(FLICK.rise)).toBeCloseTo(1, 9);
    expect(flickAt(FLICK_TOTAL)).toBe(0);
    expect(flickAt(99)).toBe(0);
    expect(flickAt(NaN)).toBe(0);
    for (let t = 0; t < FLICK_TOTAL; t += 0.001) {
      const v = flickAt(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('ear geometry helpers', () => {
  it('the tip is the farthest vertex, and which side the ear is on comes from the head centre', () => {
    const a = earAxis([0, 0, 0, 0, 2, 0, 1, 1, 0], [0, 0, 0], 5);
    expect(a.dir[0]).toBeCloseTo(0, 9);
    expect(a.dir[1]).toBeCloseTo(1, 9);
    expect(a.length).toBeCloseTo(2, 9);
    expect(a.outwardX).toBe(-1);
    expect(earAxis([3, 0, 0], [1, 0, 0], 0).outwardX).toBe(1);
  });
  it('lag turns the tip against the head\'s move', () => {
    // upright ear, head moves right: tip should go left, which is +z rotation
    expect(lagAngle([0, 1], 1, 0)).toBeGreaterThan(0);
    expect(lagAngle([0, 1], -1, 0)).toBeLessThan(0);
    // an ear pointing right, head moves up: tip lags down, which is -z rotation
    expect(lagAngle([1, 0], 0, 1)).toBeLessThan(0);
    expect(lagAngle([0, 1], 0, 1)).toBe(0);
  });
  it('a flick sends the tip outward and up, never into the head', () => {
    expect(flickSign([0, 1], -1)).toBe(1); // upright ear on the left: +z moves the tip left
    expect(flickSign([0.8, 0.6], 1)).toBe(1); // ear angled out right: +z lifts the tip
  });
  it('tiers: low gets the sine sway, the others the springs', () => {
    expect(earModeForTier('low')).toBe('sway');
    expect(earModeForTier('mid')).toBe('spring');
    expect(earModeForTier('high')).toBe('spring');
  });
  it('on her real ears both axes are unit, point up, and the sides are right', () => {
    const json = JSON.parse(readFileSync('character/traced/chamgadad_ref_01_head_front.parts.json', 'utf8')) as PartsJson;
    const b = buildHeadParts(json);
    const cx = b.head.centre[0];
    const up = earAxis(b.earUpright.flap.positions, b.earUpright.pivot, cx);
    const an = earAxis(b.earAngled.flap.positions, b.earAngled.pivot, cx);
    for (const a of [up, an]) {
      expect(Math.hypot(a.dir[0], a.dir[1])).toBeCloseTo(1, 9);
      expect(a.dir[1]).toBeGreaterThan(0);
      expect(a.length).toBeGreaterThan(0.3);
    }
    expect(up.outwardX).toBe(-1);
    expect(an.outwardX).toBe(1);
  });
});

describe('both ears together', () => {
  it('start exactly at rest, so the ears are where Phase 6 put them', () => {
    const m = new EarMotion(axes, { reducedMotion: true });
    for (const n of EAR_NAMES) expect(m.pose(n)).toEqual({ rx: 0, ry: 0, rz: 0, flex: 0 });
    run(m, 5);
    for (const n of EAR_NAMES) expect(m.pose(n)).toEqual({ rx: 0, ry: 0, rz: 0, flex: 0 });
  });
  it('a flick swings the tip outward, overshoots back a little, and settles to rest', () => {
    const m = new EarMotion(axes, { reducedMotion: true });
    m.flick('upright');
    let peak = 0;
    let low = 0;
    run(m, 3, 1 / 60, () => {
      const rz = m.pose('upright').rz;
      peak = Math.max(peak, rz);
      low = Math.min(low, rz);
    });
    expect(peak).toBeGreaterThan(0.1); // clearly visible (about 6 degrees or more)
    expect(peak).toBeLessThanOrEqual(EAR_LIMITS.swing);
    expect(low).toBeLessThan(0); // a little follow-through past the start
    expect(low).toBeGreaterThan(-peak); // but less than the swing itself
    expect(Math.abs(m.pose('upright').rz)).toBeLessThan(1e-3);
    expect(Math.abs(m.pose('upright').flex)).toBeLessThan(1e-3);
    expect(m.pose('angled')).toEqual({ rx: 0, ry: 0, rz: 0, flex: 0 }); // the other ear did not move
  });
  it('the fold flexes during a flick, against the swing, and stays inside its limit', () => {
    const m = new EarMotion(axes, { reducedMotion: true });
    m.flick('both');
    let maxFlex = 0;
    let sawAgainst = false;
    run(m, 2, 1 / 60, () => {
      const p = m.pose('upright');
      maxFlex = Math.max(maxFlex, Math.abs(p.flex));
      if (p.rz > 0.05 && p.flex < 0) sawAgainst = true;
    });
    expect(maxFlex).toBeGreaterThan(0.005);
    expect(maxFlex).toBeLessThanOrEqual(EAR_LIMITS.flex);
    expect(sawAgainst).toBe(true);
  });
  it('the angled ear flexes less than the upright ear for the same flick', () => {
    const peakFlex = (name: 'upright' | 'angled'): number => {
      const m = new EarMotion({ upright: upAxis, angled: { ...upAxis } }, { reducedMotion: true });
      m.flick(name);
      let mx = 0;
      run(m, 1.5, 1 / 60, () => (mx = Math.max(mx, Math.abs(m.pose(name).flex))));
      return mx;
    };
    expect(peakFlex('angled')).toBeLessThan(peakFlex('upright'));
  });
  it('when the head rolls, the ear lags behind it, then comes back', () => {
    const m = new EarMotion(axes, { reducedMotion: false });
    m.auto = false;
    m.couple({ rx: 0, ry: 0, rz: 0.2, mx: 0, my: 0 }); // head rolls +0.2 about z
    expect(m.pose('upright').rz).toBeLessThan(0); // ear is left behind: relative to the head it turned the other way
    run(m, 4);
    expect(Math.abs(m.pose('upright').rz)).toBeLessThan(0.03); // idle sway only
  });
  it('turning and nodding the head tilts the ears in depth, the opposite way', () => {
    const m = new EarMotion(axes);
    m.auto = false;
    m.couple({ rx: 0.1, ry: -0.1, rz: 0, mx: 0, my: 0 });
    const p = m.pose('upright');
    expect(p.rx).toBeLessThan(0);
    expect(p.ry).toBeGreaterThan(0);
  });
  it('a sideways move of the head makes an upright ear lag the other way', () => {
    const m = new EarMotion(axes);
    m.auto = false;
    m.couple({ rx: 0, ry: 0, rz: 0, mx: 0.3, my: 0 });
    expect(m.pose('upright').rz).toBeGreaterThan(0);
  });
  it('reduced motion: smaller tug, no automatic flicks, no idle sway', () => {
    const calm = new EarMotion(axes, { reducedMotion: true });
    const full = new EarMotion(axes, { reducedMotion: false });
    calm.couple({ rx: 0, ry: 0, rz: 0.2, mx: 0, my: 0 });
    full.couple({ rx: 0, ry: 0, rz: 0.2, mx: 0, my: 0 });
    expect(Math.abs(calm.pose('upright').rz)).toBeLessThan(Math.abs(full.pose('upright').rz));
    const idle = new EarMotion(axes, { reducedMotion: true, seed: 5 });
    let moved = false;
    run(idle, 200, 1 / 30, () => {
      if (EAR_NAMES.some((n) => Math.abs(idle.pose(n).rz) > 0)) moved = true;
    });
    expect(moved).toBe(false);
  });
  it('automatic flicks come every 7 to 16 seconds, and a seed replays them exactly', () => {
    const times = (seed: number): number[] => {
      const m = new EarMotion(axes, { seed });
      const out: number[] = [];
      let prev = 0;
      run(m, 120, 1 / 60, (t) => {
        const r = Math.abs(m.pose('upright').rz) + Math.abs(m.pose('angled').rz);
        if (r > 0.12 && prev <= 0.12) out.push(Math.round(t));
        prev = r;
      });
      return out;
    };
    const a = times(9);
    expect(a.length).toBeGreaterThanOrEqual(120 / AUTO_FLICK.maxGap - 1);
    expect(a.length).toBeLessThanOrEqual(Math.ceil(120 / AUTO_FLICK.minGap));
    expect(times(9)).toEqual(a);
    expect(times(10)).not.toEqual(a);
  });
  it('a flick with a bad strength is harmless', () => {
    const m = new EarMotion(axes, { reducedMotion: true });
    m.flick('both', NaN);
    m.flick('both', -4);
    run(m, 1);
    for (const n of EAR_NAMES) expect(m.pose(n)).toEqual({ rx: 0, ry: 0, rz: 0, flex: 0 });
  });
  it('shouted at by a wild head for a long time, it stays finite and inside its limits', () => {
    const m = new EarMotion(axes);
    let seed = 1;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    for (let i = 0; i < 20000; i++) {
      m.couple({ rx: rnd() * 3, ry: rnd() * 3, rz: rnd() * 3, mx: rnd() * 5, my: rnd() * 5 });
      if (i % 50 === 0) m.flick('both');
      m.update(i % 7 === 0 ? 5 : 1 / 60);
      expect(finiteAll(m)).toBe(true);
      for (const n of EAR_NAMES) {
        const p = m.pose(n);
        expect(Math.abs(p.rz)).toBeLessThanOrEqual(EAR_LIMITS.swing + 1e-9);
        expect(Math.abs(p.rx)).toBeLessThanOrEqual(EAR_LIMITS.tilt + 1e-9);
        expect(Math.abs(p.ry)).toBeLessThanOrEqual(EAR_LIMITS.tilt + 1e-9);
        expect(Math.abs(p.flex)).toBeLessThanOrEqual(EAR_LIMITS.flex + 1e-9);
      }
    }
    m.couple({ rx: NaN, ry: Infinity, rz: NaN, mx: NaN, my: -Infinity });
    m.update(NaN);
    expect(finiteAll(m)).toBe(true);
  });
  it('reset puts both ears back at rest', () => {
    const m = new EarMotion(axes, { reducedMotion: true });
    m.flick('both');
    run(m, 0.1);
    m.reset();
    for (const n of EAR_NAMES) expect(m.pose(n)).toEqual({ rx: 0, ry: 0, rz: 0, flex: 0 });
    run(m, 1);
    for (const n of EAR_NAMES) expect(m.pose(n)).toEqual({ rx: 0, ry: 0, rz: 0, flex: 0 });
  });
});

describe('low tier sway', () => {
  it('is a small slow sine: bounded, deterministic, ignores the head, and a flick is the plain shape', () => {
    const m = new EarMotion(axes, { mode: 'sway' });
    m.auto = false;
    m.couple({ rx: 1, ry: 1, rz: 1, mx: 1, my: 1 });
    expect(m.pose('upright')).toEqual({ rx: 0, ry: 0, rz: 0, flex: 0 });
    let max = 0;
    let moved = false;
    run(m, 30, 1 / 60, () => {
      const p = m.pose('upright');
      max = Math.max(max, Math.abs(p.rz));
      if (p.rz !== 0) moved = true;
      expect(p.rx).toBe(0);
      expect(p.flex).toBe(0);
    });
    expect(moved).toBe(true);
    expect(max).toBeLessThanOrEqual(0.03);
    const f = new EarMotion(axes, { mode: 'sway', reducedMotion: true });
    f.flick('upright');
    f.update(FLICK.rise);
    expect(f.pose('upright').rz).toBeCloseTo(FLICK.angle, 6);
    run(f, 1);
    expect(f.pose('upright').rz).toBe(0);
  });
});

describe('source guards', () => {
  it('the spring maths imports nothing from three, and there is no cloth or fur code', () => {
    const src = readFileSync('src/character/chamgadad/earSpring.ts', 'utf8');
    expect(src).not.toMatch(/from\s+['"]three/);
    expect(/cloth|verlet|\bfur\b/i.test(src)).toBe(false);
  });
  it('EAR_SPRING stays under-damped for the swing (a visible wobble is the point) but never zero-damped', () => {
    for (const p of Object.values(EAR_SPRING)) {
      expect(p.damping).toBeGreaterThan(0.1);
      expect(p.damping).toBeLessThan(1);
    }
  });
});
