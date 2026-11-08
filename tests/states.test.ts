import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Behaviour, LAZY, REDUCED, type Frame } from '../src/character/chamgadad/behaviour';
import { STATES, STATE_NAMES, canTransition, routePath, keyed, mk, type StateName } from '../src/character/chamgadad/states';
import { SIT, type Pose, type PartName } from '../src/character/chamgadad/pose';

const PARTS: PartName[] = ['root', 'neck', 'torso', 'armL', 'armR', 'legL', 'legR', 'tail'];
const DT = 1 / 60;

function run(b: Behaviour, seconds: number, dt = DT): Frame {
  let f = b.frame;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) f = b.update(dt);
  return f;
}
/** Largest change of any pose number between two poses. */
function poseDelta(a: Pose, c: Pose): number {
  let m = 0;
  for (const p of PARTS) for (let i = 0; i < 3; i++) m = Math.max(m, Math.abs(a[p].pos[i]! - c[p].pos[i]!), Math.abs(a[p].rot[i]! - c[p].rot[i]!));
  return m;
}
function finitePose(p: Pose): boolean {
  return PARTS.every((n) => [...p[n].pos, ...p[n].rot].every(Number.isFinite));
}
function into(state: StateName): Behaviour {
  const b = new Behaviour();
  if (state === 'rest') return b;
  if (state === 'wake') {
    b.request('sleep');
    run(b, 3);
    b.request('wake');
    run(b, 0.2);
    return b;
  }
  b.request(state);
  run(b, 0.1);
  return b;
}

describe('the transition table', () => {
  it('has a definition for every state and every target is a real state', () => {
    for (const n of STATE_NAMES) {
      expect(STATES[n].name).toBe(n);
      for (const t of STATES[n].to) expect(STATE_NAMES).toContain(t);
      expect(STATES[n].to).not.toContain(n);
    }
  });
  it('a sleeping Chamgadad can only wake; waking can only end in rest or go back to sleep', () => {
    expect([...STATES.sleep.to]).toEqual(['wake']);
    expect([...STATES.wake.to].sort()).toEqual(['rest', 'sleep']);
  });
  it('every awake posture can go to every other posture and to sleep', () => {
    for (const a of ['rest', 'breathe', 'sitLookUp', 'findFinger', 'curiousLean', 'hop', 'wave'] as const)
      for (const b of ['rest', 'breathe', 'sitLookUp', 'findFinger', 'curiousLean', 'hop', 'wave', 'sleep'] as const)
        if (a !== b) expect(canTransition(a, b)).toBe(true);
  });
  it('routes through wake when asleep, through rest when waking, and does nothing for the same state', () => {
    expect(routePath('sleep', 'hop')).toEqual(['wake', 'hop']);
    expect(routePath('sleep', 'rest')).toEqual(['wake']);
    expect(routePath('wake', 'hop')).toEqual(['rest', 'hop']);
    expect(routePath('rest', 'hop')).toEqual(['hop']);
    expect(routePath('rest', 'rest')).toEqual([]);
    expect(routePath('rest', 'wake')).toEqual([]);
  });
  it('the states table only names parts that exist, with finite numbers, at many moments', () => {
    for (const n of STATE_NAMES) {
      for (let t = 0; t <= 6; t += 0.25) {
        const s = STATES[n].sample(t, { pointer: [0.5, -0.3], side: 1 });
        expect(finitePose(s.pose)).toBe(true);
        expect(Object.keys(s.pose).sort()).toEqual([...PARTS].sort());
        for (const x of [...s.gaze, s.eyes, s.zs, s.stretch, s.breathAmp, s.breathHz]) expect(Number.isFinite(x)).toBe(true);
        expect(s.eyes).toBeGreaterThanOrEqual(0);
        expect(s.eyes).toBeLessThanOrEqual(1);
      }
    }
  });
  it('keyed() holds before the first and after the last key and passes through the keys', () => {
    const a = mk({ neck: { rot: [0, 0, 0.5] } });
    const f = keyed([{ t: 1, pose: SIT }, { t: 2, pose: a, eyes: 1 }]);
    const c = { pointer: [0, 0] as const, side: 1 as const };
    expect(f(0, c).pose).toBe(SIT);
    expect(f(1, c).eyes).toBe(0);
    expect(f(2, c).eyes).toBe(1);
    expect(f(9, c).pose.neck.rot[2]).toBeCloseTo(0.5, 9);
    expect(f(1.5, c).pose.neck.rot[2]).toBeCloseTo(0.25, 9); // the smooth ease is symmetric
  });
});

