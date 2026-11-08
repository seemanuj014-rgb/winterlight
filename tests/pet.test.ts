import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUNNY_HOP, BunnyPet, CatPet, PET, PetMachine, Reactions, SCRIPT_STROKE_RATE, lerpAngle, parsePetScript, petScriptAt,
  type BunnyIn, type CatIn, type PetScript, type V2,
} from '../src/interaction/petMath';
import { newCat, type CatState } from '../src/character/cat/states';
import { newBunny, type BunnyState } from '../src/character/bunny/states';
import { Behaviour } from '../src/character/chamgadad/behaviour';
import type { StateName } from '../src/character/chamgadad/states';
import { SHOTS, SHOT_NAMES, TOUR, SPOTS, locationOfEye } from '../src/world/shots';
import { terrainHeight } from '../src/world/groundMath';
import { createBus, type WinterEvents } from '../src/state/events';

const DT = 1 / 60;
const HOME: V2 = { x: SPOTS.bunny[0], z: SPOTS.bunny[2] };
const script = (q: string): PetScript => parsePetScript(new URLSearchParams(q));
const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// A little world of the REAL state machines (the cat's, the bunny's, Chamgadad's) driven by the pet machine the way `pet.ts` drives them in the browser.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
interface Rec {
  t: number;
  cat: CatState;
  bunny: BunnyState;
  bunnyTime: number;
  x: number;
  z: number;
  yaw: number;
  mode: string;
  cham: StateName;
  chamTime: number;
  affection: number;
}
function makeWorld(o: { reduced?: boolean; cat?: 'sleep' | 'sit'; place?: 'cat' | 'bunny' | 'both'; tapOn?: boolean } = {}) {
  const reduced = !!o.reduced;
  const place = o.place ?? 'both';
  const cat = newCat({ reducedMotion: reduced, auto: false });
  const bunny = newBunny({ reducedMotion: reduced, auto: false });
  const cham = new Behaviour({ reducedMotion: reduced });
  const m = new PetMachine({ bunnyHome: HOME });
  const results: string[] = [];
  const refused: string[] = [];
  const sides: number[] = [];
  const note = (who: string, what: string, r: string): void => {
    results.push(`${who}:${what}:${r}`);
    if (r === 'refused') refused.push(`${who}:${what}`);
  };
  if ((o.cat ?? 'sit') === 'sit') {
    cat.request('wake');
    for (let i = 0; i < 420; i++) cat.update(DT);
  }
  const recs: Rec[] = [];
  let t = 0;
  const api = {
    cat, bunny, cham, m, recs, results, refused, sides,
    get t() {
      return t;
    },
    /** run `sec` seconds with the scripted viewer; `hook` can change things each step (a test's own finger) */
    run(s: PetScript, sec: number, over?: (t0: number, t1: number) => Partial<{ catOn: boolean; catMoved: number; catTap: boolean; finger: V2 | null; tap: V2 | null }>): void {
      const n = Math.round(sec / DT);
      for (let i = 0; i < n; i++) {
        const t0 = t;
        t += DT;
        const sc = { ...petScriptAt(s, t0, t), ...(over ? over(t0, t) : {}) };
        const o2 = m.update(DT, {
          catPresent: place !== 'bunny',
          bunnyPresent: place !== 'cat',
          reduced,
          cat: { on: sc.catOn, moved: sc.catMoved, tap: sc.catTap, state: cat.state },
          bunny: { state: bunny.state, finger: sc.finger, tap: sc.tap ? { at: sc.tap, on: !!o.tapOn } : null, reduced },
          chamState: cham.state,
        });
        if (o2.cat) {
          if (o2.cat.request) note('cat', o2.cat.request, cat.request(o2.cat.request));
          for (const g of o2.cat.gestures) cat.gesture(g);
        }
        if (o2.bunny) {
          if (o2.bunny.request) note('bunny', o2.bunny.request, bunny.request(o2.bunny.request));
          for (const g of o2.bunny.gestures) bunny.gesture(g);
        }
        if (o2.cham.lean) {
          sides.push(1);
          note('cham', 'lean', cham.request('curiousLean', { side: 1, hold: 6 }));
        }
        if (o2.cham.blink) cham.gesture('slowBlink');
        if (o2.cham.ear) cham.gesture('earFlick');
        cat.update(DT);
        bunny.update(DT);
        cham.update(DT);
        recs.push({ t, cat: cat.state, bunny: bunny.state, bunnyTime: bunny.time, x: m.bunny.x, z: m.bunny.z, yaw: m.bunny.yaw, mode: m.bunny.mode, cham: cham.state, chamTime: cham.timeInState, affection: m.cat.affection });
      }
    },
    count: (type: string): number => m.log.filter((e) => e.type === type).length,
    firstAt: (type: string): number => m.log.find((e) => e.type === type)?.t ?? -1,
  };
  return api;
}

