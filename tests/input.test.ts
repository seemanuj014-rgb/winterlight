import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GestureClassifier, GESTURE_DEFAULTS, normalizePointer, type GestureEvent, type Sample, type PointerKind } from '../src/input/gestureMath';
import { choosePick, effectiveRadius, screenRadius, PICK_DEFAULTS, type PickCandidate } from '../src/input/pickMath';
import { TiltFilter, toScreenFrame, screenQuarter, nextTiltState, blendParallax, wrapDeg, TILT_DEFAULTS, type TiltState, type TiltEvent } from '../src/input/tiltMath';
import { HAPTIC_PATTERNS, HAPTIC_NAMES, sanitizePattern, HapticLimiter, MAX_PATTERN_LENGTH, MAX_PATTERN_MS, MAX_SEGMENT_MS } from '../src/input/hapticsMath';
import { KeyboardNav, KEY_NUDGE_PX, type KeyAction, type KeyInput } from '../src/input/keyboardMath';

const s = (id: number, phase: Sample['phase'], x: number, y: number, t: number, kind: PointerKind = 'touch'): Sample => ({ id, phase, x, y, t, kind });
const types = (e: GestureEvent[]): string[] => e.map((g) => g.type);
function run(c: GestureClassifier, samples: Sample[]): GestureEvent[] {
  const out: GestureEvent[] = [];
  for (const x of samples) out.push(...c.push(x));
  return out;
}
/** every press ends once, every start has its end, nothing is left open */
function balanced(ev: GestureEvent[]): boolean {
  let open: string | null = null;
  let pressed = false;
  for (const g of ev) {
    if (g.type === 'press') {
      if (pressed || open) return false;
      pressed = true;
    } else if (g.type === 'tap' || g.type === 'cancel') {
      if (!pressed || open) return false;
      pressed = false;
    } else if (g.type === 'holdstart') {
      if (!pressed || open) return false;
      open = 'hold';
    } else if (g.type === 'holdend') {
      if (open !== 'hold') return false;
      open = null;
      if (g.reason !== 'moved') pressed = false;
    } else if (g.type === 'dragstart') {
      if (!pressed || open) return false;
      open = 'drag';
    } else if (g.type === 'drag') {
      if (open !== 'drag') return false;
    } else if (g.type === 'dragend') {
      if (open !== 'drag') return false;
      open = null;
      pressed = false;
    }
  }
  return !pressed && !open;
}