describe('rest is the drawing', () => {
  it('the first frame is exactly the sitting pose, nothing breathing, eyes open, no Zs', () => {
    const b = new Behaviour();
    const f = b.update(0);
    expect(f.state).toBe('rest');
    expect(f.pose).toBe(SIT);
    expect(f.breath).toBe(0);
    expect(f.eyes).toBe(0);
    expect(f.zs).toBe(0);
    expect(f.stretch).toBe(0);
  });
  it('stays at the sitting pose when nothing is asked, however long it runs', () => {
    const b = new Behaviour();
    const f = run(b, 60);
    expect(f.state).toBe('rest');
    expect(poseDelta(f.pose, SIT)).toBe(0);
    expect(f.events).toEqual([]);
  });
});

describe('requests', () => {
  it('a legal request starts at once, reports it with an event, and refuses nonsense', () => {
    const b = new Behaviour();
    expect(b.request('sitLookUp')).toBe('started');
    expect(b.update(DT).events).toContainEqual({ type: 'state', from: 'rest', to: 'sitLookUp' });
    expect(b.request('sitLookUp')).toBe('same');
    expect(b.request('wake')).toBe('refused'); // not asleep
    expect(b.request('nonsense' as StateName)).toBe('refused');
    expect(b.state).toBe('sitLookUp');
  });
  it('a one-shot returns to the posture it came from', () => {
    const b = into('sitLookUp');
    b.request('hop');
    expect(b.state).toBe('hop');
    run(b, STATES.hop.duration + 0.2);
    expect(b.state).toBe('sitLookUp');
    const c = into('curiousLean');
    c.request('wave');
    run(c, STATES.wave.duration + 0.2);
    expect(c.state).toBe('curiousLean');
  });
  it('a request during a one-shot waits for its free point, and the latest request wins', () => {
    const b = new Behaviour();
    b.request('hop');
    run(b, 0.5);
    expect(b.request('sleep')).toBe('queued');
    expect(b.request('wave')).toBe('queued');
    expect(b.queued).toBe('wave');
    expect(b.state).toBe('hop');
    run(b, STATES.hop.free - 0.5 + 0.05);
    expect(b.state).toBe('wave');
    expect(b.queued).toBe(null);
  });
  it('asking for a hop while asleep wakes first, then hops, then rests', () => {
    const b = into('sleep');
    expect(b.request('hop')).toBe('routed');
    expect(b.state).toBe('wake');
    run(b, STATES.wake.duration - 0.2);
    expect(b.state).toBe('wake');
    run(b, 0.5);
    expect(b.state).toBe('hop');
    run(b, STATES.hop.duration + 0.2);
    expect(b.state).toBe('rest');
  });
  it('wake ends in rest on its own', () => {
    const b = into('sleep');
    b.request('wake');
    run(b, STATES.wake.duration + 0.3);
    expect(b.state).toBe('rest');
  });
  it('can be put back to sleep while waking (after its free point) and only then', () => {
    const b = into('sleep');
    b.request('wake');
    run(b, 1);
    expect(b.request('sleep')).toBe('queued');
    run(b, STATES.wake.free);
    expect(b.state).toBe('sleep');
  });
  it('every pair of states ends somewhere legal and never breaks the pose', () => {
    for (const a of STATE_NAMES) {
      for (const c of STATE_NAMES) {
        const b = into(a);
        const r = b.request(c);
        expect(['started', 'queued', 'routed', 'same', 'refused']).toContain(r);
        const f = run(b, 12);
        expect(STATE_NAMES).toContain(f.state);
        expect(finitePose(f.pose)).toBe(true);
      }
    }
  });
});

