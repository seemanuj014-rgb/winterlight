import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  Director, makePath, ease, angleBetween, slerpUnit, channelAt, fovForAspect, handheld, nudgeDirection, smootherstep, CUT_DISTANCE, MAX_DT, REF_ASPECT, MAX_FOV_DEG, HANDHELD,
  type Shot, type V3, type Frame,
} from '../src/core/directorMath';
import { SHOTS, SHOT_NAMES, TOUR, SPOTS, cabinToWorld, worldToCabin, locationOfEye, EYE_HEIGHT } from '../src/world/shots';
import { CABIN, NOOK, NOOK_ORIGIN } from '../src/world/cabinMath';
import { CABIN_SITE, STAGE, terrainHeight } from '../src/world/groundMath';

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const STEP = 1 / 60;

function run(d: Director, seconds: number, onFrame?: (f: Frame, i: number) => void): Frame {
  let f = d.frame;
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    f = d.update(STEP);
    onFrame?.(f, i);
  }
  return f;
}

const A: Shot = { name: 'A', eye: [[0, 1.5, 5], [0, 1.5, 2]], look: [[0, 1, 0]], fov: [40, 36], seconds: 6 };
const B: Shot = { name: 'B', eye: [[3, 1.5, 3], [2, 1.5, 0]], look: [[0, 1, 0], [1, 1, -4]], fov: [36, 44], seconds: 5, hold: 1 };

describe('paths', () => {
  it('pass through every point and walk at an even speed', () => {
    const pts: V3[] = [[0, 0, 0], [1, 0, 0], [1, 2, 0], [4, 2, 1]];
    const p = makePath(pts);
    expect(p.at(0)).toEqual([0, 0, 0]);
    const end = p.at(1);
    expect(dist(end, [4, 2, 1])).toBeLessThan(1e-6);
    // even speed: equal steps in u are equal distances (within the sampling error)
    const steps: number[] = [];
    for (let i = 0; i < 40; i++) steps.push(dist(p.at(i / 40), p.at((i + 1) / 40)));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const s of steps) expect(Math.abs(s - mean)).toBeLessThan(mean * 0.12);
  });
  it('a single point is a held position; bad points are refused', () => {
    expect(makePath([[1, 2, 3]]).at(0.5)).toEqual([1, 2, 3]);
    expect(() => makePath([])).toThrow();
    expect(() => makePath([[0, 0, NaN]])).toThrow();
  });
  it('u outside 0..1 or NaN stays on the path', () => {
    const p = makePath([[0, 0, 0], [2, 0, 0]]);
    expect(p.at(-5)[0]).toBe(0);
    expect(p.at(9)[0]).toBeCloseTo(2, 6);
    expect(Number.isFinite(p.at(NaN)[0])).toBe(true);
  });
});