describe('gesture classification', () => {
  it('a quick press and release is a tap', () => {
    const c = new GestureClassifier();
    const ev = run(c, [s(1, 'down', 100, 100, 0), s(1, 'up', 102, 101, 120)]);
    expect(types(ev)).toEqual(['press', 'tap']);
    expect(ev[1].duration).toBe(120);
    expect(c.state).toBe('idle');
  });
  it('a press that stays still for 500 ms is a hold, then ends on release', () => {
    const c = new GestureClassifier();
    const ev = run(c, [s(1, 'down', 50, 50, 0), s(1, 'move', 52, 50, 200), s(1, 'up', 52, 50, 900)]);
    expect(types(ev)).toEqual(['press', 'holdstart', 'holdend']);
    expect(ev[1].t).toBe(500);
    expect(ev[2].reason).toBe('release');
  });
  it('tick starts a hold with no new sample, and holdDeadline says when', () => {
    const c = new GestureClassifier();
    c.push(s(1, 'down', 5, 5, 1000));
    expect(c.holdDeadline()).toBe(1500);
    expect(c.tick(1400)).toEqual([]);
    expect(types(c.tick(1600))).toEqual(['holdstart']);
    expect(c.holdDeadline()).toBeNull();
  });
  it('moving past the slop is a drag, with the first drag carrying the whole offset', () => {
    const c = new GestureClassifier();
    const ev = run(c, [s(1, 'down', 0, 0, 0), s(1, 'move', 5, 0, 20), s(1, 'move', 30, 0, 40), s(1, 'move', 40, 5, 60), s(1, 'up', 40, 5, 80)]);
    expect(types(ev)).toEqual(['press', 'dragstart', 'drag', 'drag', 'dragend']);
    expect(ev[2].ddx).toBe(30);
    expect(ev[3].ddx).toBe(10);
    expect(ev[3].ddy).toBe(5);
  });
  it('slop is different for a finger and a mouse', () => {
    const a = new GestureClassifier();
    const b = new GestureClassifier();
    const ta = run(a, [s(1, 'down', 0, 0, 0, 'touch'), s(1, 'move', 10, 0, 20, 'touch'), s(1, 'up', 10, 0, 40, 'touch')]);
    const tb = run(b, [s(1, 'down', 0, 0, 0, 'mouse'), s(1, 'move', 10, 0, 20, 'mouse'), s(1, 'up', 10, 0, 40, 'mouse')]);
    expect(types(ta)).toEqual(['press', 'tap']);
    expect(types(tb)).toEqual(['press', 'dragstart', 'drag', 'dragend']);
  });
  it('a hold forgives wobble up to 28 px, then becomes a drag', () => {
    const c = new GestureClassifier();
    const ev = run(c, [s(1, 'down', 0, 0, 0), s(1, 'move', 20, 0, 600), s(1, 'move', 40, 0, 700), s(1, 'up', 40, 0, 800)]);
    expect(types(ev)).toEqual(['press', 'holdstart', 'holdend', 'dragstart', 'drag', 'dragend']);
    expect(ev[2].reason).toBe('moved');
    expect(balanced(ev)).toBe(true);
  });
  it('a second finger cancels the gesture and everything is ignored until all are up', () => {
    const c = new GestureClassifier();
    const ev = run(c, [s(1, 'down', 0, 0, 0), s(2, 'down', 90, 90, 50), s(1, 'move', 40, 0, 60), s(2, 'up', 90, 90, 70), s(1, 'up', 40, 0, 80)]);
    expect(types(ev)).toEqual(['press', 'cancel']);
    expect(ev[1].reason).toBe('multi');
    // after all are up, a new tap works
    const more = run(c, [s(3, 'down', 5, 5, 200), s(3, 'up', 5, 5, 260)]);
    expect(types(more)).toEqual(['press', 'tap']);
  });
  it('a third finger and a finger landing during a hold also cancel', () => {
    const c = new GestureClassifier();
    const ev = run(c, [s(1, 'down', 0, 0, 0), s(1, 'move', 1, 1, 600), s(2, 'down', 50, 50, 700), s(1, 'up', 1, 1, 710), s(2, 'up', 50, 50, 720)]);
    expect(types(ev)).toEqual(['press', 'holdstart', 'holdend']);
    expect(ev[2].reason).toBe('multi');
  });
  it('the system cancelling a touch is a cancel, not a tap', () => {
    const c = new GestureClassifier();
    const ev = run(c, [s(1, 'down', 0, 0, 0), s(1, 'cancel', 0, 0, 40)]);
    expect(types(ev)).toEqual(['press', 'cancel']);
    expect(ev[1].reason).toBe('cancel');
  });
  it('a lost up (a second down for the same pointer) restarts cleanly', () => {
    const c = new GestureClassifier();
    const ev = run(c, [s(1, 'down', 0, 0, 0), s(1, 'down', 9, 9, 300), s(1, 'up', 9, 9, 340)]);
    expect(types(ev)).toEqual(['press', 'cancel', 'press', 'tap']);
    expect(ev[1].reason).toBe('reset');
    expect(balanced(ev)).toBe(true);
  });
  it('an up or move with no press, or from another pointer, does nothing', () => {
    const c = new GestureClassifier();
    expect(run(c, [s(1, 'up', 0, 0, 0), s(1, 'move', 5, 5, 10), s(1, 'cancel', 0, 0, 20)])).toEqual([]);
    c.push(s(1, 'down', 0, 0, 100));
    expect(run(c, [s(7, 'move', 90, 90, 110), s(7, 'up', 90, 90, 120)])).toEqual([]);
    expect(c.state).toBe('pressed');
  });
  it('NaN and infinity are dropped without a trace', () => {
    const c = new GestureClassifier();
    c.push(s(1, 'down', 0, 0, 0));
    expect(c.push(s(1, 'move', NaN, 0, 10))).toEqual([]);
    expect(c.push(s(1, 'move', 0, Infinity, 10))).toEqual([]);
    expect(c.push(s(1, 'move', 0, 0, NaN))).toEqual([]);
    expect(c.tick(NaN)).toEqual([]);
    expect(types(c.push(s(1, 'up', 0, 0, 50)))).toEqual(['tap']);
  });
  it('time that goes backwards is held at the last time seen', () => {
    const c = new GestureClassifier();
    c.push(s(1, 'down', 0, 0, 1000));
    const ev = c.push(s(1, 'up', 0, 0, 400));
    expect(ev[0].type).toBe('tap');
    expect(ev[0].duration).toBe(0);
    expect(ev[0].t).toBe(1000);
  });
  it('a move after the hold was due starts the hold first, in order', () => {
    const c = new GestureClassifier();
    c.push(s(1, 'down', 0, 0, 0));
    const ev = c.push(s(1, 'move', 3, 0, 800));
    expect(types(ev)).toEqual(['holdstart']);
  });
  it('an up after the hold was due still reports the hold, never a tap', () => {
    const c = new GestureClassifier();
    c.push(s(1, 'down', 0, 0, 0));
    expect(types(c.push(s(1, 'up', 0, 0, 800)))).toEqual(['holdstart', 'holdend']);
  });
  it('reset ends everything and forgets every pointer', () => {
    const c = new GestureClassifier();
    c.push(s(1, 'down', 0, 0, 0));
    c.push(s(2, 'down', 5, 5, 10));
    expect(c.ignoring).toBe(true);
    c.reset(20);
    expect(c.ignoring).toBe(false);
    expect(types(run(c, [s(3, 'down', 0, 0, 100), s(3, 'up', 0, 0, 150)]))).toEqual(['press', 'tap']);
    const d = new GestureClassifier();
    d.push(s(1, 'down', 0, 0, 0));
    const ev = d.reset(30);
    expect(types(ev)).toEqual(['cancel']);
    expect(ev[0].reason).toBe('reset');
    expect(d.reset(40)).toEqual([]);
  });
  it('a stray lostpointercapture-style cancel after a normal up is ignored', () => {
    const c = new GestureClassifier();
    run(c, [s(1, 'down', 0, 0, 0), s(1, 'up', 0, 0, 50)]);
    expect(c.push(s(1, 'cancel', 0, 0, 51))).toEqual([]);
    expect(types(run(c, [s(2, 'down', 0, 0, 100), s(2, 'up', 0, 0, 120)]))).toEqual(['press', 'tap']);
  });
  it('fuzz: any stream keeps every press and start paired, and never throws', () => {
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let run_ = 0; run_ < 300; run_++) {
      const c = new GestureClassifier();
      const all: GestureEvent[] = [];
      let t = 0;
      for (let i = 0; i < 60; i++) {
        t += rnd() < 0.1 ? -rnd() * 100 : rnd() * 400;
        const id = Math.floor(rnd() * 3);
        const r = rnd();
        const phase: Sample['phase'] = r < 0.3 ? 'down' : r < 0.65 ? 'move' : r < 0.95 ? 'up' : 'cancel';
        const kind: PointerKind = (['touch', 'mouse', 'pen', 'key'] as const)[Math.floor(rnd() * 4)];
        const bad = rnd() < 0.03;
        all.push(...c.push(s(id, phase, bad ? NaN : rnd() * 200, rnd() * 200, t, kind)));
        if (rnd() < 0.1) all.push(...c.tick(t + rnd() * 600));
      }
      all.push(...c.reset(t + 1));
      expect(balanced(all)).toBe(true);
      expect(c.state).toBe('idle');
      for (const g of all) for (const k of ['x', 'y', 'dx', 'dy', 'ddx', 'ddy', 'duration', 't'] as const) expect(Number.isFinite(g[k])).toBe(true);
    }
  });
  it('config can be overridden and the defaults are not changed by it', () => {
    const c = new GestureClassifier({ holdMs: 100, slop: { touch: 2, mouse: 6, pen: 9, key: 6 } });
    expect(types(run(c, [s(1, 'down', 0, 0, 0), s(1, 'up', 0, 0, 150)]))).toEqual(['press', 'holdstart', 'holdend']);
    expect(GESTURE_DEFAULTS.holdMs).toBe(500);
    expect(GESTURE_DEFAULTS.slop.touch).toBe(14);
  });
  it('normalizePointer: -1..1, y up, bad input gives 0', () => {
    expect(normalizePointer(0, 0, 200, 100)).toEqual({ x: -1, y: 1 });
    expect(normalizePointer(200, 100, 200, 100)).toEqual({ x: 1, y: -1 });
    expect(normalizePointer(100, 50, 200, 100)).toEqual({ x: 0, y: 0 });
    expect(normalizePointer(900, -900, 200, 100)).toEqual({ x: 1, y: 1 });
    expect(normalizePointer(NaN, 1, 200, 100)).toEqual({ x: 0, y: 0 });
    expect(normalizePointer(1, 1, 0, 100)).toEqual({ x: 0, y: 0 });
  });
});