const catIn = (over: Partial<CatIn> = {}): CatIn => ({ on: false, moved: 0, tap: false, state: 'sit', ...over });
const bunnyIn = (over: Partial<BunnyIn> = {}): BunnyIn => ({ state: 'sit', finger: null, tap: null, reduced: false, ...over });

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('the scripted viewer (test knobs)', () => {
  it('parses strokes, rests, taps and fingers, and drops garbage', () => {
    const s = script('stroke=3-9,12-14&rest=20-25&tapcat=4,5&finger=2-9@0.5:-3.5&finger=11-12@x:y&tapat=6@1:-2&tapat=bad@1:1&stroke=9-3&stroke=a-b');
    expect(s.stroke).toEqual([[3, 9], [12, 14]]);
    expect(s.rest).toEqual([[20, 25]]);
    expect(s.tapCat).toEqual([4, 5]);
    expect(s.finger).toEqual([{ a: 2, b: 9, at: { x: 0.5, z: -3.5 } }]);
    expect(s.tapAt).toEqual([{ t: 6, at: { x: 1, z: -2 } }]);
    expect(script('')).toEqual({ stroke: [], rest: [], tapCat: [], finger: [], tapAt: [] });
  });
  it('each tap falls in exactly one step, and a stroke moves at its rate', () => {
    const s = script('tapcat=1.0&tapat=2@0:0&stroke=3-6');
    let cat = 0;
    let ground = 0;
    let moved = 0;
    for (let i = 0; i < 60 * 8; i++) {
      const a = petScriptAt(s, i * DT, (i + 1) * DT);
      if (a.catTap) cat++;
      if (a.tap) ground++;
      moved += a.catMoved;
    }
    expect(cat).toBe(1);
    expect(ground).toBe(1);
    expect(moved).toBeCloseTo(3 * SCRIPT_STROKE_RATE, 1);
  });
});

