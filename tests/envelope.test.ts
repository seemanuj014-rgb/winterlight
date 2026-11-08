import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENV, DESCENT, HOVER, buildCarrier, buildFlap, buildLetter, envelopePose, envelopeCamera, envelopeStats, LANTERN_TOP_Y } from '../src/world/envelopeMath';
import { LetterMachine, LETTER } from '../src/acts/letterMath';

// Phase 27 (third quarter): the envelope's picture as pure maths and geometry, and how the real machine drives it. No word of the owner's is used here; the picture has no words at all.

const src = (p: string): string => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('envelope pose', () => {
  it('is not in the picture before it starts, and is hanging still at the end of the arrival', () => {
    expect(envelopePose(0, 0, 0).visible).toBe(false);
    const p = envelopePose(1, 0, 0);
    expect(p.visible).toBe(true);
    expect(Math.abs(p.y)).toBeLessThan(0.02);
    expect(p.alpha).toBe(1);
    expect(p.flap).toBe(0);
    expect(p.letterY).toBe(0);
    expect(p.letterOut).toBe(false);
  });
  it('comes down from above, never going back up, and slows as it settles', () => {
    let prev = Infinity;
    let prevStep = Infinity;
    // clock fixed at 0 so only the descent is measured, not the sway
    for (let i = 1; i <= 20; i++) {
      const y = envelopePose(i / 20, 0, 0).y;
      expect(y).toBeLessThanOrEqual(prev + 1e-9);
      if (prev !== Infinity) {
        const step = prev - y;
        expect(step).toBeLessThanOrEqual(prevStep + 1e-9);
        prevStep = step;
      }
      prev = y;
    }
    expect(envelopePose(0.01, 0, 0).y).toBeGreaterThan(DESCENT.from[1] * 0.9);
  });
  it('starts out of the top of the picture: the whole carrier is above the hover spot by more than its own height', () => {
    const top = envelopePose(0.001, 0, 0).y - ENV.h / 2 * ENV.scale;
    expect(top).toBeGreaterThan(LANTERN_TOP_Y * ENV.scale * 0.9);
  });
  it('the flap opens before the letter is out, the letter never goes back in, and both end where they should', () => {
    let lastFlap = -1;
    let lastLetter = -1;
    let outAt = Infinity;
    let flapDoneAt = Infinity;
    for (let i = 0; i <= 100; i++) {
      const o = i / 100;
      const p = envelopePose(1, o, 0);
      expect(p.flap).toBeGreaterThanOrEqual(lastFlap - 1e-9);
      expect(p.letterY).toBeGreaterThanOrEqual(lastLetter - 1e-9);
      lastFlap = p.flap;
      lastLetter = p.letterY;
      if (p.letterOut && outAt === Infinity) outAt = o;
      if (p.flap >= ENV.flapMax - 1e-6 && flapDoneAt === Infinity) flapDoneAt = o;
    }
    expect(envelopePose(1, 1, 0).flap).toBeCloseTo(ENV.flapMax, 6);
    expect(envelopePose(1, 1, 0).letterY).toBeCloseTo(ENV.letterRise, 6);
    expect(outAt).toBeGreaterThan(DESCENT.letterStart);
    // the flap is well on its way before any of the letter shows (it swings first)
    expect(envelopePose(1, outAt, 0).flap).toBeGreaterThan(ENV.flapMax * 0.5);
    expect(flapDoneAt).toBeLessThanOrEqual(DESCENT.flapEnd + 0.01);
  });
  it('the flap never lies flat: it leans back past the vertical but stops short of 180 degrees', () => {
    expect(ENV.flapMax).toBeGreaterThan(Math.PI / 2);
    expect(ENV.flapMax).toBeLessThan(Math.PI);
  });
  it('reduced motion: no travel (it fades in where it hangs), no sway, no flicker; the flap and letter still move', () => {
    for (const a of [0.1, 0.5, 0.9]) {
      const p = envelopePose(a, 0, 3.3, true);
      for (const v of [p.x, p.y, p.z, p.roll, p.yaw]) expect(Math.abs(v)).toBe(0);
    }
    expect(envelopePose(0.3, 0, 1, true).alpha).toBeLessThan(envelopePose(0.9, 0, 1, true).alpha);
    expect(envelopePose(1, 0, 1, true).glow).toBe(envelopePose(1, 0, 5, true).glow);
    expect(envelopePose(1, 1, 0, true).flap).toBeCloseTo(ENV.flapMax, 6);
  });
  it('while it hangs it sways a little (and still stays near its spot), then keeps hanging for ever', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 60; t += 0.25) {
      const p = envelopePose(1, 0, t);
      min = Math.min(min, p.x);
      max = Math.max(max, p.x);
      expect(Math.abs(p.x)).toBeLessThan(0.05);
      expect(Math.abs(p.roll)).toBeLessThan(0.08);
    }
    expect(max - min).toBeGreaterThan(0.01);
    expect(envelopePose(1, 0, 100000).visible).toBe(true);
  });
  it('bad numbers do not break it: NaN, Infinity, negatives and huge values stay finite and in range', () => {
    for (const a of [NaN, Infinity, -Infinity, -3, 7]) {
      for (const o of [NaN, Infinity, -1, 4]) {
        for (const t of [NaN, Infinity, -5, 1e9]) {
          const p = envelopePose(a, o, t);
          for (const v of [p.x, p.y, p.z, p.roll, p.yaw, p.alpha, p.glow, p.flap, p.letterY]) expect(Number.isFinite(v)).toBe(true);
          expect(p.alpha).toBeGreaterThanOrEqual(0);
          expect(p.alpha).toBeLessThanOrEqual(1);
          expect(p.flap).toBeLessThanOrEqual(ENV.flapMax + 1e-9);
          expect(p.letterY).toBeLessThanOrEqual(ENV.letterRise + 1e-9);
        }
      }
    }
  });
});