describe('picking', () => {
  const cand = (o: Partial<PickCandidate> & { id: string }): PickCandidate => ({ x: 100, y: 100, radiusPx: 4, depth: 5, direct: false, ...o });
  it('every target is at least as big as a finger (28 px), a mouse 14, a pen 18', () => {
    expect(effectiveRadius(2, 'touch')).toBe(28);
    expect(effectiveRadius(2, 'mouse')).toBe(14);
    expect(effectiveRadius(2, 'pen')).toBe(18);
    expect(effectiveRadius(60, 'touch')).toBe(60);
    expect(effectiveRadius(NaN, 'touch')).toBe(28);
    expect(PICK_DEFAULTS.minRadius.key).toBe(0);
  });
  it('a tiny target is hit from near, and missed from far', () => {
    const c = [cand({ id: 'star' })];
    expect(choosePick(120, 100, 'touch', c)?.id).toBe('star');
    expect(choosePick(135, 100, 'touch', c)).toBeNull();
    expect(choosePick(120, 100, 'mouse', c)).toBeNull();
  });
  it('a direct ray hit counts even far from the centre, and beats a nearer non-direct target', () => {
    const c = [cand({ id: 'near', x: 100, y: 100 }), cand({ id: 'big', x: 300, y: 100, radiusPx: 5, direct: true })];
    expect(choosePick(100, 100, 'touch', c)?.id).toBe('big');
  });
  it('priority wins over everything, so a small animal beats the blanket under it', () => {
    const c = [cand({ id: 'blanket', radiusPx: 200, direct: true, priority: 0 }), cand({ id: 'cat', radiusPx: 6, priority: 5 })];
    expect(choosePick(105, 100, 'touch', c)?.id).toBe('cat');
  });
  it('then the one nearest its own middle (relative to its size) wins', () => {
    const c = [cand({ id: 'a', x: 80, y: 100, radiusPx: 40 }), cand({ id: 'b', x: 112, y: 100, radiusPx: 40 })];
    expect(choosePick(100, 100, 'touch', c)?.id).toBe('b');
  });
  it('then the nearer to the camera, then the id: list order never matters', () => {
    const a = cand({ id: 'a', depth: 9 });
    const b = cand({ id: 'b', depth: 3 });
    expect(choosePick(100, 100, 'touch', [a, b])?.id).toBe('b');
    expect(choosePick(100, 100, 'touch', [b, a])?.id).toBe('b');
    const x = cand({ id: 'x' });
    const y = cand({ id: 'y' });
    expect(choosePick(100, 100, 'touch', [x, y])?.id).toBe('x');
    expect(choosePick(100, 100, 'touch', [y, x])?.id).toBe('x');
  });
  it('shuffled lists always give the same answer', () => {
    const base: PickCandidate[] = [];
    for (let i = 0; i < 8; i++) base.push(cand({ id: 'c' + i, x: 90 + i * 3, y: 100 + (i % 3), radiusPx: 5 + i, depth: 4 + (i % 4) }));
    const want = choosePick(100, 100, 'touch', base)?.id;
    let seed = 7;
    for (let k = 0; k < 40; k++) {
      const l = [...base];
      for (let i = l.length - 1; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const j = seed % (i + 1);
        [l[i], l[j]] = [l[j], l[i]];
      }
      expect(choosePick(100, 100, 'touch', l)?.id).toBe(want);
    }
  });
  it('the keyboard has no radius; only a direct hit counts', () => {
    expect(choosePick(100, 100, 'key', [cand({ id: 'a' })])?.id).toBe('a'); // distance 0 is still inside radius 4
    expect(choosePick(110, 100, 'key', [cand({ id: 'a', radiusPx: 0 })])).toBeNull();
  });
  it('bad input: NaN touch, NaN candidates, empty list', () => {
    expect(choosePick(NaN, 0, 'touch', [cand({ id: 'a' })])).toBeNull();
    expect(choosePick(100, 100, 'touch', [cand({ id: 'a', x: NaN })])).toBeNull();
    expect(choosePick(100, 100, 'touch', [cand({ id: 'a', depth: NaN })])).toBeNull();
    expect(choosePick(100, 100, 'touch', [])).toBeNull();
  });
  it('screenRadius: a bigger or nearer ball is bigger, behind the camera or bad input is 0', () => {
    const near = screenRadius(0.1, 2, 50, 800);
    expect(near).toBeGreaterThan(screenRadius(0.1, 4, 50, 800));
    expect(screenRadius(0.2, 4, 50, 800)).toBeCloseTo(screenRadius(0.1, 2, 50, 800), 6);
    expect(screenRadius(0.1, -2, 50, 800)).toBe(0);
    expect(screenRadius(0.1, 0, 50, 800)).toBe(0);
    expect(screenRadius(0, 2, 50, 800)).toBe(0);
    expect(screenRadius(0.1, 2, 0, 800)).toBe(0);
    expect(screenRadius(0.1, 2, 180, 800)).toBe(0);
    expect(screenRadius(NaN, 2, 50, 800)).toBe(0);
  });
});