describe('postures relax by themselves', () => {
  it('look up lasts 9 s, a lean 5 s, then rest; a custom hold is honoured', () => {
    const a = into('sitLookUp');
    run(a, 8.5);
    expect(a.state).toBe('sitLookUp');
    run(a, 1);
    expect(a.state).toBe('rest');
    const b = into('curiousLean');
    run(b, 5.2);
    expect(b.state).toBe('rest');
    const c = new Behaviour();
    c.request('sitLookUp', { hold: 2 });
    run(c, 2.2);
    expect(c.state).toBe('rest');
  });
  it('rest, breathe and sleep stay for as long as you like', () => {
    for (const n of ['rest', 'breathe', 'sleep'] as const) {
      const b = into(n);
      run(b, 120);
      expect(b.state).toBe(n);
    }
  });
  it('findFinger keeps looking while a pointer keeps arriving and lets go 3 s after it stops', () => {
    const b = new Behaviour();
    b.request('findFinger');
    for (let i = 0; i < 600; i++) {
      b.setPointer(0.5, 0);
      b.update(DT);
    }
    expect(b.state).toBe('findFinger');
    b.setPointer(null);
    run(b, 2.8);
    expect(b.state).toBe('findFinger');
    run(b, 0.5);
    expect(b.state).toBe('rest');
  });
});

describe('finger, lean, look up', () => {
  it('the head and eyes follow the pointer to either side and up', () => {
    const turn = (x: number, y: number): Frame => {
      const b = new Behaviour();
      b.request('findFinger');
      b.setPointer(x, y);
      let f = b.frame;
      for (let i = 0; i < 240; i++) {
        b.setPointer(x, y);
        f = b.update(DT);
      }
      return f;
    };
    const r = turn(1, 0), l = turn(-1, 0), u = turn(0, 1), d = turn(0, -1);
    expect(r.pose.neck.rot[1]).toBeGreaterThan(0.2);
    expect(l.pose.neck.rot[1]).toBeLessThan(-0.2);
    expect(u.pose.neck.rot[0]).toBeLessThan(-0.15); // looking up tips the head back
    expect(d.pose.neck.rot[0]).toBeGreaterThan(0.15);
    expect(r.gaze[0]).toBeGreaterThan(0.9);
    expect(l.gaze[0]).toBeLessThan(-0.9);
    expect(u.gaze[1]).toBeGreaterThan(0.9);
  });
  it('ignores a pointer that is not a number and clamps one that is far off', () => {
    const b = new Behaviour();
    b.request('findFinger');
    b.setPointer(Number.NaN, 0);
    run(b, 2);
    expect(finitePose(b.frame.pose)).toBe(true);
    b.setPointer(50, -50);
    const f = run(b, 4);
    expect(Math.abs(f.gaze[0])).toBeLessThanOrEqual(1.0000001);
    expect(Math.abs(f.pose.neck.rot[1])).toBeLessThan(0.35);
  });
  it('the head follows a little behind the eyes (the eyes lead)', () => {
    const b = new Behaviour();
    b.request('findFinger');
    run(b, 1.5); // let the blend finish with the pointer at rest
    b.setPointer(1, 0);
    const f = run(b, 0.25);
    const headShare = f.pose.neck.rot[1]! / (17 * Math.PI / 180);
    expect(headShare).toBeLessThan(0.7);
    expect(f.gaze[0]).toBeGreaterThan(headShare - 0.01);
  });
  it('a lean goes toward the side asked for', () => {
    const lean = (side: -1 | 1): Frame => {
      const b = new Behaviour();
      b.request('curiousLean', { side });
      return run(b, 3);
    };
    const r = lean(1), l = lean(-1);
    expect(r.pose.root.rot[2]).toBeLessThan(0); // leaning toward the viewer's right is a clockwise roll
    expect(l.pose.root.rot[2]).toBeGreaterThan(0);
    expect(r.gaze[0]).toBeGreaterThan(0.4);
    expect(l.gaze[0]).toBeLessThan(-0.4);
  });
  it('looking up looks up', () => {
    const f = run(into('sitLookUp'), 3);
    expect(f.pose.neck.rot[0]).toBeLessThan(-0.15);
    expect(f.gaze[1]).toBeGreaterThan(0.7);
  });
});