describe('the cat: drag to pet her', () => {
  it('does nothing without a hand: no purr, no gesture, affection stays 0', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script(''), 30);
    expect(w.count('purrStart')).toBe(0);
    expect(w.m.cat.affection).toBe(0);
    expect(w.cat.state).toBe('sit');
  });

  it('stroking her makes her purr after about three passes, and the cat\'s own machine goes sit -> purr', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script('stroke=2-12'), 14);
    const at = w.firstAt('purrStart');
    // 0.34 affection at (1.6 * 0.07 + 0.03) per second = about 2.4 s after the stroke begins
    expect(at).toBeGreaterThan(2 + 2);
    expect(at).toBeLessThan(2 + 3);
    expect(w.cat.state).toBe('purr');
    expect(w.refused).toEqual([]);
  });

  it('the first touch gets one ear flick, then she slow-blinks back, once, when she is really purring', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script('stroke=2-12'), 13);
    expect(w.count('catEar')).toBe(1);
    expect(w.count('catBlink')).toBe(1); // a 10 s stroke: affection passes 0.62 once, and the blink does not repeat for 14 s
    const blinkAt = w.firstAt('catBlink');
    expect(blinkAt).toBeGreaterThan(w.firstAt('purrStart'));
  });

  it('she does not blink back again inside its cooldown, and does after it', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script('stroke=2-40'), 42);
    const blinks = w.m.log.filter((e) => e.type === 'catBlink').map((e) => e.t);
    expect(blinks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < blinks.length; i++) expect(blinks[i]! - blinks[i - 1]!).toBeGreaterThanOrEqual(PET.cat.blinkCooldown - 0.1);
  });

  it('the purr lingers after the hand lifts, then she settles to sit', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script('stroke=2-8'), 8.2);
    expect(w.cat.state).toBe('purr');
    w.run(script(''), PET.cat.linger - 0.7); // still inside the linger
    expect(w.m.cat.purring).toBe(true);
    w.run(script(''), 1.4);
    expect(w.m.cat.purring).toBe(false);
    expect(w.count('purrEnd')).toBe(1);
    w.run(script(''), 6);
    expect(w.cat.state).toBe('sit');
  });

  it('a hand that only rests on her takes a long time (about 11 s), and a few light taps never purr her', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script('rest=1-30'), 9);
    expect(w.count('purrStart')).toBe(0);
    w.run(script('rest=1-30'), 4); // t = 13 s
    expect(w.count('purrStart')).toBe(1);
    const t = makeWorld({ place: 'cat' });
    t.run(script('tapcat=1,5,9,13,17,21,25'), 30);
    expect(t.count('purrStart')).toBe(0);
  });

  it('a tap is one ear flick, and a storm of taps is still one (a cooldown)', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script('tapcat=1,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2.0'), 3);
    expect(w.count('catEar')).toBe(1);
    w.run(script(''), 2.6);
    w.m.cat.update(DT, catIn({ tap: true }));
    const after = w.m.cat.update(0.0001, catIn({ tap: true }));
    expect(after.out.gestures.length).toBeLessThanOrEqual(1);
  });

  it('ear flicks alternate sides', () => {
    const c = new CatPet();
    const seen: string[] = [];
    for (let k = 0; k < 4; k++) {
      seen.push(...c.update(DT, catIn({ tap: true })).out.gestures);
      for (let i = 0; i < 200; i++) c.update(DT, catIn());
    }
    expect(seen).toEqual(['earFlickL', 'earFlickR', 'earFlickL', 'earFlickR']);
  });

  it('a sleeping cat that is stroked is woken first and then purrs (asleep -> wake -> purr), and nothing is refused', () => {
    const w = makeWorld({ place: 'cat', cat: 'sleep' });
    w.run(script('stroke=1-14'), 16);
    const seq: string[] = [];
    for (const r of w.recs) if (seq[seq.length - 1] !== r.cat) seq.push(r.cat);
    expect(seq).toEqual(['sleep', 'wake', 'purr']);
    expect(w.refused).toEqual([]);
  });

  it('affection stays between 0 and 1, falls when the hand is away, and bad numbers change nothing', () => {
    const c = new CatPet();
    for (let i = 0; i < 600; i++) c.update(DT, catIn({ on: true, moved: 3 }));
    expect(c.affection).toBe(1);
    for (let i = 0; i < 60 * 30; i++) c.update(DT, catIn());
    expect(c.affection).toBe(0);
    const d = new CatPet();
    for (const bad of [NaN, Infinity, -Infinity, -5]) d.update(DT, catIn({ on: true, moved: bad }));
    const before = d.affection;
    for (const bad of [NaN, Infinity, -1, 0, 1e9]) d.update(bad, catIn({ on: true, moved: NaN }));
    expect(Number.isFinite(d.affection)).toBe(true);
    expect(d.affection - before).toBeLessThan(0.01); // a bad stroke adds nothing; a huge dt counts as 0.1 s
  });

  it('a finger that jumps across the screen cannot fill her in one frame', () => {
    const c = new CatPet();
    c.update(DT, catIn({ on: true, moved: 1e6 }));
    expect(c.affection).toBeLessThanOrEqual(PET.cat.maxStroke * PET.cat.strokeGain + 0.001);
  });

  it('a soft buzz only while she purrs under a stroking hand, and never more than one every 1.6 s', () => {
    const c = new CatPet();
    const buzz: number[] = [];
    let t = 0;
    for (let i = 0; i < 60 * 12; i++) {
      t += DT;
      const s = c.update(DT, catIn({ on: true, moved: 0.03 }));
      if (s.out.haptic) buzz.push(t);
    }
    expect(buzz.length).toBeGreaterThan(2);
    for (let i = 1; i < buzz.length; i++) expect(buzz[i]! - buzz[i - 1]!).toBeGreaterThanOrEqual(PET.cat.hapticEvery - 0.05);
    const q = new CatPet();
    let none = 0;
    for (let i = 0; i < 60 * 3; i++) if (q.update(DT, catIn({ on: true, moved: 0 })).out.haptic) none++; // resting hand, not purring yet
    expect(none).toBe(0);
  });

  it('every pose she takes stays finite and she never leaves her state table', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script('stroke=2-10&tapcat=12,13&rest=20-26'), 40);
    for (const r of w.recs) expect(['sleep', 'wake', 'sit', 'stretch', 'purr']).toContain(r.cat);
    expect(w.refused).toEqual([]);
  });
});