describe('tilt', () => {
  const settle = (f: TiltFilter, n = 120): void => {
    for (let i = 0; i < n; i++) f.step(1 / 60);
  };
  it('the first reading is neutral, so a phone held at an angle starts centred', () => {
    const f = new TiltFilter();
    expect(f.push(5, 50, 0)).toBe(true);
    settle(f);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
  });
  it('a dead zone ignores a shaky hand', () => {
    const f = new TiltFilter();
    f.push(0, 0, 0);
    f.push(0.7, -0.7, 0);
    settle(f, 30);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
  });
  it('tilt beyond the dead zone moves the output, in proportion, up to a limit of 1', () => {
    const f = new TiltFilter({ restSec: 1e9 });
    f.push(0, 0, 0);
    f.push(7.8, 0, 0); // 7 degrees past the 0.8 dead zone of a 14 degree range
    settle(f, 600);
    expect(Math.abs(f.x)).toBeCloseTo(0.5, 2);
    f.push(80, 80, 0);
    settle(f, 600);
    expect(Math.abs(f.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.x)).toBeCloseTo(1, 3);
  });
  it('the output follows smoothly, and frame rate does not change where it ends up', () => {
    const run = (hz: number): number => {
      const f = new TiltFilter({ restSec: 1e9 });
      f.push(0, 0, 0);
      f.push(14, 0, 0);
      for (let i = 0; i < hz * 0.3; i++) f.step(1 / hz);
      return f.x;
    };
    expect(Math.abs(run(30) - run(60))).toBeLessThan(0.02);
    expect(Math.abs(run(60) - run(144))).toBeLessThan(0.02);
    const f = new TiltFilter({ restSec: 1e9 });
    f.push(0, 0, 0);
    f.push(14, 0, 0);
    f.step(1 / 60);
    expect(Math.abs(f.x)).toBeLessThan(0.1);
  });
  it('the neutral re-centres by itself: sitting back stops counting as a tilt', () => {
    const f = new TiltFilter();
    f.push(0, 0, 0);
    f.push(10, 0, 0);
    settle(f, 30);
    const early = Math.abs(f.x);
    for (let i = 0; i < 60 * 40; i++) {
      f.push(10, 0, 0);
      f.step(1 / 60);
    }
    expect(early).toBeGreaterThan(0.3);
    expect(Math.abs(f.x)).toBeLessThan(0.02);
  });
  it('turning the screen makes the wherever-it-is-now neutral', () => {
    const f = new TiltFilter({ restSec: 1e9 });
    f.push(0, 0, 0);
    f.push(10, 0, 0);
    settle(f, 200);
    expect(Math.abs(f.x)).toBeGreaterThan(0.3);
    f.push(10, 0, 90);
    settle(f, 200);
    expect(f.x).toBeCloseTo(0, 6);
    expect(f.y).toBeCloseTo(0, 6);
  });
  it('the four screen angles are quarter turns of one another', () => {
    const g = 12;
    const b = -7;
    const r0 = toScreenFrame(g, b, 0);
    const r90 = toScreenFrame(g, b, 90);
    const r180 = toScreenFrame(g, b, 180);
    const r270 = toScreenFrame(g, b, 270);
    expect(r0).toEqual({ u: g, v: b });
    expect(r180.u).toBeCloseTo(-r0.u, 9);
    expect(r180.v).toBeCloseTo(-r0.v, 9);
    expect(r270.u).toBeCloseTo(-r90.u, 9);
    expect(r270.v).toBeCloseTo(-r90.v, 9);
    // 90 is 0 turned one quarter: (u, v) -> (v, -u)
    expect(r90.u).toBeCloseTo(r0.v, 9);
    expect(r90.v).toBeCloseTo(-r0.u, 9);
    for (const r of [r0, r90, r180, r270]) expect(Math.hypot(r.u, r.v)).toBeCloseTo(Math.hypot(g, b), 9);
  });
  it('odd screen angles round to a quarter; nonsense is 0', () => {
    expect(screenQuarter(-90)).toBe(270);
    expect(screenQuarter(360)).toBe(0);
    expect(screenQuarter(95)).toBe(90);
    expect(screenQuarter(-1)).toBe(0);
    expect(screenQuarter(NaN)).toBe(0);
    expect(screenQuarter(540)).toBe(180);
  });
  it('wrapDeg stays in (-180, 180]', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(180)).toBe(180);
  });
  it('reduced motion is exactly 0 always, and coming back resumes from centre', () => {
    const f = new TiltFilter({}, true);
    f.push(0, 0, 0);
    f.push(30, 30, 0);
    settle(f);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    const g = new TiltFilter({ restSec: 1e9 });
    g.push(0, 0, 0);
    g.push(14, 0, 0);
    settle(g, 100);
    expect(g.x).not.toBe(0);
    g.setReduced(true);
    expect(g.x).toBe(0);
    g.step(1 / 60);
    expect(g.x).toBe(0);
  });
  it('null, undefined, NaN and infinity readings are refused and change nothing', () => {
    const f = new TiltFilter();
    expect(f.push(null, null, 0)).toBe(false);
    expect(f.push(undefined, 3, 0)).toBe(false);
    expect(f.push(NaN, 3, 0)).toBe(false);
    expect(f.push(3, Infinity, 0)).toBe(false);
    expect(f.hasSample).toBe(false);
    f.push(1, 1, 0);
    f.step(NaN);
    f.step(-1);
    f.step(0);
    expect(f.x).toBe(0);
  });
  it('a huge dt is clamped and the output stays finite', () => {
    const f = new TiltFilter();
    f.push(0, 0, 0);
    f.push(14, 0, 0);
    f.step(1e9);
    expect(Number.isFinite(f.x)).toBe(true);
    expect(Math.abs(f.x)).toBeLessThanOrEqual(1);
  });
  it('reset forgets the neutral', () => {
    const f = new TiltFilter();
    f.push(0, 0, 0);
    f.reset();
    expect(f.hasSample).toBe(false);
  });
  it('permission machine: desktop has no sensor', () => {
    expect(nextTiltState('off', 'init-unsupported')).toBe('unsupported');
    let st: TiltState = 'off';
    st = nextTiltState(st, 'init-unsupported');
    for (const ev of ['granted', 'sample', 'enable', 'init-listen', 'init-needs-permission'] as TiltEvent[]) st = nextTiltState(st, ev);
    expect(st).toBe('unsupported');
  });
  it('permission machine: iOS asks first, then waits, then is on', () => {
    let st: TiltState = 'off';
    st = nextTiltState(st, 'init-needs-permission');
    expect(st).toBe('needs-permission');
    expect(nextTiltState(st, 'sample')).toBe('needs-permission');
    st = nextTiltState(st, 'granted');
    expect(st).toBe('waiting');
    st = nextTiltState(st, 'sample');
    expect(st).toBe('on');
    expect(nextTiltState(st, 'sample')).toBe('on');
  });
  it('permission machine: refused is denied, and only a grant can undo it; disable and enable', () => {
    let st: TiltState = nextTiltState('off', 'init-needs-permission');
    st = nextTiltState(st, 'refused');
    expect(st).toBe('denied');
    expect(nextTiltState(st, 'disable')).toBe('denied');
    expect(nextTiltState(st, 'enable')).toBe('denied');
    expect(nextTiltState(st, 'granted')).toBe('waiting');
    let on: TiltState = nextTiltState(nextTiltState('off', 'init-listen'), 'sample');
    on = nextTiltState(on, 'disable');
    expect(on).toBe('off');
    expect(nextTiltState(on, 'sample')).toBe('off');
    expect(nextTiltState(on, 'enable')).toBe('waiting');
  });
  it('permission machine: no sample in time means unsupported, but only while waiting', () => {
    expect(nextTiltState('waiting', 'timeout')).toBe('unsupported');
    expect(nextTiltState('on', 'timeout')).toBe('on');
    expect(nextTiltState('off', 'timeout')).toBe('off');
  });
  it('permission machine: any event from any state gives a known state', () => {
    const states: TiltState[] = ['unsupported', 'needs-permission', 'waiting', 'on', 'denied', 'off'];
    const evs: TiltEvent[] = ['init-unsupported', 'init-needs-permission', 'init-listen', 'sample', 'timeout', 'granted', 'refused', 'disable', 'enable'];
    for (const a of states) for (const e of evs) expect(states).toContain(nextTiltState(a, e));
  });
  it('blendParallax: tilt when on; a small share of the mouse otherwise; touch gives nothing; reduced is nothing', () => {
    const base = { tilt: { x: 0.5, y: -0.4 }, tiltState: 'on' as TiltState, pointer: { x: 1, y: 1, active: true, kind: 'mouse' as const }, reducedMotion: false };
    expect(blendParallax(base)).toEqual({ x: 0.5, y: -0.4 });
    expect(blendParallax({ ...base, tiltState: 'unsupported' })).toEqual({ x: 0.35, y: 0.35 });
    expect(blendParallax({ ...base, tiltState: 'off', mouseShare: 0.1 })).toEqual({ x: 0.1, y: 0.1 });
    expect(blendParallax({ ...base, tiltState: 'off', pointer: { ...base.pointer, kind: 'touch' } })).toEqual({ x: 0, y: 0 });
    expect(blendParallax({ ...base, tiltState: 'off', pointer: { ...base.pointer, active: false } })).toEqual({ x: 0, y: 0 });
    expect(blendParallax({ ...base, reducedMotion: true })).toEqual({ x: 0, y: 0 });
    expect(blendParallax({ ...base, tilt: { x: 9, y: -9 } })).toEqual({ x: 1, y: -1 });
  });
  it('defaults are what the docs say', () => {
    expect(TILT_DEFAULTS).toEqual({ rangeDeg: 14, deadDeg: 0.8, followSec: 0.22, restSec: 7 });
  });
});