describe('sleep and wake', () => {
  it('asleep: eyes shut, Zs up, curled; slower and deeper breath than at rest', () => {
    const b = new Behaviour();
    b.request('sleep');
    const f = run(b, 8);
    expect(f.eyes).toBeGreaterThan(0.95);
    expect(f.zs).toBeGreaterThan(0.9);
    expect(f.pose.root.rot[2]).toBeCloseTo(-82 * Math.PI / 180, 3);
    expect(STATES.sleep.sample(0, { pointer: [0, 0], side: 1 }).breathHz).toBeLessThan(STATES.rest.sample(0, { pointer: [0, 0], side: 1 }).breathHz);
  });
  it('the eyes close before the body has finished curling up (they lead)', () => {
    const b = new Behaviour();
    b.request('sleep');
    const f = run(b, 1.2);
    expect(f.eyes).toBeGreaterThan(0.8);
    expect(f.blend).toBeLessThan(0.6);
  });
  it('waking opens the eyes, sends the Zs away, stretches the arms out and up, then settles into the sitting pose', () => {
    const b = into('sleep');
    run(b, 5);
    b.request('wake');
    const mid = run(b, 2.9);
    expect(Math.abs(mid.pose.armL.rot[2])).toBeGreaterThan(1.5); // arms stretched out and up (118 degrees)
    expect(Math.abs(mid.pose.armR.rot[2])).toBeGreaterThan(1.5);
    expect(mid.stretch).toBeGreaterThan(0.4);
    expect(mid.zs).toBeLessThan(0.3);
    const end = run(b, 5);
    expect(end.state).toBe('rest');
    expect(poseDelta(end.pose, SIT)).toBeLessThan(0.01);
    expect(end.eyes).toBeLessThan(0.01);
    expect(end.zs).toBeLessThan(0.01);
  });
  it('slow blinks, ear flicks are refused while asleep or waking', () => {
    const b = into('sleep');
    expect(b.gesture('slowBlink')).toBe(false);
    expect(b.gesture('earFlick')).toBe(false);
    b.request('wake');
    run(b, 0.5);
    expect(b.gesture('slowBlink')).toBe(false);
  });
});