describe('the real machine drives it', () => {
  it('through the whole ritual the picture follows the machine: hidden, arriving, hanging while it waits, opening, open', () => {
    const m = new LetterMachine();
    expect(envelopePose(m.arriveProgress, m.openProgress, m.time).visible).toBe(false);
    m.start();
    let sawArriving = false;
    for (let i = 0; i < 2000 && m.phase === 'arriving'; i++) {
      m.step(1 / 60);
      const p = envelopePose(m.arriveProgress, m.openProgress, m.time);
      if (m.phase === 'arriving') {
        sawArriving = true;
        expect(p.flap).toBe(0);
      }
    }
    expect(sawArriving).toBe(true);
    expect(m.phase).toBe('waiting');
    // it waits for 100 s: nothing about the picture changes except the sway
    for (let i = 0; i < 6000; i++) m.step(1 / 60);
    expect(m.phase).toBe('waiting');
    const hang = envelopePose(m.arriveProgress, m.openProgress, m.time);
    expect(hang.flap).toBe(0);
    expect(hang.letterOut).toBe(false);
    m.open();
    for (let i = 0; i < 2000 && m.phase === 'opening'; i++) m.step(1 / 60);
    expect(m.phase).toBe('reading');
    const open = envelopePose(m.arriveProgress, m.openProgress, m.time);
    expect(open.flap).toBeCloseTo(ENV.flapMax, 6);
    expect(open.letterOut).toBe(true);
    // put away and read again: the envelope stays open (no second ritual)
    m.close();
    expect(envelopePose(m.arriveProgress, m.openProgress, m.time).flap).toBeCloseTo(ENV.flapMax, 6);
  });
  it('the arrival and the opening are the lengths the machine says (7 s and 2.4 s; 1.2 s and 0.6 s reduced)', () => {
    expect(LETTER.arriveS.lantern).toBe(7);
    expect(LETTER.openS).toBe(2.4);
    expect(LETTER.reducedArriveS).toBe(1.2);
    expect(LETTER.reducedOpenS).toBe(0.6);
  });
});