describe('haptics', () => {
  it('every named pattern is already clean', () => {
    for (const n of HAPTIC_NAMES) expect(sanitizePattern(HAPTIC_PATTERNS[n])).toEqual([...HAPTIC_PATTERNS[n]]);
  });
  it('sanitise rounds, clamps to 1..200, drops NaN, caps length and total', () => {
    expect(sanitizePattern([10.4, 0, -5, 999, NaN, Infinity])).toEqual([10, 1, 1, 200]);
    expect(sanitizePattern(new Array(30).fill(5)).length).toBe(MAX_PATTERN_LENGTH);
    const total = sanitizePattern([200, 200, 200, 200]).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(MAX_PATTERN_MS);
    expect(Math.max(...sanitizePattern([5000]))).toBe(MAX_SEGMENT_MS);
    expect(sanitizePattern([])).toEqual([]);
    expect(sanitizePattern([NaN])).toEqual([]);
  });
  it('the limiter keeps 80 ms between buzzes', () => {
    const l = new HapticLimiter();
    expect(l.allow([10], 0)).toBe(true);
    expect(l.allow([10], 50)).toBe(false);
    expect(l.allow([10], 90)).toBe(true);
  });
  it('the limiter caps buzzing at 1.5 s in 10 s, and the window then slides', () => {
    const l = new HapticLimiter();
    let ok = 0;
    for (let t = 0; t < 9000; t += 100) if (l.allow([200], t)) ok++;
    expect(ok * 200).toBeLessThanOrEqual(1500);
    expect(ok).toBeGreaterThan(0);
    expect(l.allow([200], 20_000)).toBe(true);
  });
  it('the limiter refuses empty patterns and bad times, and a refusal costs nothing', () => {
    const l = new HapticLimiter();
    expect(l.allow([], 0)).toBe(false);
    expect(l.allow([10], NaN)).toBe(false);
    expect(l.allow([10], 0)).toBe(true);
  });
});