describe('hop and wave', () => {
  it('a hop leaves the ground in a smooth arc and lands again', () => {
    const b = new Behaviour();
    b.request('hop');
    const ys: number[] = [];
    for (let i = 0; i < 2.7 * 60; i++) ys.push(b.update(DT).pose.root.pos[1]!);
    const peak = Math.max(...ys);
    expect(peak).toBeGreaterThan(0.45);
    expect(peak).toBeLessThan(0.75);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-9); // never below where it started
    expect(ys[ys.length - 1]).toBeLessThan(0.02);
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeLessThan(0.05);
  });
  it('crouches (squash), stretches in the air, squashes a little on landing, then is back to rest', () => {
    const b = new Behaviour();
    b.request('hop');
    let min = 0, max = 0;
    const strs: number[] = [];
    for (let i = 0; i < 2.8 * 60; i++) strs.push(b.update(DT).stretch);
    min = Math.min(...strs);
    max = Math.max(...strs);
    expect(min).toBeLessThan(-0.5);
    expect(max).toBeGreaterThan(0.5);
    expect(strs[strs.length - 1]).toBeCloseTo(0, 3);
  });
  it('flicks both ears at launch and at landing, once each', () => {
    const b = new Behaviour();
    b.request('hop');
    const flicks: number[] = [];
    for (let i = 0; i < 2.8 * 60; i++) {
      const f = b.update(DT);
      for (const e of f.events) if (e.type === 'earFlick') flicks.push(b.timeInState);
    }
    expect(flicks.length).toBe(2);
    expect(flicks[0]).toBeGreaterThan(0.65);
    expect(flicks[0]).toBeLessThan(0.8);
    expect(flicks[1]).toBeGreaterThan(1.5);
  });
  it('the wave lifts one arm, swings it three times or so, and puts it down', () => {
    const b = new Behaviour();
    b.request('wave');
    const z: number[] = [];
    for (let i = 0; i < 3.9 * 60; i++) z.push(b.update(DT).pose.armR.rot[2]!);
    const up = Math.max(...z);
    expect(up).toBeGreaterThan(1.6);
    expect(z[z.length - 1]).toBeLessThan(0.05);
    // count the swings: sign changes of the slope while the arm is up
    let turns = 0;
    for (let i = 2; i < z.length; i++) if (z[i]! > 1.5 && Math.sign(z[i]! - z[i - 1]!) !== Math.sign(z[i - 1]! - z[i - 2]!) && z[i - 1] !== z[i - 2]) turns++;
    expect(turns).toBeGreaterThanOrEqual(4);
    expect(turns).toBeLessThanOrEqual(8);
  });
  it('the left arm and everything else stay still during the wave', () => {
    const b = new Behaviour();
    b.request('wave');
    const f = run(b, 1.8);
    expect(poseDelta(mkOnly(f.pose, 'armL'), mkOnly(SIT, 'armL'))).toBe(0);
    expect(poseDelta(mkOnly(f.pose, 'legL'), mkOnly(SIT, 'legL'))).toBe(0);
  });
});
function mkOnly(p: Pose, part: PartName): Pose {
  const o = {} as Pose;
  for (const n of PARTS) o[n] = n === part ? p[n] : SIT[n];
  return o;
}

describe('gestures (face layer)', () => {
  it('a slow blink closes the eyes slowly, holds, opens slowly, and does not touch the posture', () => {
    const b = new Behaviour();
    b.request('sitLookUp');
    run(b, 2);
    const before = b.frame.pose;
    expect(b.gesture('slowBlink')).toBe(true);
    expect(b.gesture('slowBlink')).toBe(false); // running
    const e: number[] = [];
    for (let i = 0; i < 2 * 60; i++) e.push(b.update(DT).eyes);
    expect(Math.max(...e)).toBeGreaterThan(0.99);
    expect(e[e.length - 1]).toBe(0);
    expect(b.frame.gesture).toBe(null);
    // slower than the quick automatic blink (face blink.ts closes in 0.07 s): at 0.07 s the slow one is barely shut
    expect(e[Math.round(0.07 * 60)]!).toBeLessThan(0.1);
    expect(poseDelta(b.frame.pose, before)).toBeLessThan(0.03); // only the head drift of the look-up hold
    const total = LAZY.slowBlink.close + LAZY.slowBlink.hold + LAZY.slowBlink.open;
    expect(total).toBeGreaterThan(1.4);
  });
  it('an ear flick is one event, refused again straight away', () => {
    const b = new Behaviour();
    expect(b.gesture('earFlick')).toBe(true);
    expect(b.gesture('earFlick')).toBe(false);
    const f = b.update(DT);
    expect(f.events.filter((x) => x.type === 'earFlick').length).toBe(1);
    run(b, 0.6);
    expect(b.gesture('earFlick')).toBe(true);
  });
});