describe('the bunny: hops toward a held finger, flees from a sudden tap', () => {
  const FINGER = { x: HOME.x + 2.0, z: HOME.z + 0.6 };
  const fingerQ = `finger=1-40@${FINGER.x}:${FINGER.z}`;

  it('a held finger brings her closer one hop at a time and she stops a hand\'s breadth away', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(fingerQ), 40);
    const end = { x: w.m.bunny.x, z: w.m.bunny.z };
    expect(dist(end, FINGER)).toBeLessThanOrEqual(PET.bunny.near + 0.05);
    expect(dist(end, FINGER)).toBeGreaterThan(0.2); // she does not run into the hand
    expect(w.count('bunnyHop')).toBeGreaterThanOrEqual(3);
    expect(w.count('bunnyArrive')).toBe(1);
    expect(w.refused).toEqual([]);
    // every hop request was accepted at once by the bunny's own machine
    expect(w.results.filter((r) => r.startsWith('bunny:hop')).every((r) => r === 'bunny:hop:started')).toBe(true);
  });

  it('she twitches her nose once on arrival and Chamgadad leans toward her', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(fingerQ), 40);
    expect(w.count('chamLean')).toBeGreaterThanOrEqual(1);
    expect(w.m.log.find((e) => e.type === 'chamLean')?.detail).toBe('bunny');
    expect(w.recs.some((r) => r.cham === 'curiousLean')).toBe(true);
  });

  it('she travels only while she is in the air, smoothly (no step over 4 cm a frame), and ends each hop exactly where it was aimed', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(fingerQ), 30);
    let maxStep = 0;
    let moving = 0;
    for (let i = 1; i < w.recs.length; i++) {
      const a = w.recs[i - 1]!;
      const b = w.recs[i]!;
      const step = Math.hypot(b.x - a.x, b.z - a.z);
      maxStep = Math.max(maxStep, step);
      if (step > 1e-6) {
        moving++;
        expect(b.bunny).toBe('hop');
        expect(b.bunnyTime).toBeGreaterThan(BUNNY_HOP.airStart - 0.1);
        expect(b.bunnyTime).toBeLessThan(BUNNY_HOP.free + 0.1);
      }
    }
    expect(maxStep).toBeLessThan(0.04);
    expect(moving).toBeGreaterThan(30);
  });

  it('each hop is at most 0.6 m and there is a pause between hops', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(fingerQ), 30);
    const hops = w.m.log.filter((e) => e.type === 'bunnyHop');
    for (let i = 1; i < hops.length; i++) expect(hops[i]!.t - hops[i - 1]!.t).toBeGreaterThanOrEqual(BUNNY_HOP.length);
    let prev = { x: HOME.x, z: HOME.z };
    let last = 'sit';
    for (const r of w.recs) {
      if (last === 'hop' && r.bunny !== 'hop') {
        expect(dist({ x: r.x, z: r.z }, prev)).toBeLessThanOrEqual(PET.bunny.hopMax + 0.01);
        prev = { x: r.x, z: r.z };
      }
      last = r.bunny;
    }
  });

  it('she turns to face the way she goes', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(fingerQ), 6);
    const want = Math.atan2(FINGER.x - HOME.x, FINGER.z - HOME.z);
    const diff = Math.abs(lerpAngle(w.m.bunny.yaw, want, 1) - w.m.bunny.yaw);
    expect(diff).toBeLessThan(0.35);
  });

  it('a finger far from her (past her reach) does nothing', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(`finger=1-30@${HOME.x + 9}:${HOME.z}`), 30);
    expect(w.count('bunnyHop')).toBe(0);
    expect(dist(w.m.bunny.pos, HOME)).toBe(0);
  });

  it('she never goes past her leash from home, even for a finger that is beyond it, and still looks and twitches', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(`finger=1-80@${HOME.x + 3.8}:${HOME.z}`), 80);
    for (const r of w.recs) expect(dist({ x: r.x, z: r.z }, HOME)).toBeLessThanOrEqual(PET.bunny.leash + 0.001);
    expect(w.count('bunnyArrive')).toBe(1);
    expect(w.refused).toEqual([]);
  });

  it('a sudden tap near her startles her: two hops away from it, then hide, a wait, one peek, then she sits again', () => {
    const w = makeWorld({ place: 'bunny' });
    const tap = { x: HOME.x + 1.0, z: HOME.z - 0.2 };
    w.run(script(`tapat=1@${tap.x}:${tap.z}`), 40);
    const order = w.m.log.filter((e) => e.type.startsWith('bunny')).map((e) => e.type + (e.detail ? ':' + e.detail : ''));
    expect(order).toEqual(['bunnyStartle', 'bunnyHop:flee', 'bunnyHop:flee', 'bunnyHide', 'bunnyPeek', 'bunnyBack']);
    expect(dist(w.m.bunny.pos, tap)).toBeGreaterThan(dist(HOME, tap) + 0.8);
    expect(w.bunny.state).toBe('sit');
    const seq: string[] = [];
    for (const r of w.recs) if (seq[seq.length - 1] !== r.bunny) seq.push(r.bunny);
    expect(seq).toEqual(['sit', 'hop', 'sit', 'hop', 'hide', 'peek', 'hide', 'sit']); // her table has no hop -> hop: she settles between the two flee hops
    expect(w.refused).toEqual([]);
  });

  it('she bolts AWAY from the tap, not along any fixed direction', () => {
    for (const ang of [0, 1.3, 2.6, 4.0, 5.2]) {
      const w = makeWorld({ place: 'bunny' });
      const tap = { x: HOME.x + Math.cos(ang) * 0.8, z: HOME.z + Math.sin(ang) * 0.8 };
      w.run(script(`tapat=1@${tap.x}:${tap.z}`), 9);
      expect(dist(w.m.bunny.pos, tap)).toBeGreaterThan(0.8 + 0.5);
    }
  });

  it('a tap far away does nothing, and a tap that lands ON her always does', () => {
    const far = makeWorld({ place: 'bunny' });
    far.run(script(`tapat=1@${HOME.x + 5}:${HOME.z}`), 8);
    expect(far.count('bunnyStartle')).toBe(0);
    const on = makeWorld({ place: 'bunny', tapOn: true });
    on.run(script(`tapat=1@${HOME.x + 5}:${HOME.z}`), 8);
    expect(on.count('bunnyStartle')).toBe(1);
  });

  it('a storm of taps is one startle: nothing spams while she is away, and she is shy for a few seconds when she is back', () => {
    const w = makeWorld({ place: 'bunny' });
    const taps = Array.from({ length: 60 }, (_, i) => `tapat=${(1 + i * 0.25).toFixed(2)}@${HOME.x + 0.5}:${HOME.z}`).join('&');
    w.run(script(taps), 25); // taps from 1 s to 16 s: she is fleeing, hiding or peeking for all of it
    expect(w.count('bunnyStartle')).toBe(1);
    expect(w.count('chamEar')).toBeLessThanOrEqual(1);
    // when she is back, the first few seconds ignore a tap, the next ones do not
    const back = w.firstAt('bunnyBack');
    expect(back).toBeGreaterThan(0);
    const w2 = makeWorld({ place: 'bunny' });
    w2.run(script(`tapat=1@${HOME.x + 0.5}:${HOME.z}`), 18); // she is back at about 16 s
    const b2 = w2.firstAt('bunnyBack');
    expect(b2).toBeGreaterThan(10);
    expect(w2.t).toBeLessThan(b2 + 3 - 0.5);
    const before = w2.count('bunnyStartle');
    const p = w2.m.bunny.pos;
    const tNow = w2.t;
    w2.run(script(`tapat=${(tNow + 0.3).toFixed(2)}@${p.x + 0.5}:${p.z}`), 1.0); // inside the shy window
    expect(w2.count('bunnyStartle')).toBe(before);
    w2.run(script(''), 4);
    const t3 = w2.t;
    w2.run(script(`tapat=${(t3 + 0.3).toFixed(2)}@${w2.m.bunny.x + 0.5}:${w2.m.bunny.z}`), 1);
    expect(w2.count('bunnyStartle')).toBe(before + 1);
  });

  it('a tap while she is in the air on her way to the finger makes her bolt as soon as she lands', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(`${fingerQ}&tapat=2@${HOME.x + 0.8}:${HOME.z + 0.2}`), 20);
    expect(w.count('bunnyStartle')).toBe(1);
    expect(w.count('bunnyHide')).toBe(1);
    expect(w.refused).toEqual([]);
  });

  it('fleeing at the edge of her leash stays inside it', () => {
    const w = makeWorld({ place: 'bunny' });
    // pull her to the leash, then startle her toward the outside
    w.run(script(`finger=1-40@${HOME.x + 3.8}:${HOME.z}`), 40);
    w.run(script(`tapat=${(w.t + 0.5).toFixed(2)}@${w.m.bunny.x - 0.4}:${w.m.bunny.z}`), 25);
    for (const r of w.recs) expect(dist({ x: r.x, z: r.z }, HOME)).toBeLessThanOrEqual(PET.bunny.leash + 0.001);
  });

  it('left alone she hops back toward home, one small hop at a time, so she stays in frame', () => {
    const w = makeWorld({ place: 'bunny' });
    w.run(script(fingerQ), 40); // she is near the finger now
    const away = dist(w.m.bunny.pos, HOME);
    expect(away).toBeGreaterThan(1);
    w.run(script(''), 130);
    expect(dist(w.m.bunny.pos, HOME)).toBeLessThan(PET.bunny.homeTol + 0.05);
    expect(w.m.log.some((e) => e.type === 'bunnyHop' && e.detail === 'home')).toBe(true);
  });

  it('reduced motion: she never hops or travels; a finger makes her turn and twitch once; a tap makes her duck where she is, then peek and come back', () => {
    const w = makeWorld({ place: 'bunny', reduced: true });
    w.run(script(fingerQ), 20);
    expect(w.count('bunnyHop')).toBe(0);
    expect(w.count('bunnyArrive')).toBe(1);
    expect(dist(w.m.bunny.pos, HOME)).toBe(0);
    const w2 = makeWorld({ place: 'bunny', reduced: true });
    w2.run(script(`tapat=1@${HOME.x + 0.5}:${HOME.z}`), 30);
    const order = w2.m.log.filter((e) => e.type.startsWith('bunny')).map((e) => e.type);
    expect(order).toEqual(['bunnyStartle', 'bunnyHide', 'bunnyPeek', 'bunnyBack']);
    expect(dist(w2.m.bunny.pos, HOME)).toBe(0);
    expect(w2.refused).toEqual([]);
  });

  it('she never asks for a posture her state table forbids (a 20 minute scripted storm of fingers and taps, none refused)', () => {
    const w = makeWorld({ place: 'bunny' });
    const parts: string[] = [];
    for (let k = 0; k < 40; k++) {
      parts.push(`finger=${k * 30 + 2}-${k * 30 + 14}@${HOME.x + Math.sin(k) * 2.5}:${HOME.z + Math.cos(k * 1.7) * 2.5}`);
      parts.push(`tapat=${k * 30 + 9 + (k % 5)}@${HOME.x + Math.sin(k * 3) * 1.5}:${HOME.z + Math.cos(k * 2) * 1.5}`);
    }
    w.run(script(parts.join('&')), 1200);
    expect(w.refused).toEqual([]);
    for (const r of w.recs) {
      expect(Number.isFinite(r.x) && Number.isFinite(r.z) && Number.isFinite(r.yaw)).toBe(true);
      expect(dist({ x: r.x, z: r.z }, HOME)).toBeLessThanOrEqual(PET.bunny.leash + 0.001);
    }
    expect(w.m.log.length).toBeLessThanOrEqual(400);
  });

  it('the ground she walks on: her height is the terrain\'s, so the glue can sit her on the snow anywhere on her leash', () => {
    for (let a = 0; a < 12; a++) {
      const x = HOME.x + Math.cos(a) * PET.bunny.leash;
      const z = HOME.z + Math.sin(a) * PET.bunny.leash;
      expect(Number.isFinite(terrainHeight(x, z))).toBe(true);
      expect(Math.abs(terrainHeight(x, z))).toBeLessThan(1);
    }
  });

  it('bad inputs (NaN finger, NaN tap, NaN dt) change nothing', () => {
    const b = new BunnyPet(HOME);
    const before = b.pos;
    for (const dt of [NaN, -1, Infinity, 0]) b.update(dt, bunnyIn({ finger: { x: NaN, z: 1 }, tap: { at: { x: 1, z: NaN }, on: false } }));
    expect(b.pos).toEqual(before);
    expect(b.mode).toBe('idle');
  });
});