describe('keyboard', () => {
  const ids = ['a', 'b', 'c'];
  const make = (list: () => readonly string[] = () => ids): KeyboardNav => new KeyboardNav({ ids: list, positionOf: (id) => ({ x: ids.indexOf(id) * 100 + 10, y: 50 }) });
  let t = 0;
  const k = (nav: KeyboardNav, key: string, type: 'down' | 'up' = 'down', o: Partial<KeyInput> = {}) => nav.key({ key, type, t: (t += 10), ...o });
  const focuses = (a: KeyAction[]): (string | null)[] => a.filter((x) => x.kind === 'focus').map((x) => (x as { id: string | null }).id);
  const samples = (a: KeyAction[]) => a.filter((x) => x.kind === 'sample').map((x) => (x as { sample: Sample }).sample);

  it('Tab walks the targets and lets go past the last one so focus is never trapped', () => {
    const nav = make();
    expect(focuses(k(nav, 'Tab').actions)).toEqual(['a']);
    expect(focuses(k(nav, 'Tab').actions)).toEqual(['b']);
    expect(focuses(k(nav, 'Tab').actions)).toEqual(['c']);
    const r = k(nav, 'Tab');
    expect(r.handled).toBe(false); // the browser moves on
    expect(nav.focusId).toBeNull();
  });
  it('Shift+Tab goes backwards and leaves at the start; from nothing it enters at the end', () => {
    const nav = make();
    expect(focuses(k(nav, 'Tab', 'down', { shift: true }).actions)).toEqual(['c']);
    k(nav, 'Tab', 'down', { shift: true });
    k(nav, 'Tab', 'down', { shift: true });
    expect(nav.focusId).toBe('a');
    expect(k(nav, 'Tab', 'down', { shift: true }).handled).toBe(false);
    expect(nav.focusId).toBeNull();
  });
  it('arrows wrap round', () => {
    const nav = make();
    k(nav, 'ArrowRight');
    k(nav, 'ArrowLeft');
    expect(nav.focusId).toBe('c');
    k(nav, 'ArrowDown');
    expect(nav.focusId).toBe('a');
    k(nav, 'ArrowUp');
    expect(nav.focusId).toBe('c');
  });
  it('Enter with nothing focused focuses the first; the next Enter presses; release lets go', () => {
    const nav = make();
    expect(focuses(k(nav, 'Enter').actions)).toEqual(['a']);
    const down = samples(k(nav, 'Enter').actions);
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ id: -1, phase: 'down', kind: 'key', x: 10, y: 50 });
    expect(nav.pressing).toBe(true);
    const up = samples(k(nav, 'Enter', 'up').actions);
    expect(up[0]).toMatchObject({ phase: 'up', x: 10, y: 50 });
    expect(nav.pressing).toBe(false);
  });
  it('Space works the same as Enter, and the other key lifting does not let go', () => {
    const nav = make();
    k(nav, 'Tab');
    k(nav, ' ');
    expect(nav.pressing).toBe(true);
    expect(samples(k(nav, 'Enter', 'up').actions)).toEqual([]);
    expect(nav.pressing).toBe(true);
    expect(samples(k(nav, ' ', 'up').actions)).toHaveLength(1);
  });
  it('auto-repeat neither re-presses nor re-focuses', () => {
    const nav = make();
    k(nav, 'Tab');
    k(nav, 'Enter');
    for (let i = 0; i < 10; i++) {
      const r = k(nav, 'Enter', 'down', { repeat: true });
      expect(r.actions).toEqual([]);
      expect(r.handled).toBe(true);
    }
    const n2 = make();
    expect(k(n2, 'Enter', 'down', { repeat: true }).actions).toEqual([]);
    expect(n2.focusId).toBeNull();
  });
  it('arrows while pressing are a drag by 40 px a press, and the keys feed the same classifier', () => {
    const nav = make();
    const c = new GestureClassifier();
    const out: GestureEvent[] = [];
    const feed = (a: KeyAction[]): void => {
      for (const x of samples(a)) out.push(...c.push(x));
    };
    k(nav, 'Tab');
    feed(k(nav, 'Enter').actions);
    feed(k(nav, 'ArrowRight').actions);
    feed(k(nav, 'ArrowRight').actions);
    feed(k(nav, 'Enter', 'up').actions);
    expect(types(out)).toEqual(['press', 'dragstart', 'drag', 'drag', 'dragend']);
    expect(out[2].dx).toBe(KEY_NUDGE_PX);
    expect(out[3].dx).toBe(KEY_NUDGE_PX * 2);
    expect(nav.focusId).toBe('a'); // focus did not move while dragging
  });
  it('a tap of Enter is a tap and a held Enter is a hold, through the classifier', () => {
    const c = new GestureClassifier();
    const nav = make();
    k(nav, 'Tab');
    const d = samples(nav.key({ key: 'Enter', type: 'down', t: 0 }).actions);
    const u = samples(nav.key({ key: 'Enter', type: 'up', t: 100 }).actions);
    expect(types(run(c, [...d, ...u]))).toEqual(['press', 'tap']);
    const d2 = samples(nav.key({ key: 'Enter', type: 'down', t: 1000 }).actions);
    const u2 = samples(nav.key({ key: 'Enter', type: 'up', t: 2000 }).actions);
    expect(types(run(c, [...d2, ...u2]))).toEqual(['press', 'holdstart', 'holdend']);
  });
  it('Tab does nothing while pressing (and is kept from the browser)', () => {
    const nav = make();
    k(nav, 'Tab');
    k(nav, 'Enter');
    const r = k(nav, 'Tab');
    expect(r.actions).toEqual([]);
    expect(r.handled).toBe(true);
    expect(nav.focusId).toBe('a');
  });
  it('Escape cancels a press; with nothing held it clears the ring; with no ring it is left to the page', () => {
    const nav = make();
    k(nav, 'Tab');
    k(nav, 'Enter');
    const r = k(nav, 'Escape');
    expect(samples(r.actions)[0].phase).toBe('cancel');
    expect(nav.pressing).toBe(false);
    expect(r.handled).toBe(true);
    const r2 = k(nav, 'Escape');
    expect(focuses(r2.actions)).toEqual([null]);
    expect(k(nav, 'Escape').handled).toBe(false);
  });
  it('a focused target that is removed drops the ring and any press on it', () => {
    let list: string[] = ['a', 'b'];
    const nav = make(() => list);
    k(nav, 'Tab');
    k(nav, 'Enter');
    expect(nav.pressing).toBe(true);
    list = ['b'];
    const r = k(nav, 'ArrowRight');
    expect(samples(r.actions)[0].phase).toBe('cancel');
    expect(focuses(r.actions)).toContain(null);
    expect(nav.pressing).toBe(false);
  });
  it('no targets: nothing happens and nothing is taken from the page', () => {
    const nav = make(() => []);
    for (const key of ['Tab', 'ArrowRight', 'Enter', ' ']) expect(k(nav, key)).toEqual({ actions: [], handled: false });
  });
  it('ctrl, alt and meta chords belong to the browser; other keys are ignored', () => {
    const nav = make();
    expect(k(nav, 'Tab', 'down', { modified: true })).toEqual({ actions: [], handled: false });
    expect(k(nav, 'a')).toEqual({ actions: [], handled: false });
    expect(nav.focusId).toBeNull();
  });
  it('blur lets go of a held key and clears the ring', () => {
    const nav = make();
    k(nav, 'Tab');
    k(nav, 'Enter');
    const a = nav.blur(500);
    expect(samples(a)[0].phase).toBe('cancel');
    expect(focuses(a)).toEqual([null]);
    expect(nav.blur(600)).toEqual([]);
  });
  it('a mouse or finger taking over clears the ring', () => {
    const nav = make();
    k(nav, 'Tab');
    expect(focuses(nav.clearFocus())).toEqual([null]);
    expect(nav.clearFocus()).toEqual([]);
  });
  it('an unseen target position means no press, but the key is still ours', () => {
    const nav = new KeyboardNav({ ids: () => ['a'], positionOf: () => null });
    nav.key({ key: 'Tab', type: 'down', t: 0 });
    const r = nav.key({ key: 'Enter', type: 'down', t: 1 });
    expect(r.actions).toEqual([]);
    expect(r.handled).toBe(true);
  });
});