describe('no pops, no explosions', () => {
  it('a storm of random requests for ten minutes keeps every channel finite, bounded and smooth', () => {
    let seed = 12345;
    const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const b = new Behaviour();
    let prev = b.update(0);
    let worstRot = 0, worstEyes = 0, worstStretch = 0, worstBreath = 0;
    for (let i = 0; i < 60 * 600; i++) {
      if (rnd() < 0.01) b.request(STATE_NAMES[Math.floor(rnd() * STATE_NAMES.length)]!, { side: rnd() < 0.5 ? -1 : 1 });
      if (rnd() < 0.004) b.gesture(rnd() < 0.5 ? 'slowBlink' : 'earFlick');
      if (rnd() < 0.05) b.setPointer(rnd() * 2 - 1, rnd() * 2 - 1);
      if (rnd() < 0.003) b.setPointer(null);
      const f = b.update(DT);
      expect(finitePose(f.pose)).toBe(true);
      expect(Number.isFinite(f.breath) && Number.isFinite(f.stretch) && Number.isFinite(f.zs) && Number.isFinite(f.eyes)).toBe(true);
      expect(f.eyes).toBeGreaterThanOrEqual(0);
      expect(f.eyes).toBeLessThanOrEqual(1.0000001);
      expect(f.zs).toBeGreaterThanOrEqual(0);
      expect(f.zs).toBeLessThanOrEqual(1.0000001);
      expect(Math.abs(f.breath)).toBeLessThanOrEqual(2.3);
      worstRot = Math.max(worstRot, poseDelta(f.pose, prev.pose));
      worstEyes = Math.max(worstEyes, Math.abs(f.eyes - prev.eyes));
      worstStretch = Math.max(worstStretch, Math.abs(f.stretch - prev.stretch));
      worstBreath = Math.max(worstBreath, Math.abs(f.breath - prev.breath));
      prev = f;
    }
    // per frame at 60 fps: the fastest honest move is the wake stretch (118 degrees in under a second) and the hop launch
    expect(worstRot).toBeLessThan(0.09);
    expect(worstEyes).toBeLessThan(0.08);
    // the stretch channel is scaled by 0.07 into body height: the hop's spring is its fastest move, about 1.5 percent of height per frame
    expect(worstStretch * 0.07).toBeLessThan(0.02);
    expect(worstBreath).toBeLessThan(0.1);
  });
  it('switching state at any moment starts exactly where Chamgadad is (no jump)', () => {
    for (const from of ['hop', 'wave', 'curiousLean', 'findFinger', 'sitLookUp'] as const) {
      for (const at of [0.05, 0.3, 0.7, 1.2, 1.9]) {
        const b = new Behaviour();
        b.setPointer(0.8, 0.4);
        b.request(from);
        const before = run(b, at);
        b.request('sleep'); // may be queued behind a one-shot; if it started, the first frame must equal the last
        const after = b.update(DT);
        expect(poseDelta(before.pose, after.pose)).toBeLessThan(0.05);
        expect(Math.abs(before.stretch - after.stretch)).toBeLessThan(0.1);
      }
    }
  });
  it('odd frame times never break it: NaN, negative, zero, infinite and a one-day frame', () => {
    const b = new Behaviour();
    b.request('hop');
    const t0 = b.timeInState;
    for (const dt of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      const f = b.update(dt);
      expect(finitePose(f.pose)).toBe(true);
    }
    expect(b.timeInState).toBe(t0 + 0); // Infinity counts as the clamp? no: not finite, so ignored
    b.update(86400);
    expect(b.timeInState).toBeLessThanOrEqual(t0 + LAZY.maxDt + 1e-9);
  });
  it('is deterministic: the same requests at the same times give the same frames', () => {
    const play = (): number[] => {
      const b = new Behaviour();
      const out: number[] = [];
      for (let i = 0; i < 60 * 30; i++) {
        if (i === 30) b.request('hop');
        if (i === 300) b.request('sleep');
        if (i === 900) b.request('wake');
        if (i === 1500) b.gesture('slowBlink');
        const f = b.update(DT);
        out.push(f.pose.neck.rot[0]! + f.pose.root.pos[1]! + f.eyes + f.breath + f.zs);
      }
      return out;
    };
    expect(play()).toEqual(play());
  });
  it('frame rate does not change where a state ends up (30 fps and 60 fps agree to within a hair)', () => {
    const at = (dt: number): Frame => {
      const b = new Behaviour();
      b.request('curiousLean', { side: 1 });
      return run(b, 3, dt);
    };
    expect(poseDelta(at(1 / 30).pose, at(1 / 60).pose)).toBeLessThan(0.01);
  });
});

