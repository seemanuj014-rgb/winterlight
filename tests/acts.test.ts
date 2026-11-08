import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACT1, ACT2, Act1Machine, Act2Machine, DOOR_SPOT, HINT_TEXT, SLEEP_SECRET_ID, WALK_POINTS, follow, hopTravel, lerpAngle, parseNookLine, parseScript, planWalk, scriptAt,
  type Act1In, type Act1Out, type Act2Out,
} from '../src/acts/actsMath';
import { Behaviour } from '../src/character/chamgadad/behaviour';
import { HOP_AIR_END, HOP_AIR_START, STATES } from '../src/character/chamgadad/states';
import { SHOTS, SHOT_NAMES } from '../src/world/shots';
import { NOOK } from '../src/world/cabinMath';
import { REDUCED_SLOWDOWN } from '../src/core/directorMath';

const DT = 1 / 60;
const NONE: Act1In = { pressed: false, holding: false, taps: 0 };
const HOLD: Act1In = { pressed: true, holding: true, taps: 0 };

/** run the act-1 machine for `sec` seconds with an input chosen by time; returns every output */
function run1(m: Act1Machine, sec: number, input: (t: number) => Act1In, t0 = 0): Act1Out[] {
  const outs: Act1Out[] = [];
  for (let i = 0; i < Math.round(sec / DT); i++) outs.push(m.update(DT, input(t0 + i * DT)));
  return outs;
}
const first = <T>(a: T[], f: (x: T) => boolean): number => a.findIndex(f);

describe('the owner\'s words', () => {
  it('content/nook.json holds the line exactly as the owner wrote it', () => {
    const raw = readFileSync('content/nook.json', 'utf8');
    expect(parseNookLine(raw)).toBe('awhhhhh 😭😭😭😭, do you wanna wake this cutie up dhana???');
  });
  it('a missing, placeholder, non-string, empty or huge line is null (the secret still happens, without words)', () => {
    expect(parseNookLine('{}')).toBeNull();
    expect(parseNookLine('{"sleep_line":"TODO_OWNER"}')).toBeNull();
    expect(parseNookLine('{"sleep_line":42}')).toBeNull();
    expect(parseNookLine('{"sleep_line":"   "}')).toBeNull();
    expect(parseNookLine('{"sleep_line":"' + 'x'.repeat(300) + '"}')).toBeNull();
    expect(parseNookLine('not json')).toBeNull();
    expect(parseNookLine('[1]')).toBeNull();
    expect(parseNookLine('{"sleep_line":"hi  there"}')).toBe('hi  there'); // not touched
  });
  it('the hint is the storyboard\'s phrase', () => {
    expect(HINT_TEXT).toBe('hold to wake Chamgadad');
  });
  it('nothing in src/acts writes words of its own besides the hint', () => {
    const text = readdirSync('src/acts').map((f) => readFileSync(join('src/acts', f), 'utf8')).join('\n');
    expect(text).not.toMatch(/happy birthday|dear dhana|i love|my love|sweetheart|darling|❤|♥|💕/i);
  });
});

describe('the scripted viewer (test only)', () => {
  it('parses holds, taps and a pointer; ignores nonsense', () => {
    const s = parseScript(new URLSearchParams('hold=3-7,20-21,x-y,9-8&tap=5,6,a&pointer=0.4,2'));
    expect(s.holds).toEqual([[3, 7], [20, 21]]);
    expect(s.taps).toEqual([5, 6]);
    expect(s.pointer).toEqual([0.4, 1]);
    expect(parseScript(new URLSearchParams('')).pointer).toBeNull();
    expect(parseScript(new URLSearchParams('pointer=1')).pointer).toBeNull();
  });
  it('a scripted hold becomes a hold half a second after it begins, like the real classifier', () => {
    const s = parseScript(new URLSearchParams('hold=3-7'));
    expect(scriptAt(s, 2.9 - DT, 2.9)).toEqual({ pressed: false, holding: false, taps: 0 });
    expect(scriptAt(s, 3.2 - DT, 3.2).pressed).toBe(true);
    expect(scriptAt(s, 3.2 - DT, 3.2).holding).toBe(false);
    expect(scriptAt(s, 3.6 - DT, 3.6).holding).toBe(true);
    expect(scriptAt(s, 7.5 - DT, 7.5).pressed).toBe(false);
  });
  it('each scripted tap lands in exactly one step', () => {
    const s = parseScript(new URLSearchParams('tap=1,1.5'));
    let n = 0;
    let prev = 0;
    let t = 0;
    for (let i = 1; i <= 240; i++) {
      prev = t;
      t += DT; // accumulated, as the act does it
      n += scriptAt(s, prev, t).taps;
    }
    expect(n).toBe(2);
  });
});