describe('envelope geometry', () => {
  const finite = (a: number[]): boolean => a.every((v) => Number.isFinite(v));
  for (const [name, build] of [['carrier', buildCarrier], ['flap', buildFlap], ['letter', buildLetter]] as const) {
    it(`${name}: valid arrays (equal lengths, indices in range, finite, unit normals, colours 0..1)`, () => {
      const m = build();
      const n = m.pos.length / 3;
      expect(n).toBeGreaterThan(0);
      expect(m.nrm.length).toBe(m.pos.length);
      expect(m.col.length).toBe(m.pos.length);
      expect(m.idx.length % 3).toBe(0);
      expect(Math.max(...m.idx)).toBeLessThan(n);
      expect(finite(m.pos) && finite(m.nrm) && finite(m.col)).toBe(true);
      for (const c of m.col) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < n; i++) expect(Math.hypot(m.nrm[i * 3]!, m.nrm[i * 3 + 1]!, m.nrm[i * 3 + 2]!)).toBeCloseTo(1, 4);
    });
  }
  it('the carrier has the lantern above the envelope: the envelope is at the origin and the lantern top is where the maths says', () => {
    const m = build();
    const ys: number[] = [];
    for (let i = 1; i < m.pos.length; i += 3) ys.push(m.pos[i]!);
    expect(Math.min(...ys)).toBeCloseTo(-ENV.h / 2, 3);
    expect(Math.max(...ys)).toBeGreaterThan(LANTERN_TOP_Y);
    function build() {
      return buildCarrier();
    }
  });
  it('the flap hangs from its hinge: every point is at or below y = 0 and within the envelope width', () => {
    const m = buildFlap();
    for (let i = 0; i < m.pos.length; i += 3) {
      expect(m.pos[i + 1]!).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(m.pos[i]!)).toBeLessThanOrEqual(ENV.w / 2 + 1e-9);
    }
    expect(Math.min(...m.pos.filter((_, i) => i % 3 === 1))).toBeCloseTo(-ENV.flapLen, 6);
  });
  it('the letter is smaller than the envelope (so it fits inside it)', () => {
    const m = buildLetter();
    const xs = m.pos.filter((_, i) => i % 3 === 0);
    const ys = m.pos.filter((_, i) => i % 3 === 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(ENV.w);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(ENV.h);
  });
  it('costs 4 draw calls and stays small', () => {
    const s = envelopeStats();
    expect(s.drawCalls).toBe(4);
    expect(s.triangles).toBeLessThan(600);
  });
  it('the picture is the same on every build (deterministic)', () => {
    expect(buildCarrier()).toEqual(buildCarrier());
  });
});

describe('camera', () => {
  it('is in front of the hover spot, further back on a tall phone, and the field is sane', () => {
    for (const a of [0.46, 0.5, 0.75, 1, 1.78, NaN, 0, -2]) {
      const c = envelopeCamera(a);
      expect(c.eye[2]).toBeGreaterThan(1);
      expect(c.fovDeg).toBeGreaterThan(30);
      expect(c.fovDeg).toBeLessThan(70);
      expect(c.eye.every(Number.isFinite) && c.look.every(Number.isFinite)).toBe(true);
    }
    expect(HOVER[1]).toBeGreaterThan(0);
  });
});

describe('what the picture must not have', () => {
  const files = ['world/envelopeMath.ts', 'world/envelope.ts', 'acts/envelopeView.ts', 'acts/envelopePick.ts'];
  it('draws no text and has no seal, heart, flower or ribbon (warm friendship, not romance)', () => {
    for (const f of files) {
      const code = src(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      expect(code, f).not.toMatch(/fillText|CanvasTexture|TextGeometry|new THREE\.Sprite/);
      expect(code, f).not.toMatch(/heart|rose|flower|bouquet|candlelit|kiss/i);
    }
  });
  it('the view only starts the act and opens it on a tap: it never opens by itself (no timer, no auto-open)', () => {
    const v = src('acts/envelopeView.ts');
    expect(v).not.toMatch(/setTimeout|setInterval/);
    // `act.open()` appears only in the test accessor and the two test knobs (`&openfor`, `&opened`); the real door is the picker (`envelopePick.ts`)
    const calls = v.split('\n').filter((l) => /act\.open\(\)/.test(l) && !/^\s*\/\//.test(l));
    expect(calls.length).toBe(3);
    expect(v).not.toMatch(/wl-envelope-tap|createElement\('button'\)/);
  });
  it('the Phase 18 picker is the one real door: a tap on the envelope or Enter on its one keyboard stop, only while it waits, and nothing draws', () => {
    const k = src('acts/envelopePick.ts');
    const code = k.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code).toMatch(/createPicker\(/);
    expect(code).toMatch(/createInput\(/);
    expect(code.split('\n').filter((l) => /act\.open\(\)/.test(l)).length).toBe(1);
    // the picker finds nothing, and the keyboard has no stop, unless the machine says it can be opened
    expect(code).toMatch(/act\.machine\.canOpen \? picker\.pick/);
    expect(code).toMatch(/ids: \(\) => \(act\.machine\.canOpen \? \[ID\] : \[\]\)/);
    expect(code).not.toMatch(/setTimeout|setInterval|new THREE\.|import \* as THREE/);
  });
  it('the picker stand-in is invisible (no draw call) and rides the envelope', () => {
    const e = src('world/envelope.ts');
    expect(e).toMatch(/new THREE\.MeshBasicMaterial\(\{ visible: false \}\)/);
    expect(e).toMatch(/rig\.add\(proxy\)/);
    expect(envelopeStats().drawCalls).toBe(4);
  });
  it('never touches the letter text or the character', () => {
    for (const f of files) {
      const code = src(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      expect(code).not.toMatch(/character\/|content\/letter\.md/);
      expect(code).not.toMatch(/\.trim\(|\.replace\(\/\\r/);
    }
  });
});