describe('easing, channels, field of view', () => {
  it('eases start at 0, end at 1 and never leave 0..1', () => {
    for (const k of ['inOut', 'in', 'out', 'linear'] as const) {
      expect(ease(k, 0)).toBe(0);
      expect(ease(k, 1)).toBe(1);
      for (let i = 0; i <= 50; i++) {
        const v = ease(k, i / 50);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 9);
  });
  it('a channel is flat before the first key and after the last, smooth between', () => {
    const keys = [[0.2, 0], [0.6, 1]] as const;
    expect(channelAt(keys, 0)).toBe(0);
    expect(channelAt(keys, 1)).toBe(1);
    expect(channelAt(keys, 0.4)).toBeCloseTo(0.5, 9);
    expect(channelAt([], 0.5)).toBe(0);
  });
  it('a tall phone gets a wider field, a wide screen keeps the shot\'s number, and it is capped', () => {
    expect(fovForAspect(40, 1.78)).toBe(40);
    expect(fovForAspect(40, REF_ASPECT)).toBe(40);
    const phone = fovForAspect(40, 390 / 780);
    expect(phone).toBeGreaterThan(40);
    expect(phone).toBeLessThanOrEqual(MAX_FOV_DEG);
    expect(fovForAspect(80, 0.3)).toBe(MAX_FOV_DEG);
    expect(fovForAspect(40, NaN)).toBe(40);
    // the same width stays in frame: tan(half h) * aspect is what the reference aspect gave
    const half = (d: number): number => Math.tan((d * Math.PI) / 360);
    expect(half(phone) * (390 / 780)).toBeCloseTo(half(40) * REF_ASPECT, 3);
  });
});

describe('handheld', () => {
  it('is exactly zero when off, bounded when on, slow and never random', () => {
    expect(handheld(12.3, 0)).toEqual({ dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, roll: 0 });
    let maxPos = 0;
    let maxStep = 0;
    let maxTurnStep = 0;
    let prev = handheld(0, 1);
    for (let i = 1; i < 60 * 120; i++) {
      const h = handheld(i / 60, 1);
      maxPos = Math.max(maxPos, Math.abs(h.dx), Math.abs(h.dy), Math.abs(h.dz));
      maxStep = Math.max(maxStep, Math.abs(h.dx - prev.dx), Math.abs(h.dy - prev.dy), Math.abs(h.dz - prev.dz));
      maxTurnStep = Math.max(maxTurnStep, Math.abs(h.yaw - prev.yaw), Math.abs(h.pitch - prev.pitch));
      prev = h;
    }
    expect(maxPos).toBeLessThanOrEqual(HANDHELD.pos * 1.001);
    expect(maxStep).toBeLessThan(0.001); // under a millimetre per frame: it drifts, it does not shake
    expect(maxTurnStep).toBeLessThan(0.00015); // and under 0.01 degree per frame
    expect(handheld(7.7, 1)).toEqual(handheld(7.7, 1));
    expect(handheld(NaN, 1).dx).toBeDefined();
    expect(Math.abs(handheld(3, 99).dx)).toBeLessThanOrEqual(HANDHELD.pos * 2.001);
  });
  it('turning a direction a little keeps its length and stays finite near straight up', () => {
    const d: V3 = [0, 0, -3];
    const n = nudgeDirection(d, 0.01, 0.01);
    expect(Math.hypot(...n)).toBeCloseTo(3, 6);
    const up = nudgeDirection([0, 5, 0], 0.5, 0.5);
    expect(up.every(Number.isFinite)).toBe(true);
    expect(nudgeDirection(d, 0, 0)[2]).toBeCloseTo(-3, 9);
  });
});

describe('turning between directions', () => {
  it('goes the short way at an even rate, ends exactly, and survives a reversal', () => {
    const a: V3 = [0, 0, -1];
    const b: V3 = [1, 0, 0];
    expect(slerpUnit(a, b, 0)).toEqual(a);
    const end = slerpUnit(a, b, 1);
    expect(dist(end, b)).toBeLessThan(1e-9);
    let prev = a;
    for (let i = 1; i <= 20; i++) {
      const m = slerpUnit(a, b, i / 20);
      expect(Math.hypot(...m)).toBeCloseTo(1, 9);
      expect(angleBetween(prev, m)).toBeCloseTo(Math.PI / 2 / 20, 6);
      prev = m;
    }
    const rev = slerpUnit([0, 0, -1], [0, 0, 1], 0.5);
    expect(Math.hypot(...rev)).toBeCloseTo(1, 9);
    expect(rev.every(Number.isFinite)).toBe(true);
    expect(slerpUnit(a, a, 0.5).every(Number.isFinite)).toBe(true);
  });
});

describe('the director', () => {
  it('the first play is a cut, exactly at the shot\'s first frame (handheld off)', () => {
    const d = new Director({ reducedMotion: false });
    d.play({ ...A, handheld: 0 });
    const f = d.update(0);
    expect(f.cut).toBe(true);
    expect(dist(f.eye, [0, 1.5, 5])).toBeLessThan(1e-9);
    expect(f.fov).toBeCloseTo(40, 9);
    expect(d.update(STEP).cut).toBe(false);
  });
  it('plays through and holds its last frame with the drift still breathing, and never goes past it', () => {
    const d = new Director();
    d.play({ ...A, handheld: 0 });
    run(d, 7);
    expect(d.playing).toBe(false);
    const f = run(d, 5);
    expect(dist(f.eye, [0, 1.5, 2])).toBeLessThan(1e-6);
    expect(f.fov).toBeCloseTo(36, 6);
    const d2 = new Director();
    d2.play(A);
    const a = run(d2, 8);
    const b = run(d2, 1);
    expect(dist(a.eye, b.eye)).toBeGreaterThan(0); // handheld: not frozen
    expect(dist(a.eye, b.eye)).toBeLessThan(0.05); // but only a breath
  });
  it('a request in the middle of a move starts from what is on screen: no frame jumps more than a little', () => {
    // the larger of the two jumps in eye position and in look direction, over many moments of interruption
    for (let k = 0; k < 40; k++) {
      const d = new Director();
      d.play(SHOTS.nookWide, { cut: true });
      run(d, 0.3 + k * 0.21);
      const before = d.frame;
      d.play(SHOTS.nookDoor);
      const after = d.update(STEP);
      expect(dist(before.eye, after.eye)).toBeLessThan(0.1);
      const dirA: V3 = [before.look[0] - before.eye[0], before.look[1] - before.eye[1], before.look[2] - before.eye[2]];
      const dirB: V3 = [after.look[0] - after.eye[0], after.look[1] - after.eye[1], after.look[2] - after.eye[2]];
      const cos = (dirA[0] * dirB[0] + dirA[1] * dirB[1] + dirA[2] * dirB[2]) / (Math.hypot(...dirA) * Math.hypot(...dirB));
      expect(Math.acos(Math.min(1, cos))).toBeLessThan(0.03);
    }
  });
  it('a long storm of random requests stays finite and smooth (no eye jump over 12 cm, no look turn over 0.8 degrees in a frame, except cuts)', () => {
    const d = new Director();
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const names = SHOT_NAMES.filter((n) => locationOfEye(SHOTS[n].eye[0]![1]) === 'outside');
    d.play(SHOTS[names[0]!], { cut: true });
    let prev = d.update(STEP);
    let worstEye = 0;
    let worstTurn = 0;
    for (let i = 0; i < 60 * 600; i++) {
      if (rnd() < 0.004) d.play(SHOTS[names[Math.floor(rnd() * names.length)]!]);
      const f = d.update(STEP);
      expect(f.eye.every(Number.isFinite) && f.look.every(Number.isFinite) && Number.isFinite(f.fov) && Number.isFinite(f.roll)).toBe(true);
      if (!f.cut) {
        worstEye = Math.max(worstEye, dist(f.eye, prev.eye));
        const a: V3 = [prev.look[0] - prev.eye[0], prev.look[1] - prev.eye[1], prev.look[2] - prev.eye[2]];
        const b: V3 = [f.look[0] - f.eye[0], f.look[1] - f.eye[1], f.look[2] - f.eye[2]];
        const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
        worstTurn = Math.max(worstTurn, Math.acos(Math.min(1, c)));
      }
      prev = f;
    }
    expect(worstEye).toBeLessThan(0.12);
    expect(worstTurn).toBeLessThan((0.8 * Math.PI) / 180);
  }, 30000);
  it('a jump longer than CUT_DISTANCE is a cut, flagged once; a short one is a move', () => {
    const d = new Director();
    d.play(SHOTS.nookDoor, { cut: true });
    run(d, 1);
    d.play(SHOTS.doorOut); // the nook is 50 m above the snow
    expect(d.update(STEP).cut).toBe(true);
    expect(d.update(STEP).cut).toBe(false);
    expect(CUT_DISTANCE).toBeLessThan(50);
    const e = new Director();
    e.play(A, { cut: true });
    run(e, 1);
    e.play(B);
    expect(e.update(STEP).cut).toBe(false);
  });
  it('the queue plays shots in order after the hold, and play() drops it (latest wins)', () => {
    const d = new Director();
    d.play({ ...A, handheld: 0 }, { cut: true });
    d.then({ ...B, handheld: 0 });
    d.then({ ...A, name: 'C', handheld: 0 });
    expect(d.queued).toBe(2);
    const seen: string[] = [];
    run(d, 20, (f) => {
      if (seen[seen.length - 1] !== f.shot) seen.push(f.shot!);
    });
    expect(seen).toEqual(['A', 'B', 'C']);
    const e = new Director();
    e.play(A, { cut: true });
    e.then(B);
    e.play(A);
    expect(e.queued).toBe(0);
  });
  it('hold: the next queued shot waits for the hold seconds', () => {
    const d = new Director();
    d.play({ ...B, handheld: 0 }, { cut: true });
    d.then({ ...A, handheld: 0 });
    // B is 5 s long and holds 1 s: still B at 5.5 s, A by 6.2 s
    expect(run(d, 5.5).shot).toBe('B');
    expect(run(d, 0.8).shot).toBe('A');
  });
  it('channels keep their last value and cues fire once each', () => {
    const shot: Shot = { ...A, handheld: 0, channels: { door: [[0, 0], [0.5, 1]] }, cues: [{ at: 0.25, name: 'x' }, { at: 0.9, name: 'y' }] };
    const d = new Director();
    d.play(shot, { cut: true });
    const cues: string[] = [];
    const f = run(d, 9, (fr) => cues.push(...fr.cues));
    expect(cues).toEqual(['x', 'y']);
    expect(f.values.door).toBe(1);
    d.play(A); // a shot without that channel: the door stays open
    expect(run(d, 1).values.door).toBe(1);
    // play it again: cues fire again
    d.play(shot, { cut: true });
    const again: string[] = [];
    run(d, 9, (fr) => again.push(...fr.cues));
    expect(again).toEqual(['x', 'y']);
  });
  it('bad frame times: NaN, negative, zero, infinite and huge never break it', () => {
    const d = new Director();
    d.play(A, { cut: true });
    const base = d.update(0);
    for (const bad of [NaN, -1, 0, Infinity, -Infinity]) {
      const f = d.update(bad);
      expect(f.eye.every(Number.isFinite)).toBe(true);
    }
    const huge = d.update(1e9); // counts as one long frame, MAX_DT
    expect(huge.elapsed).toBeLessThanOrEqual(base.elapsed + MAX_DT + 1e-9);
  });
  it('is deterministic and agrees at 30 and 60 fps', () => {
    const a = new Director();
    const b = new Director();
    const c = new Director();
    for (const d of [a, b, c]) d.play(SHOTS.snowWalk, { cut: true });
    run(a, 7);
    run(b, 7);
    for (let i = 0; i < 210; i++) c.update(1 / 30);
    expect(a.frame.eye).toEqual(b.frame.eye);
    expect(dist(a.frame.eye, c.frame.eye)).toBeLessThan(0.03);
  });
  it('reduced motion: no drift, no zoom, moves 1.6 times slower, and still arrives', () => {
    const r = new Director({ reducedMotion: true });
    r.play(A, { cut: true });
    const f0 = run(r, 3);
    expect(f0.fov).toBeCloseTo(40, 9); // no zoom
    expect(f0.roll).toBe(0);
    const f1 = run(r, 0);
    const f2 = run(r, 0.001);
    void f1; void f2;
    const normal = new Director();
    normal.play({ ...A, handheld: 0 }, { cut: true });
    run(normal, 6.2);
    expect(normal.playing).toBe(false);
    run(r, 6.5); // 3 + 6.5 = 9.5 s: the reduced one is not yet at 1.6 * 6 = 9.6
    expect(r.playing).toBe(true);
    run(r, 0.5);
    expect(r.playing).toBe(false);
    const end = r.frame;
    expect(dist(end.eye, [0, 1.5, 2])).toBeLessThan(1e-6); // exactly still, and at the end
    expect(end.fov).toBeCloseTo(40, 9);
  });
  it('rejects shots with a bad field of view or length when they are played', () => {
    const d = new Director();
    expect(() => d.play({ ...A, fov: [2, 40] })).toThrow();
    expect(() => d.play({ ...A, seconds: 0 })).toThrow();
  });
});

describe('the shots of this world', () => {
  const sampleEyes = (name: keyof typeof SHOTS, n = 200): { eye: V3; look: V3 }[] => {
    const d = new Director();
    d.play({ ...SHOTS[name], handheld: 0 }, { cut: true });
    const out: { eye: V3; look: V3 }[] = [];
    const total = SHOTS[name].seconds;
    for (let i = 0; i <= n; i++) {
      const f = d.update(i === 0 ? 0 : total / n > MAX_DT ? MAX_DT : total / n);
      out.push({ eye: f.eye, look: f.look });
    }
    return out;
  };
  it('every shot compiles, the tour names exist and no shot is played twice in a row', () => {
    for (const n of SHOT_NAMES) {
      const d = new Director();
      expect(() => d.play(SHOTS[n])).not.toThrow();
    }
    for (const n of TOUR) expect(SHOT_NAMES).toContain(n);
    for (let i = 1; i < TOUR.length; i++) expect(TOUR[i]).not.toBe(TOUR[i - 1]);
  });
  it('each shot starts where the one before it ends, except the cut out of the nook', () => {
    for (let i = 1; i < TOUR.length; i++) {
      const prev = SHOTS[TOUR[i - 1]!];
      const next = SHOTS[TOUR[i]!];
      const a = prev.eye[prev.eye.length - 1] as V3;
      const b = next.eye[0] as V3;
      if (TOUR[i] === 'doorOut') expect(dist(a, b)).toBeGreaterThan(CUT_DISTANCE);
      else expect(dist(a, b)).toBeLessThan(1e-9);
    }
  });
  it('outdoors the eye stays above the snow, indoors it stays in the nook\'s air and out of its walls, and the look is never degenerate', () => {
    for (const n of SHOT_NAMES) {
      for (const { eye, look } of sampleEyes(n)) {
        expect(Math.hypot(look[0] - eye[0], look[1] - eye[1], look[2] - eye[2])).toBeGreaterThan(0.5);
        const pitch = Math.atan2(look[1] - eye[1], Math.hypot(look[0] - eye[0], look[2] - eye[2]));
        expect(Math.abs(pitch)).toBeLessThan((80 * Math.PI) / 180);
        if (locationOfEye(eye[1]) === 'outside') expect(eye[1]).toBeGreaterThan(terrainHeight(eye[0], eye[2]) + 1.1);
        else {
          const x = eye[0] - NOOK_ORIGIN[0];
          const y = eye[1] - NOOK_ORIGIN[1];
          const z = eye[2] - NOOK_ORIGIN[2];
          expect(y).toBeGreaterThan(0.6);
          expect(y).toBeLessThan(NOOK.h - 0.3);
          expect(Math.abs(x)).toBeLessThan(NOOK.hx - 0.2);
          expect(z).toBeGreaterThan(-NOOK.hz); // never behind the back wall (the open side is +z)
        }
      }
    }
  });
  it('the push-out goes through the doorway and never through a log', () => {
    const pts = sampleEyes('doorOut', 300);
    const startLocal = worldToCabin(pts[0]!.eye);
    expect(startLocal[2]).toBeLessThan(CABIN.hz); // starts just inside the door
    expect(startLocal[2]).toBeGreaterThan(CABIN.hz - 0.9);
    let crossed = false;
    for (const { eye } of pts) {
      const l = worldToCabin(eye);
      // inside the wall's thickness the eye must be inside the opening: the door is 1 m wide and 2 m tall
      if (Math.abs(l[2] - CABIN.hz) < 0.25) {
        crossed = true;
        expect(Math.abs(l[0] - CABIN.doorX)).toBeLessThan(0.4);
        expect(l[1]).toBeGreaterThan(1.0);
        expect(l[1]).toBeLessThan(1.9);
      }
      // never inside the footprint's side walls or back
      if (l[2] < CABIN.hz - 0.25) {
        expect(Math.abs(l[0])).toBeLessThan(CABIN.hx - 0.3);
        expect(l[2]).toBeGreaterThan(-CABIN.hz);
      }
    }
    expect(crossed).toBe(true);
    const endLocal = worldToCabin(pts[pts.length - 1]!.eye);
    expect(endLocal[2]).toBeGreaterThan(CABIN.hz + 1.5); // ends well outside
  });
  it('the door is open before the camera reaches the doorway', () => {
    const d = new Director();
    d.play({ ...SHOTS.doorOut, handheld: 0 }, { cut: true });
    let openAtDoor = -1;
    run(d, SHOTS.doorOut.seconds, (f) => {
      const l = worldToCabin(f.eye);
      if (openAtDoor < 0 && l[2] >= CABIN.hz) openAtDoor = f.values.door ?? 0;
    });
    expect(openAtDoor).toBeGreaterThan(0.85);
    expect(d.frame.values.door).toBe(1);
  });
  it('the walk keeps its distance from Chamgadad and the bunny, and its pace is a walk', () => {
    const pts = sampleEyes('snowWalk', 300);
    for (const { eye } of pts) {
      expect(Math.hypot(eye[0] - SPOTS.chamgadadStage[0], eye[2] - SPOTS.chamgadadStage[2])).toBeGreaterThan(3.5);
      expect(Math.hypot(eye[0] - SPOTS.bunny[0], eye[2] - SPOTS.bunny[2])).toBeGreaterThan(1.5);
    }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i]!.eye, pts[i - 1]!.eye);
    const mean = len / SHOTS.snowWalk.seconds;
    expect(mean).toBeGreaterThan(0.6);
    expect(mean).toBeLessThan(2.2); // metres a second, on average
  });
  it('no shot turns faster than a calm pan (0.6 degrees a frame, 36 a second, at its peak)', () => {
    for (const n of SHOT_NAMES) {
      const d = new Director();
      d.play({ ...SHOTS[n], handheld: 0 }, { cut: true });
      let prev = d.update(0);
      let worst = 0;
      run(d, SHOTS[n].seconds, (f) => {
        const a: V3 = [prev.look[0] - prev.eye[0], prev.look[1] - prev.eye[1], prev.look[2] - prev.eye[2]];
        const b: V3 = [f.look[0] - f.eye[0], f.look[1] - f.eye[1], f.look[2] - f.eye[2]];
        worst = Math.max(worst, angleBetween(a, b));
        prev = f;
      });
      expect((worst * 180) / Math.PI, n).toBeLessThan(0.6);
    }
  });
  it('no shot moves faster than a calm pace (peak speed, eased)', () => {
    for (const n of SHOT_NAMES) {
      const d = new Director();
      d.play({ ...SHOTS[n], handheld: 0 }, { cut: true });
      let prev = d.update(0).eye;
      let peak = 0;
      run(d, SHOTS[n].seconds, (f) => {
        peak = Math.max(peak, dist(f.eye, prev) / STEP);
        prev = f.eye;
      });
      expect(peak).toBeLessThan(n === 'finale' ? 3.2 : 2.6);
    }
  });
  it('the cabin point and the nook point map to the places the world builds them', () => {
    const c = cabinToWorld(0, 0, 0);
    expect(c[0]).toBeCloseTo(CABIN_SITE.x, 9);
    expect(c[2]).toBeCloseTo(CABIN_SITE.z, 9);
    const back = worldToCabin(cabinToWorld(0.3, 1.2, 2.5));
    expect(back[0]).toBeCloseTo(0.3, 9);
    expect(back[2]).toBeCloseTo(2.5, 9);
    // the door faces the origin: a point 5 m out of the door is nearer to it than the cabin is
    const out = cabinToWorld(0, 0, 5);
    expect(Math.hypot(out[0], out[2])).toBeLessThan(Math.hypot(CABIN_SITE.x, CABIN_SITE.z));
    expect(locationOfEye(NOOK_ORIGIN[1] + 1.3)).toBe('nook');
    expect(locationOfEye(EYE_HEIGHT)).toBe('outside');
    expect(Math.hypot(SPOTS.chamgadadStage[0] - STAGE.x, SPOTS.chamgadadStage[2] - STAGE.z)).toBeLessThan(STAGE.radius);
    expect(Math.hypot(SPOTS.bunny[0] - STAGE.x, SPOTS.bunny[2] - STAGE.z)).toBeLessThan(STAGE.radius);
  });
});