describe('the pure input files stay pure', () => {
  const PURE = ['gestureMath', 'pickMath', 'tiltMath', 'hapticsMath', 'keyboardMath'];
  for (const f of PURE) {
    it(`${f}.ts has no three, no DOM, no clock, no random`, () => {
      const src = readFileSync(`src/input/${f}.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/from\s+['"]three/);
      expect(src).not.toMatch(/\b(document|window|navigator|performance|requestAnimationFrame|setTimeout|localStorage)\b/);
      expect(src).not.toMatch(/Date\.now|Math\.random/);
    });
  }
  it('no input file carries a sentence of her words, and the canvas has no default label', () => {
    const src = readFileSync('src/input/input.ts', 'utf8');
    expect(src).not.toMatch(/aria-label['"],\s*['"][A-Za-z]/);
  });
  it('input files import neither the world, the characters, the acts nor the ui', () => {
    for (const f of ['input', 'picking', 'tilt', 'haptics', 'index', ...PURE]) {
      const src = readFileSync(`src/input/${f}.ts`, 'utf8');
      expect(src).not.toMatch(/from\s+['"]\.\.\/(world|character|acts|ui)\b/);
    }
  });
  it('the test view is opt-in: main.ts only builds it with ?input', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toMatch(/\?input|has\(['"]input['"]\)|get\(['"]input['"]\)/);
  });
});