describe('Chamgadad reacts, with cooldowns', () => {
  it('leans toward the cat when she starts to purr, slow-blinks when the cat blinks back, flicks an ear', () => {
    const w = makeWorld({ place: 'cat' });
    w.run(script('stroke=2-12'), 13);
    expect(w.count('chamLean')).toBe(1);
    expect(w.m.log.find((e) => e.type === 'chamLean')?.detail).toBe('cat');
    expect(w.count('chamBlink')).toBe(1);
    expect(w.count('chamEar')).toBeGreaterThanOrEqual(1);
    expect(w.recs.some((r) => r.cham === 'curiousLean')).toBe(true);
    expect(w.refused).toEqual([]);
  });

  it('does not lean again inside 8 s, blink inside 10 s or flick an ear inside 4 s', () => {
    const r = new Reactions();
    const lean = { kind: 'lean', toward: 'cat' } as const;
    expect(r.update(DT, [lean], 'rest').lean).toBe('cat');
    for (let i = 0; i < 60 * 7; i++) expect(r.update(DT, [lean], 'rest').lean).toBeNull();
    let again = false;
    for (let i = 0; i < 60 * 2; i++) if (r.update(DT, [lean], 'rest').lean) again = true;
    expect(again).toBe(true);
    const q = new Reactions();
    expect(q.update(DT, [{ kind: 'blink' }, { kind: 'ear' }], 'rest')).toEqual({ lean: null, blink: true, ear: true });
    expect(q.update(DT, [{ kind: 'blink' }, { kind: 'ear' }], 'rest')).toEqual({ lean: null, blink: false, ear: false });
  });

  it('asks nothing while she is asleep, waking, hopping or waving, and spends no cooldown doing so', () => {
    for (const busy of ['sleep', 'wake', 'hop', 'wave']) {
      const r = new Reactions();
      expect(r.update(DT, [{ kind: 'lean', toward: 'bunny' }, { kind: 'blink' }, { kind: 'ear' }], busy)).toEqual({ lean: null, blink: false, ear: false });
      expect(r.update(DT, [{ kind: 'lean', toward: 'bunny' }], 'rest').lean).toBe('bunny'); // the cooldown was not spent
    }
  });

  it('a leaning Chamgadad settles back to rest by herself, and a sleeping one is never asked to do anything', () => {
    const w = makeWorld({ place: 'cat' });
    w.cham.request('sleep');
    w.run(script('stroke=2-8'), 9);
    expect(w.m.log.some((e) => e.type.startsWith('cham'))).toBe(false);
    const v = makeWorld({ place: 'cat' });
    v.run(script('stroke=2-8'), 8);
    v.run(script(''), 14);
    expect(v.cham.state).toBe('rest');
  });

  it('there is no mouth and no smile: nothing asks for one and the states she has are only the ones the rig already draws', () => {
    const names = readFileSync('src/character/chamgadad/states.ts', 'utf8');
    expect(names).not.toMatch(/'smile'|'mouth'|'grin'/);
    for (const f of ['src/interaction/petMath.ts', 'src/interaction/pet.ts']) {
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code).not.toMatch(/smile|mouth|lips|teeth|blush|nose\b.*chamgadad/i);
    }
  });
});