describe('breathing', () => {
  it('rises and falls on both sides of zero, never bigger than its size', () => {
    const b = new Behaviour();
    const vals: number[] = [];
    for (let i = 0; i < 60 * 30; i++) vals.push(b.update(DT).breath);
    expect(Math.max(...vals)).toBeGreaterThan(0.9);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1.0000001);
    expect(Math.min(...vals)).toBeLessThan(-0.9);
  });
  it('about one breath every 4.5 seconds at rest', () => {
    const b = new Behaviour();
    let crossings = 0, prev = 0;
    for (let i = 0; i < 60 * 45; i++) {
      const v = b.update(DT).breath;
      if (prev <= 0 && v > 0) crossings++;
      prev = v;
    }
    expect(crossings).toBeGreaterThanOrEqual(9);
    expect(crossings).toBeLessThanOrEqual(11);
  });
});

describe('reduced motion', () => {
  it('asking for a hop gives a gentle lean instead, with no ear flick events and no leaving the ground', () => {
    const b = new Behaviour({ reducedMotion: true });
    b.request('hop');
    expect(b.state).toBe('curiousLean');
    let maxY = 0, flicks = 0;
    for (let i = 0; i < 4 * 60; i++) {
      const f = b.update(DT);
      maxY = Math.max(maxY, f.pose.root.pos[1]!);
      flicks += f.events.filter((e) => e.type === 'earFlick').length;
    }
    expect(maxY).toBe(0);
    expect(flicks).toBe(0);
  });
  it('movements shrink to a third of the way from the rest pose', () => {
    const full = run(into('sitLookUp'), 3);
    const b = new Behaviour({ reducedMotion: true });
    b.request('sitLookUp');
    const red = run(b, 4);
    const ratio = Math.abs(red.pose.neck.rot[0]!) / Math.abs(full.pose.neck.rot[0]!);
    expect(ratio).toBeGreaterThan(REDUCED.amount - 0.05);
    expect(ratio).toBeLessThan(REDUCED.amount + 0.1);
  });
  it('waking is a slow plain blend to the sitting pose: no stretch, no unroll', () => {
    const b = new Behaviour({ reducedMotion: true });
    b.request('sleep');
    run(b, 6);
    expect(b.request('wake')).toBe('started');
    expect(b.state).toBe('rest');
    let maxArm = 0, maxStretch = 0;
    for (let i = 0; i < 6 * 60; i++) {
      const f = b.update(DT);
      maxArm = Math.max(maxArm, Math.abs(f.pose.armL.rot[2]!), Math.abs(f.pose.armR.rot[2]!));
      maxStretch = Math.max(maxStretch, Math.abs(f.stretch));
    }
    expect(maxArm).toBeLessThan(0.2);
    expect(maxStretch).toBeLessThan(0.05);
    expect(poseDelta(b.frame.pose, SIT)).toBeLessThan(0.01);
  });
  it('blends are slower than normal and the switch can be made live', () => {
    const t = (reduced: boolean): number => {
      const b = new Behaviour();
      b.setReducedMotion(reduced);
      b.request('sitLookUp');
      let i = 0;
      while (b.update(DT).blend < 1 && i < 6000) i++;
      return i / 60;
    };
    expect(t(true)).toBeGreaterThan(t(false) * 1.4);
  });
});

describe('the pure files stay pure', () => {
  it('states.ts and behaviour.ts import no three', () => {
    for (const f of ['states.ts', 'behaviour.ts']) {
      const text = readFileSync(`src/character/chamgadad/${f}`, 'utf8');
      expect(/from\s*['"]three/.test(text)).toBe(false);
    }
  });
  it('nothing in the behaviour set adds a feature she did not draw', () => {
    for (const f of ['states.ts', 'behaviour.ts', 'rig.ts']) {
      const text = readFileSync(`src/character/chamgadad/${f}`, 'utf8').toLowerCase();
      for (const word of ['whisker', 'blush', 'nose', 'tuft', 'mouth', 'lash', 'heart']) expect(text.includes(word)).toBe(false);
    }
  });
});