describe('boundaries of this phase', () => {
  const read = (p: string): string => readFileSync(p, 'utf8');
  it('the pure files do not import three or touch the DOM, the clock or random', () => {
    for (const f of ['src/core/directorMath.ts', 'src/core/bootTasks.ts', 'src/ui/bootMath.ts', 'src/ui/bootText.ts', 'src/world/shots.ts']) {
      const t = read(f);
      expect(/from\s*['"]three['"]/.test(t), f).toBe(false);
      expect(/\bdocument\b|\bwindow\b|Math\.random|Date\.now|performance\.now/.test(t.replace(/\/\/.*$/gm, '')), f).toBe(false);
    }
  });
  it('the director knows nothing about the world or the characters', () => {
    for (const f of ['src/core/director.ts', 'src/core/directorMath.ts', 'src/core/bootTasks.ts']) {
      expect(/from\s*['"]\.\.\/(world|character|ui|acts)/.test(read(f)), f).toBe(false);
    }
  });
  it('no character file imports the director, the boot screen or the tour', () => {
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p, acc);
        else if (p.endsWith('.ts')) acc.push(p);
      }
      return acc;
    };
    for (const f of walk('src/character')) expect(/director|ui\/boot|tourView/.test(read(f)), f).toBe(false);
  });
  it('the tour view is opt-in: only `?tour` builds it, and the default page never touches it', () => {
    const main = read('src/main.ts');
    expect(main).toContain("params.has('tour')");
    expect(main).toMatch(/if \(tourParam\) \{\s*scene\.background[^]*?tour = createTour/);
  });
  it('the optional door props stay off and wordless in the tour', () => {
    const t = read('src/tourView.ts');
    expect(t).not.toMatch(/createDoorProps|plaque|sign/);
  });
});