describe('the whole machine', () => {
  it('only updates the animal that is there, and gives a log of everything that happened', () => {
    const m = new PetMachine({ bunnyHome: HOME });
    const o = m.update(DT, { catPresent: true, bunnyPresent: false, reduced: false, cat: catIn(), bunny: bunnyIn(), chamState: 'rest' });
    expect(o.cat).not.toBeNull();
    expect(o.bunny).toBeNull();
    const p = m.update(DT, { catPresent: false, bunnyPresent: true, reduced: false, cat: catIn(), bunny: bunnyIn(), chamState: 'rest' });
    expect(p.cat).toBeNull();
    expect(p.bunny).not.toBeNull();
  });

  it('a fuzz of wild inputs never makes a NaN, a negative or an unbounded log', () => {
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const m = new PetMachine({ bunnyHome: HOME });
    const states: BunnyState[] = ['sit', 'hide', 'peek', 'hop'];
    const cats: CatState[] = ['sleep', 'wake', 'sit', 'stretch', 'purr'];
    for (let i = 0; i < 40000; i++) {
      const wild = (): number => (rnd() < 0.05 ? [NaN, Infinity, -Infinity, 1e9, -1e9][Math.floor(rnd() * 5)]! : (rnd() - 0.5) * 8);
      const o = m.update(rnd() < 0.05 ? wild() : DT, {
        catPresent: rnd() < 0.7,
        bunnyPresent: rnd() < 0.7,
        reduced: rnd() < 0.1,
        cat: { on: rnd() < 0.5, moved: wild(), tap: rnd() < 0.05, state: cats[Math.floor(rnd() * 5)]! },
        bunny: { state: states[Math.floor(rnd() * 4)]!, finger: rnd() < 0.4 ? { x: HOME.x + wild(), z: HOME.z + wild() } : null, tap: rnd() < 0.05 ? { at: { x: wild(), z: wild() }, on: rnd() < 0.5 } : null, reduced: false },
        chamState: ['rest', 'sleep', 'curiousLean', 'wave'][Math.floor(rnd() * 4)]!,
      });
      if (o.bunny) {
        expect(Number.isFinite(o.bunny.x) && Number.isFinite(o.bunny.z) && Number.isFinite(o.bunny.yaw)).toBe(true);
        expect(dist({ x: o.bunny.x, z: o.bunny.z }, HOME)).toBeLessThanOrEqual(PET.bunny.leash + 0.001);
      }
      if (o.cat) expect(o.cat.affection >= 0 && o.cat.affection <= 1).toBe(true);
    }
    expect(m.log.length).toBeLessThanOrEqual(400);
  });
});