describe('small helpers', () => {
  it('follow is frame-rate independent and never overshoots', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = follow(a, 1, 0.5, DT);
    let b = 0;
    for (let i = 0; i < 30; i++) b = follow(b, 1, 0.5, 2 * DT);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeLessThan(1);
    expect(follow(0.3, 1, 0.5, 0)).toBe(0.3);
    expect(follow(0.3, 1, 0.5, NaN)).toBe(0.3);
  });
  it('lerpAngle takes the short way round', () => {
    expect(lerpAngle(3.0, -3.0, 1)).toBeCloseTo(-3.0 + 2 * Math.PI, 6);
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });
  it('hopTravel: still while she crouches, a smooth slide in the air, still after, and in step with the behaviour\'s own air time', () => {
    expect(hopTravel(0)).toBe(0);
    expect(hopTravel(HOP_AIR_START)).toBe(0);
    expect(hopTravel((HOP_AIR_START + HOP_AIR_END) / 2)).toBeCloseTo(0.5, 6);
    expect(hopTravel(HOP_AIR_END)).toBe(1);
    expect(hopTravel(99)).toBe(1);
    expect(hopTravel(NaN)).toBe(0);
    let prev = 0;
    for (let t = 0; t < 3; t += 0.01) {
      const v = hopTravel(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('Act 1: waiting', () => {
  it('the first step asks for the wide shot, once', () => {
    const m = new Act1Machine();
    const outs = run1(m, 5, () => NONE);
    expect(outs.filter((o) => o.shot === 'nookWide')).toHaveLength(1);
    expect(outs[0]!.shot).toBe('nookWide');
  });
  it('nothing is shown for the first 3 s; then the hint fades in, and the line does not appear', () => {
    const m = new Act1Machine();
    const outs = run1(m, 10, () => NONE);
    expect(outs[Math.round(2.8 / DT)]!.hint).toBe(0);
    expect(outs[Math.round(9 / DT)]!.hint).toBeGreaterThan(0.9);
    expect(outs.every((o) => o.line === 0)).toBe(true);
    expect(outs.every((o) => o.phase === 'asleep' && o.chamgadad === null)).toBe(true);
  });
  it('she never wakes by herself, however long nobody touches (nothing is timed against her)', () => {
    const m = new Act1Machine();
    const outs = run1(m, 300, () => NONE);
    expect(outs.every((o) => o.phase === 'asleep')).toBe(true);
    expect(m.progress).toBe(0);
  });
  it('the lamp rests at 0.55', () => {
    const m = new Act1Machine();
    expect(run1(m, 1, () => NONE).at(-1)!.lamp).toBeCloseTo(ACT1.lampRest, 3);
  });
});

describe('Act 1: "let her sleep"', () => {
  it('after 20 s of nobody touching the sleep deepens: a slow shot, a dimmer lamp, the owner\'s line, one secret', () => {
    const m = new Act1Machine(true);
    const outs = run1(m, 40, () => NONE);
    const iDeep = first(outs, (o) => o.shot === 'nookSleep');
    expect(iDeep).toBeGreaterThanOrEqual(Math.round(ACT1.sleepAfter / DT) - 2);
    expect(iDeep).toBeLessThanOrEqual(Math.round((ACT1.sleepAfter + 0.5) / DT));
    expect(outs.filter((o) => o.shot === 'nookSleep')).toHaveLength(1);
    const last = outs.at(-1)!;
    expect(last.deep).toBe(1);
    expect(last.lamp).toBeCloseTo(ACT1.lampRest - ACT1.lampDeepDrop, 2);
    expect(last.line).toBeGreaterThan(0.95);
    expect(outs.filter((o) => o.secret !== null)).toHaveLength(1);
    expect(outs.find((o) => o.secret !== null)!.secret).toBe(SLEEP_SECRET_ID);
    // the line only shows once the sleep is deep
    expect(outs[Math.round(ACT1.sleepAfter / DT) - 5]!.line).toBe(0);
  });
  it('the line fades in gently, never in one step', () => {
    const outs = run1(new Act1Machine(), 45, () => NONE);
    let prev = 0;
    for (const o of outs) {
      expect(Math.abs(o.line - prev)).toBeLessThan(0.03);
      prev = o.line;
    }
  });
  it('a touch ends the deepening, the line fades away, and she is still asleep and still wakeable', () => {
    const m = new Act1Machine();
    const outs = run1(m, 40, (t) => (t >= 32 && t < 33 ? { pressed: true, holding: false, taps: 0 } : NONE));
    const after = outs.at(-1)!;
    expect(after.phase).toBe('asleep');
    expect(after.line).toBeLessThan(0.3); // the line has been going since the touch
    expect(m.log.some((e) => e.what === 'stirred')).toBe(true);
    const later = run1(m, 10, () => HOLD, 40);
    expect(later.some((o) => o.phase === 'waking')).toBe(true);
  });
  it('a second wait deepens again but the secret is only found once', () => {
    const m = new Act1Machine();
    const a = run1(m, 40, () => NONE);
    const b = run1(m, 1, () => ({ pressed: true, holding: false, taps: 0 }), 40);
    const c = run1(m, 60, () => NONE, 41);
    const all = [...a, ...b, ...c];
    expect(all.filter((o) => o.secret !== null)).toHaveLength(1);
    expect(all.filter((o) => o.shot === 'nookSleep')).toHaveLength(2);
  });
  it('without a line the secret still happens, quietly (the lamp and the camera), and no words show', () => {
    const outs = run1(new Act1Machine(false), 45, () => NONE);
    expect(outs.some((o) => o.secret !== null)).toBe(true);
    expect(outs.every((o) => o.line === 0)).toBe(true);
    expect(outs.at(-1)!.deep).toBe(1);
  });
  it('holding at any point before 20 s means the deepening never starts', () => {
    const outs = run1(new Act1Machine(), 19, (t) => (t > 10 && t < 11 ? { pressed: true, holding: false, taps: 0 } : NONE));
    expect(outs.every((o) => o.shot !== 'nookSleep')).toBe(true);
  });
});

describe('Act 1: the hold, the taps, the wake', () => {
  it('a full hold wakes her in about holdSeconds, once: nookBed, wake, a buzz, a log line', () => {
    const m = new Act1Machine();
    const outs = run1(m, 8, () => HOLD);
    const i = first(outs, (o) => o.phase === 'waking');
    expect(i * DT).toBeGreaterThan(ACT1.holdSeconds - 0.1);
    expect(i * DT).toBeLessThan(ACT1.holdSeconds + 0.1);
    expect(outs[i]!.shot).toBe('nookBed');
    expect(outs[i]!.chamgadad).toBe('wake');
    expect(outs[i]!.haptic).toBe('wake');
    expect(outs.filter((o) => o.chamgadad === 'wake')).toHaveLength(1);
    expect(m.log.map((e) => e.what)).toEqual(expect.arrayContaining(['start', 'press', 'wake']));
  });
  it('the light rises with the hold, smoothly, and a half-held press (before a hold) rises slower', () => {
    const outs = run1(new Act1Machine(), 2.5, () => HOLD);
    for (let i = 1; i < outs.length; i++) expect(outs[i]!.lamp).toBeGreaterThanOrEqual(outs[i - 1]!.lamp - 1e-9);
    expect(outs.at(-1)!.lamp).toBeGreaterThan(0.85);
    const slow = run1(new Act1Machine(), 2.5, () => ({ pressed: true, holding: false, taps: 0 }));
    expect(slow.at(-1)!.progress).toBeLessThan(outs.at(-1)!.progress / 2);
    for (let i = 1; i < outs.length; i++) expect(Math.abs(outs[i]!.lamp - outs[i - 1]!.lamp)).toBeLessThan(0.02);
  });
  it('letting go early: the light waits, then sinks back slowly; she does not wake', () => {
    const m = new Act1Machine();
    const outs = run1(m, 12, (t) => (t < 1.5 ? HOLD : NONE));
    const atRelease = outs[Math.round(1.5 / DT)]!;
    expect(atRelease.progress).toBeGreaterThan(0.3);
    expect(outs[Math.round(2.0 / DT)]!.progress).toBeCloseTo(atRelease.progress, 2); // the wait
    expect(outs.at(-1)!.progress).toBeLessThan(atRelease.progress);
    expect(outs.every((o) => o.phase === 'asleep')).toBe(true);
  });
  it('the tap path: a handful of taps (one per second) wake her too', () => {
    const m = new Act1Machine();
    const outs = run1(m, 14, (t) => ({ pressed: false, holding: false, taps: Math.abs(t - Math.round(t)) < DT / 2 && t >= 1 && t <= 9 ? 1 : 0 }));
    const i = first(outs, (o) => o.phase === 'waking');
    expect(i).toBeGreaterThan(0);
    expect(outs.filter((o) => o.chamgadad === 'wake')).toHaveLength(1);
    expect(outs.some((o) => o.haptic === 'tap')).toBe(true);
  });
  it('taps all at once also wake her (and never more than once)', () => {
    const m = new Act1Machine();
    const outs = run1(m, 3, (t) => ({ pressed: false, holding: false, taps: t < DT ? 10 : 0 }));
    expect(outs.filter((o) => o.chamgadad === 'wake')).toHaveLength(1);
  });
  it('after the wake: findFinger, then wave, then done, at the stated times; the hint and line are gone; the lamp stays high', () => {
    const m = new Act1Machine();
    const outs = run1(m, 30, (t) => (t < 4 ? HOLD : NONE));
    const iWake = first(outs, (o) => o.phase === 'waking');
    const iFind = first(outs, (o) => o.chamgadad === 'findFinger');
    const iWave = first(outs, (o) => o.chamgadad === 'wave');
    const iDone = first(outs, (o) => o.done);
    expect((iFind - iWake) * DT).toBeCloseTo(ACT1.wakeSeconds, 1);
    expect((iWave - iFind) * DT).toBeCloseTo(ACT1.noticeSeconds, 1);
    expect((iDone - iWave) * DT).toBeCloseTo(STATES.wave.duration, 1);
    expect(outs.filter((o) => o.done)).toHaveLength(1);
    expect(outs[iDone + 60]!.hint).toBe(0);
    expect(outs[iDone]!.lamp).toBeGreaterThan(0.97);
    expect(outs[iWake]!.holdable).toBe(false);
    expect(outs[iWake + 5]!.tracking).toBe(false);
    expect(outs[iFind + 5]!.tracking).toBe(true);
    expect(m.log.map((e) => e.what)).toEqual(['start', 'press', 'wake', 'noticing', 'beckoning', 'done'].filter((w) => m.log.some((e) => e.what === w)));
  });
  it('input after the wake changes nothing', () => {
    const a = run1(new Act1Machine(), 30, (t) => (t < 4 ? HOLD : NONE));
    const b = run1(new Act1Machine(), 30, (t) => (t < 4 ? HOLD : { pressed: true, holding: true, taps: 3 }));
    expect(b.map((o) => o.phase)).toEqual(a.map((o) => o.phase));
  });
  it('the real Behaviour accepts every state the act asks for, in order (nothing refused)', () => {
    const m = new Act1Machine();
    const beh = new Behaviour();
    beh.request('sleep');
    for (let i = 0; i < 300; i++) beh.update(DT);
    const results: string[] = [];
    for (let i = 0; i < 30 / DT; i++) {
      const o = m.update(DT, i * DT < 4 ? HOLD : NONE);
      if (o.chamgadad) results.push(`${o.chamgadad}:${beh.request(o.chamgadad)}`);
      beh.update(DT);
    }
    expect(results.every((r) => !r.endsWith(':refused') && !r.endsWith(':same'))).toBe(true);
    expect(results.map((r) => r.split(':')[0])).toEqual(['wake', 'findFinger', 'wave']);
    expect(beh.state).not.toBe('sleep');
  });
});

describe('Act 1: robustness', () => {
  it('bad dt and wild inputs never give NaN, a progress outside 0..1, or a second wake', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let run = 0; run < 12; run++) {
      const m = new Act1Machine(run % 2 === 0);
      let wakes = 0;
      let dones = 0;
      for (let i = 0; i < 3000; i++) {
        const dt = rnd() < 0.02 ? [NaN, -1, 0, 5, Infinity][Math.floor(rnd() * 5)]! : DT * (0.5 + rnd());
        const pressed = rnd() < 0.3;
        const o = m.update(dt, { pressed, holding: pressed && rnd() < 0.7, taps: rnd() < 0.02 ? [NaN, -3, 99, 1.7][Math.floor(rnd() * 4)]! : 0 });
        for (const v of [o.progress, o.lamp, o.hint, o.line, o.deep]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        if (o.chamgadad === 'wake') wakes++;
        if (o.done) dones++;
      }
      expect(wakes).toBeLessThanOrEqual(1);
      expect(dones).toBeLessThanOrEqual(1);
      expect(m.log.length).toBeLessThanOrEqual(400);
    }
  });
  it('a huge dt counts as 0.1 s (a stalled tab does not skip the wake)', () => {
    const m = new Act1Machine();
    const o = m.update(60, HOLD);
    expect(o.progress).toBeLessThan(0.05);
  });
});

/** run Act 2 to the end; `shotAt` says what the camera is playing, as the world would report it */
function run2(m: Act2Machine, maxSec = 80): { outs: Act2Out[]; shots: string[] } {
  const outs: Act2Out[] = [];
  const shots: string[] = [];
  let shot: string | null = 'nookBed';
  let shotT = 0;
  const queue: string[] = [];
  for (let i = 0; i < maxSec / DT; i++) {
    const o = m.update(DT, { shot, shotElapsed: shotT });
    outs.push(o);
    if (o.shot) {
      shot = o.shot;
      shotT = 0;
      shots.push(o.shot);
      queue.splice(0, queue.length, ...o.then);
    }
    shotT += DT;
    // the world plays the queued shots one after the other: the first lasts its own length, then the next
    if (shot === 'doorOut' && shotT >= SHOTS.doorOut.seconds && queue.length) {
      shot = queue.shift()!;
      shotT = 0;
    } else if (shot === 'snowWalk' && shotT >= SHOTS.snowWalk.seconds && queue.length) {
      shot = queue.shift()!;
      shotT = 0;
    }
    if (o.done) break;
  }
  return { outs, shots };
}

describe('Act 2: the walk', () => {
  const hops = planWalk();
  it('the path is cut into equal hops no longer than maxHop, from the bed to the door', () => {
    expect(hops.length).toBeGreaterThanOrEqual(3);
    for (const h of hops) {
      const d = Math.hypot(h.to[0] - h.from[0], h.to[2] - h.from[2]);
      expect(d).toBeLessThanOrEqual(ACT2.maxHop + 1e-6);
      expect(d).toBeGreaterThan(0.3);
    }
    for (let i = 1; i < hops.length; i++) expect(hops[i]!.from).toEqual(hops[i - 1]!.to);
    expect(hops[0]!.from).toEqual(WALK_POINTS[0]);
    for (let k = 0; k < 3; k++) expect(hops.at(-1)!.to[k]).toBeCloseTo(DOOR_SPOT[k]!, 6);
  });
  it('she steps down off the bed (the first hop) and stays on the floor', () => {
    expect(hops[0]!.from[1]).toBeCloseTo(NOOK.bed.top + 0.1, 6);
    expect(hops[0]!.to[1]).toBeLessThan(0.05);
    for (const h of hops.slice(1)) expect(h.from[1]).toBeCloseTo(0, 6);
  });
  it('every stop is inside the room, clear of the bed\'s far side and the table', () => {
    for (const h of hops) {
      for (const p of [h.from, h.to]) {
        expect(Math.abs(p[0])).toBeLessThan(NOOK.hx - 0.3);
        expect(Math.abs(p[2])).toBeLessThan(NOOK.hz - 0.3);
        const nearTable = Math.hypot(p[0] - NOOK.table.x, p[2] - NOOK.table.z) < 0.6;
        expect(nearTable).toBe(false);
      }
    }
  });
  it('the stop in front of the door is on the room side of it and in line with its panel', () => {
    expect(DOOR_SPOT[0]).toBeLessThan(NOOK.hx - 0.5);
    expect(DOOR_SPOT[2]).toBeGreaterThan(NOOK.doorZ);
    expect(DOOR_SPOT[2]).toBeLessThan(NOOK.doorZ + 1.0);
  });
  it('degenerate paths give no hops', () => {
    expect(planWalk([])).toEqual([]);
    expect(planWalk([[0, 0, 0]])).toEqual([]);
    expect(planWalk([[0, 0, 0], [0, 0, 0]])).toEqual([]);
  });
  it('asks for the hops one period apart, the wide follow shot first, and the cat wakes once', () => {
    const m = new Act2Machine();
    const { outs } = run2(m);
    expect(outs[0]!.shot).toBe('nookWalk');
    expect(outs[0]!.enter).toBe(true);
    expect(outs.filter((o) => o.enter)).toHaveLength(1);
    const idx = outs.map((o, i) => (o.chamgadad === 'hop' ? i : -1)).filter((i) => i >= 0);
    expect(idx).toHaveLength(hops.length);
    for (let i = 1; i < idx.length; i++) expect((idx[i]! - idx[i - 1]!) * DT).toBeCloseTo(ACT2.hopPeriod, 1);
    expect(outs.filter((o) => o.cat === 'wake')).toHaveLength(1);
  });
  it('her path is continuous: no step moves her more than a few centimetres', () => {
    const { outs } = run2(new Act2Machine());
    let prev: Act2Out['spot'] = null;
    for (const o of outs) {
      if (o.spot && prev) {
        expect(Math.hypot(o.spot.x - prev.x, o.spot.z - prev.z, o.spot.y - prev.y)).toBeLessThan(0.04);
        expect(Math.abs(o.spot.yaw - prev.yaw)).toBeLessThan(0.2);
      }
      prev = o.spot ?? prev;
    }
  });
  it('she is travelling only in the air: still at the start of a hop, still at the end', () => {
    const m = new Act2Machine();
    const pos: { t: number; x: number; z: number }[] = [];
    for (let i = 0; i < 4 * 60; i++) {
      const o = m.update(DT, { shot: 'nookWalk', shotElapsed: 0 });
      pos.push({ t: i * DT, x: o.spot!.x, z: o.spot!.z });
    }
    const at = (t: number): { x: number; z: number } => pos[Math.round(t / DT)]!;
    expect(at(0.6).x).toBeCloseTo(at(0).x, 6);
    expect(at(HOP_AIR_END + 0.1).x).toBeCloseTo(at(2.5).x, 6);
    expect(Math.hypot(at(2.5).x - at(0).x, at(2.5).z - at(0).z)).toBeGreaterThan(0.9);
  });
  it('the real Behaviour takes every hop and the lean (nothing refused), and ends resting', () => {
    const m = new Act2Machine();
    const beh = new Behaviour();
    const res: string[] = [];
    for (let i = 0; i < 60 / DT; i++) {
      const o = m.update(DT, { shot: 'nookWalk', shotElapsed: 0 });
      if (o.chamgadad) res.push(`${o.chamgadad}:${beh.request(o.chamgadad, o.lean ? { side: o.lean } : {})}`);
      beh.update(DT);
    }
    expect(res.filter((r) => r.startsWith('hop:'))).toHaveLength(hops.length);
    expect(res.every((r) => !r.endsWith(':refused'))).toBe(true);
    expect(res.filter((r) => r.startsWith('hop:')).every((r) => r === 'hop:started')).toBe(true);
  });
  it('at the door she faces it, leans in, and the door opens smoothly from 0 to 1 and stays open', () => {
    const { outs } = run2(new Act2Machine());
    const iDoor = first(outs, (o) => o.phase === 'opening');
    expect(outs[iDoor]!.shot).toBe('nookAtDoor');
    expect(outs.filter((o) => o.chamgadad === 'curiousLean')).toHaveLength(1);
    const doors = outs.map((o) => o.nookDoor);
    expect(doors[0]).toBe(0);
    expect(doors.at(-1)).toBe(1);
    for (let i = 1; i < doors.length; i++) {
      expect(doors[i]!).toBeGreaterThanOrEqual(doors[i - 1]! - 1e-9);
      expect(doors[i]! - doors[i - 1]!).toBeLessThan(0.02);
    }
    const lastSpot = [...outs].reverse().find((o) => o.spot)!.spot!;
    expect(Math.sin(lastSpot.yaw)).toBeGreaterThan(0.98); // facing +x
    expect(doors[iDoor + Math.round((ACT2.doorPauseBefore - 0.1) / DT)]).toBe(0); // the pause before
  });
  it('the push-out: a cut to the doorway, snowWalk and stage queued behind it, a soft buzz, once', () => {
    const { outs, shots } = run2(new Act2Machine());
    const o = outs.find((x) => x.phase === 'pushOut' && x.shot)!;
    expect(o.shot).toBe('doorOut');
    expect(o.cut).toBe(true);
    expect(o.then).toEqual(['snowWalk', 'stage']);
    expect(o.chamgadad).toBe('rest');
    expect(o.haptic).toBe('soft');
    expect(shots).toEqual(['nookWalk', 'nookAtDoor', 'doorOut']);
    expect(outs.filter((x) => x.cut)).toHaveLength(1);
    // no seat in the nook after the cut
    const iCut = outs.indexOf(o);
    expect(outs.slice(iCut + 1).every((x) => x.spot === null)).toBe(true);
  });
  it('it ends once the stage shot has run its hold, not before', () => {
    const m = new Act2Machine();
    const { outs } = run2(m);
    expect(outs.filter((o) => o.done)).toHaveLength(1);
    expect(outs.at(-1)!.done).toBe(true);
    expect(m.log.map((e) => e.what)).toEqual(['start', 'hop', 'catWakes', 'hop', 'hop', 'atDoor', 'doorOpens', 'pushOut', 'outside', 'done'].filter((w) => m.log.some((e) => e.what === w)));
    // without the stage shot it never ends (it waits for the camera, nothing is cut short)
    const m2 = new Act2Machine();
    let ended = false;
    for (let i = 0; i < 90 / DT; i++) ended = m2.update(DT, { shot: 'doorOut', shotElapsed: 99 }).done || ended;
    expect(ended).toBe(false);
  });
  it('the whole of Acts 1 and 2 from the first hold takes about 50 seconds, so the card is not slow to get going', () => {
    const a1 = new Act1Machine();
    const outs1 = run1(a1, 40, (t) => (t < 4 ? HOLD : NONE));
    const t1 = first(outs1, (o) => o.done) * DT;
    const { outs } = run2(new Act2Machine());
    const t2 = outs.length * DT;
    expect(t1 + t2).toBeGreaterThan(30);
    expect(t1 + t2).toBeLessThan(80);
  });
  it('reduced motion: no hops, one quiet lean, a slow glide, then the same door and push-out', () => {
    const m = new Act2Machine({ reduced: true });
    const { outs } = run2(m);
    expect(outs.some((o) => o.chamgadad === 'hop')).toBe(false);
    expect(outs.filter((o) => o.chamgadad === 'curiousLean').length).toBeGreaterThanOrEqual(1);
    expect(outs.some((o) => o.shot === 'doorOut')).toBe(true);
    expect(outs.at(-1)!.done).toBe(true);
    const spots = outs.filter((o) => o.spot).map((o) => o.spot!);
    for (let i = 1; i < spots.length; i++) expect(Math.hypot(spots[i]!.x - spots[i - 1]!.x, spots[i]!.z - spots[i - 1]!.z)).toBeLessThan(0.02);
  });
  it('reduced motion stays in step with the slower camera: the walk and the door take REDUCED_SLOWDOWN times as long (found in the browser: she was out of frame)', () => {
    const at = (outs: Act2Out[], phase: string): number => outs.findIndex((o) => o.phase === phase) * DT;
    const n = run2(new Act2Machine()).outs;
    const r = run2(new Act2Machine({ reduced: true })).outs;
    expect(at(r, 'opening')).toBeCloseTo(new Act2Machine().walkSeconds * REDUCED_SLOWDOWN, 1);
    expect((at(r, 'pushOut') - at(r, 'opening')) / (at(n, 'pushOut') - at(n, 'opening'))).toBeCloseTo(REDUCED_SLOWDOWN, 1);
    // and she is at the door, still, whenever the door moves
    const d = r.find((o) => o.nookDoor > 0)!;
    expect(d.spot!.x).toBeCloseTo(NOOK.hx - 0.8, 6);
  });
  it('bad dt does not break it', () => {
    const m = new Act2Machine();
    for (const dt of [NaN, -1, 0, Infinity, 7]) {
      const o = m.update(dt, { shot: null, shotElapsed: NaN });
      expect(Number.isFinite(o.nookDoor)).toBe(true);
      if (o.spot) for (const v of [o.spot.x, o.spot.y, o.spot.z, o.spot.yaw]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('the new shots', () => {
  it('nookSleep starts where nookWide ends, nookWalk where nookBed ends, nookAtDoor where nookWalk ends (no jump when they follow each other)', () => {
    const same = (a: readonly number[], b: readonly number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));
    same(SHOTS.nookSleep.eye[0]!, SHOTS.nookWide.eye.at(-1)!);
    same(SHOTS.nookWalk.eye[0]!, SHOTS.nookBed.eye.at(-1)!);
    same(SHOTS.nookAtDoor.eye[0]!, SHOTS.nookWalk.eye.at(-1)!);
    same(SHOTS.nookAtDoor.look[0]!, SHOTS.nookWalk.look.at(-1)!);
  });
  it('they are in the shot list', () => {
    for (const n of ['nookSleep', 'nookWalk', 'nookAtDoor']) expect(SHOT_NAMES).toContain(n);
  });
});

describe('purity', () => {
  it('actsMath.ts imports no three, no DOM and no clock or random', () => {
    const text = readFileSync('src/acts/actsMath.ts', 'utf8');
    expect(text).not.toMatch(/from 'three'/);
    expect(text).not.toMatch(/\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random|setTimeout/);
  });
  it('only main.ts imports the acts; the acts folder is the only place with the words', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    for (const f of walk('src').filter((x) => x.endsWith('.ts') && !x.startsWith('src/acts'))) {
      const t = readFileSync(f, 'utf8');
      if (f === 'src/main.ts') continue;
      expect(t, f).not.toMatch(/from '\.\.?\/(\.\.\/)?acts/);
    }
  });
  it('the owner\'s files are untouched by the build (letter and wishes stay as given)', () => {
    expect(readFileSync('content/letter.md', 'utf8')).toContain('TODO_OWNER');
    expect(JSON.parse(readFileSync('content/wishes.json', 'utf8')).strawberry).toBe('TODO_OWNER');
  });
});