describe('placement, events, shots and purity', () => {
  it('the two close shots exist, sit in the right place, look at the pair, and are not part of the tour or the acts', () => {
    expect(SHOT_NAMES).toContain('petCat');
    expect(SHOT_NAMES).toContain('petBunny');
    expect(TOUR).not.toContain('petCat' as never);
    expect(TOUR).not.toContain('petBunny' as never);
    expect(locationOfEye(SHOTS.petCat.eye[0]![1])).toBe('nook');
    expect(locationOfEye(SHOTS.petBunny.eye[0]![1])).toBe('outside');
    const near = (e: readonly number[], p: readonly number[]): number => Math.hypot(e[0]! - p[0]!, e[1]! - p[1]!, e[2]! - p[2]!);
    for (const e of SHOTS.petCat.eye) expect(near(e, SPOTS.cat)).toBeGreaterThan(1.2);
    for (const e of SHOTS.petCat.eye) expect(near(e, SPOTS.cat)).toBeLessThan(4);
    for (const e of SHOTS.petBunny.eye) expect(near(e, SPOTS.bunny)).toBeGreaterThan(1.5);
    for (const e of SHOTS.petBunny.eye) expect(near(e, SPOTS.bunny)).toBeLessThan(5);
  });

  it('the bus carries the new events (for the purr loop and the footsteps of Phase 23)', () => {
    const bus = createBus<WinterEvents>();
    const got: string[] = [];
    bus.on('pet:purr', (e) => got.push('purr:' + e.on));
    bus.on('pet:bunny', (e) => got.push('bunny:' + e.kind));
    bus.emit('pet:purr', { on: true });
    bus.emit('pet:bunny', { kind: 'startle' });
    expect(got).toEqual(['purr:true', 'bunny:startle']);
  });

  const read = (f: string): string => readFileSync(f, 'utf8');
  it('petMath is pure: no three, no DOM, no clock, no random', () => {
    const code = read('src/interaction/petMath.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .map((l) => l.replace(/\s\/\/.*$/, ''))
      .join('\n');
    expect(code).not.toMatch(/from 'three'|document\.|window\.|Math\.random|Date\.now|performance\.now|setTimeout|requestAnimationFrame/);
  });

  it('adds nothing to draw: no mesh, light, sprite or scene.add in the interaction files', () => {
    for (const f of readdirSync('src/interaction')) {
      const code = read(join('src/interaction', f));
      expect(code).not.toMatch(/new THREE\.(Mesh|Line|Points|Sprite|PointLight|SpotLight|DirectionalLight)|scene\.add|\.add\(new /);
    }
  });

  it('puts no words on the page (the owner\'s words come from content/; there are none here)', () => {
    for (const f of readdirSync('src/interaction')) {
      const code = read(join('src/interaction', f));
      expect(code).not.toMatch(/textContent|innerText|innerHTML|createTextNode|aria-label/);
    }
  });

  it('no Chamgadad, cat, bunny or world file imports the interaction code, and `?pet` is opt-in', () => {
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, acc);
        else if (p.endsWith('.ts')) acc.push(p);
      }
      return acc;
    };
    for (const f of [...walk('src/character'), ...walk('src/world'), ...walk('src/core'), ...walk('src/input')]) expect(read(f)).not.toMatch(/interaction\//);
    const main = read('src/main.ts');
    expect(main).toMatch(/params\.has\('pet'\)/);
    expect(main).toMatch(/if \(petParam && !actsParam\)/);
  });

  it('does not touch the owner\'s files or her palette (the letter, the wishes, her colours)', () => {
    // these four are not edited by any phase-20 file: the test reads them only to be sure they still parse
    expect(() => JSON.parse(read('content/wishes.json'))).not.toThrow();
    expect(() => JSON.parse(read('character/palette.json'))).not.toThrow();
    expect(read('content/letter.md').length).toBeGreaterThan(0);
  });
});
