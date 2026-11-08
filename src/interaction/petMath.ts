// Phase 20: petting and companion reactions, as pure rules. No three, no DOM, no clock, no random: every step is handed `dt` and what the viewer's finger is doing,
// and answers with what to ask of the cat, the bunny and Chamgadad. `pet.ts` wires it to the input layer and the world; `tests/pet.test.ts` drives it with the real state machines.
//
//   THE CAT     a finger STROKING her (a drag that starts on her, or keeps going over her) fills "affection"; a hand just RESTING on her fills it very slowly. Past a threshold
//               she purrs (the cat's own `purr` state: a loaf, eyes half shut, a faint tremor). The first touch gets one ear flick, once she is really purring she slow-blinks back
//               (once, then not for a while), and the purr lingers a few seconds after the hand lifts, then she settles to `sit`. A tap is one ear flick. A sleeper who is stroked is
//               woken first by the cat's own machine (asleep -> wake -> purr).
//   THE BUNNY   a HELD finger (a hold, or a drag) near her makes her hop toward it, one small hop at a time (each hop is the bunny's own `hop` state: she travels only while she is in
//               the air), and stop a hand's breadth away to twitch her nose. A SUDDEN tap on her, or near her, startles her: two hops away from it, then `hide`, a long wait, one `peek`,
//               then she sits again and is shy for a few seconds. Taps while she is away are ignored. If nobody bothers her she hops back toward her home spot (so she stays in frame).
//   CHAMGADAD   leans toward whichever animal is happy (`curiousLean`), slow-blinks when the cat blinks back, flicks an ear. Cooldowns so nothing spams. No mouth is drawn: the long curve
//               under her face is still the owner's question Q1 (smile or chin), so "smiles" is NOT done here; the slow blink and the lean carry the happiness.
//   REDUCED MOTION   the bunny never hops: she turns, twitches, and a tap makes her duck where she is. The rest follows the critters' own reduced-motion scaling.
// Every number is mine `[A]`. Nothing here is a word: there is no text in this file.
import type { CatState, CatGesture } from '../character/cat/states';
import type { BunnyState, BunnyGesture } from '../character/bunny/states';
import type { HapticName } from '../input/hapticsMath';

export const PET = {
  cat: {
    /** affection gained per cat-radius stroked on her (a pass across her is about 2) */
    strokeGain: 0.07,
    /** affection per second of a hand resting on her */
    restGain: 0.03,
    /** affection lost per second with no hand on her */
    decay: 0.06,
    purrOn: 0.34,
    purrOff: 0.08,
    /** the purr goes on this long after the hand lifts (s) */
    linger: 4.5,
    /** seconds between the "hello" ear flicks (first touch and taps share it) */
    ackCooldown: 2.5,
    /** the slow blink back: only from this much affection, and not again for this long (s) */
    blinkAt: 0.62,
    blinkCooldown: 14,
    /** a soft buzz every this many seconds of stroking while she purrs */
    hapticEvery: 1.6,
    /** a finger that jumps across the screen between two frames cannot count for more than this many cat radii */
    maxStroke: 3,
  },
  bunny: {
    /** how far a hop carries her at most (m) and the least that is worth a hop */
    hopMax: 0.6,
    minHop: 0.12,
    /** she stops this far from the finger (m) */
    near: 0.55,
    /** she only notices a finger this close (m, on the ground) */
    reach: 4,
    /** a tap this close to her startles her (m), or any tap that lands on her */
    scare: 2.2,
    /** she never goes further than this from her home spot (m) */
    leash: 2.6,
    /** the pause between hops (s) */
    gap: 0.5,
    /** idle this long (s) and she hops back toward home */
    homeAfter: 25,
    homeTol: 0.3,
    /** startle: this many hops of this length (m) */
    fleeHops: 2,
    fleeHop: 0.85,
    /** hidden this long (s) before she peeks */
    hideFor: 5,
    /** after she is back, taps do nothing for this long (s) */
    shyAfter: 3,
    /** turn speed: time constant (s) */
    turnTau: 0.25,
  },
  cham: {
    leanCooldown: 8,
    blinkCooldown: 10,
    earCooldown: 4,
  },
} as const;

/** The bunny's `hop` state (`character/bunny/states.ts`): 2.4 s long, free to interrupt at 2.0 s, in the air from about 1.0 s to 1.9 s. Her travel follows that window. */
export const BUNNY_HOP = { length: 2.4, free: 2.0, airStart: 1.0, airEnd: 1.9 } as const;
/** The bunny's `peek` is 5.4 s long and ends in `hide`. */
export const BUNNY_PEEK_LENGTH = 5.4;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const finite = (x: number): boolean => Number.isFinite(x);
const sane = (dt: number): number => (finite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0);
const smoother = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export interface V2 {
  x: number;
  z: number;
}
const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.z - b.z);

export type PetEventType = 'purrStart' | 'purrEnd' | 'catEar' | 'catBlink' | 'bunnyHop' | 'bunnyArrive' | 'bunnyStartle' | 'bunnyHide' | 'bunnyPeek' | 'bunnyBack' | 'chamLean' | 'chamBlink' | 'chamEar';
export interface PetEvent {
  type: PetEventType;
  detail?: string;
}
export interface LogEntry {
  t: number;
  type: PetEventType;
  detail?: string;
}

/** What Chamgadad is asked to do (the glue works out which way "toward" is on screen). */
export type ChamEvent = { kind: 'lean'; toward: 'cat' | 'bunny' } | { kind: 'blink' } | { kind: 'ear' };
export interface ChamOut {
  lean: 'cat' | 'bunny' | null;
  blink: boolean;
  ear: boolean;
}

// ----------------------------------------------------------------------------------------------------------------------------- the cat
export interface CatIn {
  /** a finger is on her: stroking, or a hand resting */
  on: boolean;
  /** how far the finger moved over her since the last step, in cat radii on screen */
  moved: number;
  /** a tap landed on her since the last step */
  tap: boolean;
  /** what she is doing now (the cat's own machine) */
  state: CatState;
}
export interface CatOut {
  request: 'purr' | 'sit' | null;
  gestures: CatGesture[];
  haptic: HapticName | null;
  purring: boolean;
  affection: number;
}
export interface Step<O> {
  out: O;
  events: PetEvent[];
  cham: ChamEvent[];
}

export class CatPet {
  affection = 0;
  purring = false;
  private wasOn = false;
  private sinceTouch = Infinity;
  private ackCool = 0;
  private blinkCool = 0;
  private hapticT = 0;
  private flickSide = 0;

  update(dtIn: number, i: CatIn): Step<CatOut> {
    const C = PET.cat;
    const dt = sane(dtIn);
    this.ackCool = Math.max(0, this.ackCool - dt);
    this.blinkCool = Math.max(0, this.blinkCool - dt);
    const events: PetEvent[] = [];
    const cham: ChamEvent[] = [];
    const gestures: CatGesture[] = [];
    let request: CatOut['request'] = null;
    let haptic: HapticName | null = null;
    const moved = clamp(finite(i.moved) ? i.moved : 0, 0, C.maxStroke);

    if (i.on) this.sinceTouch = 0;
    else this.sinceTouch += dt;

    const flick = (): void => {
      if (this.ackCool > 0) return;
      this.ackCool = C.ackCooldown;
      gestures.push(this.flickSide++ % 2 === 0 ? 'earFlickL' : 'earFlickR');
      events.push({ type: 'catEar' });
    };
    if (i.on && !this.wasOn) flick(); // the first touch: one ear says hello
    else if (i.tap) flick();
    this.wasOn = i.on;

    if (i.on) this.affection += moved * C.strokeGain + C.restGain * dt;
    else this.affection -= C.decay * dt;
    this.affection = clamp(this.affection, 0, 1);

    if (!this.purring) {
      if (i.on && this.affection >= C.purrOn) {
        this.purring = true;
        this.hapticT = 0;
        request = 'purr'; // a sleeper is woken first by her own machine
        events.push({ type: 'purrStart' });
        cham.push({ kind: 'lean', toward: 'cat' });
      }
    } else {
      const over = (!i.on && this.sinceTouch >= C.linger) || this.affection <= C.purrOff;
      if (over) {
        this.purring = false;
        this.affection = Math.min(this.affection, C.purrOn * 0.5); // a lingering purr that ends does not start again by itself
        request = 'sit';
        events.push({ type: 'purrEnd' });
      } else {
        if (i.on) {
          this.hapticT += dt;
          if (this.hapticT >= C.hapticEvery) {
            this.hapticT = 0;
            haptic = 'soft';
          }
        }
        if (this.blinkCool <= 0 && this.affection >= C.blinkAt && i.state === 'purr') {
          this.blinkCool = C.blinkCooldown;
          gestures.push('slowBlink');
          events.push({ type: 'catBlink' });
          cham.push({ kind: 'blink' }, { kind: 'ear' });
        }
      }
    }
    return { out: { request, gestures, haptic, purring: this.purring, affection: this.affection }, events, cham };
  }
}

// --------------------------------------------------------------------------------------------------------------------------- the bunny
export type BunnyMode = 'idle' | 'hop' | 'hiding' | 'peeking';
export interface BunnyIn {
  state: BunnyState;
  /** where a held finger is on the ground (world x, z), or null */
  finger: V2 | null;
  /** a tap since the last step: where it was on the ground, and whether it landed on her */
  tap: { at: V2; on: boolean } | null;
  reduced: boolean;
}
export interface BunnyOut {
  request: 'hop' | 'hide' | 'peek' | 'sit' | null;
  gestures: BunnyGesture[];
  haptic: HapticName | null;
  x: number;
  z: number;
  yaw: number;
  mode: BunnyMode;
}

interface Hop {
  from: V2;
  to: V2;
  t: number;
  purpose: 'approach' | 'home' | 'flee';
  seen: boolean;
}

export class BunnyPet {
  x: number;
  z: number;
  yaw: number;
  mode: BunnyMode = 'idle';
  private home: V2;
  private desYaw: number;
  private hop: Hop | null = null;
  private hopsLeft = 0;
  private fleeDir: V2 = { x: 0, z: -1 };
  private gap = 0;
  private shy = 0;
  private idleT = 0;
  private hideT = 0;
  private peekT = 0;
  private arrived = false;
  private pendingFlee: V2 | null = null;

  private readonly leash: number;

  constructor(home: V2, yaw = 0, leash: number = PET.bunny.leash) {
    this.leash = finite(leash) && leash > 0 ? leash : PET.bunny.leash;
    this.home = { ...home };
    this.x = home.x;
    this.z = home.z;
    this.yaw = this.desYaw = yaw;
  }

  get pos(): V2 {
    return { x: this.x, z: this.z };
  }

  private clampLeash(p: V2): V2 {
    const d = dist(p, this.home);
    if (d <= this.leash) return p;
    const k = this.leash / d;
    return { x: this.home.x + (p.x - this.home.x) * k, z: this.home.z + (p.z - this.home.z) * k };
  }

  private face(to: V2): void {
    if (dist(to, this.pos) > 0.05) this.desYaw = Math.atan2(to.x - this.x, to.z - this.z);
  }

  private startHop(to: V2, purpose: Hop['purpose']): void {
    this.mode = 'hop';
    this.hop = { from: this.pos, to, t: 0, purpose, seen: false };
    this.face(to);
  }

  update(dtIn: number, i: BunnyIn): Step<BunnyOut> {
    const C = PET.bunny;
    const dt = sane(dtIn);
    this.gap = Math.max(0, this.gap - dt);
    this.shy = Math.max(0, this.shy - dt);
    this.idleT += dt;
    const events: PetEvent[] = [];
    const cham: ChamEvent[] = [];
    const gestures: BunnyGesture[] = [];
    let request: BunnyOut['request'] = null;
    let haptic: HapticName | null = null;

    const finger = i.finger && finite(i.finger.x) && finite(i.finger.z) ? i.finger : null;
    const tap = i.tap && finite(i.tap.at.x) && finite(i.tap.at.z) ? i.tap : null;
    const tapNear = tap !== null && (tap.on || dist(tap.at, this.pos) <= C.scare);

    const startle = (from: V2): void => {
      events.push({ type: 'bunnyStartle' });
      cham.push({ kind: 'ear' }, { kind: 'lean', toward: 'bunny' });
      this.idleT = 0;
      this.arrived = false;
      if (i.reduced) {
        // no running: she ducks where she is
        this.mode = 'hiding';
        this.hideT = 0;
        request = 'hide';
        events.push({ type: 'bunnyHide' });
        return;
      }
      let dx = this.x - from.x;
      let dz = this.z - from.z;
      let d = Math.hypot(dx, dz);
      if (d < 0.01) {
        dx = this.x - this.home.x;
        dz = this.z - this.home.z;
        d = Math.hypot(dx, dz);
        if (d < 0.01) {
          dx = 0;
          dz = -1;
          d = 1;
        }
      }
      this.fleeDir = { x: dx / d, z: dz / d };
      this.hopsLeft = C.fleeHops - 1;
      this.startHop(this.clampLeash({ x: this.x + this.fleeDir.x * C.fleeHop, z: this.z + this.fleeDir.z * C.fleeHop }), 'flee');
      request = 'hop';
      events.push({ type: 'bunnyHop', detail: 'flee' });
    };

    if (this.mode === 'idle') {
      if (tapNear && this.shy <= 0) {
        startle(tap!.at);
      } else if (finger && dist(finger, this.pos) <= C.reach) {
        this.idleT = 0;
        this.face(finger);
        const d = dist(finger, this.pos);
        if (d <= C.near) {
          this.arriveOnce(gestures, events, cham, (h) => (haptic = h));
        } else if (i.reduced) {
          this.arriveOnce(gestures, events, cham, (h) => (haptic = h)); // she turns to look and twitches; she does not run
        } else if (this.gap <= 0 && i.state === 'sit') {
          const step = Math.min(C.hopMax, d - C.near);
          const k = step / d;
          const to = this.clampLeash({ x: this.x + (finger.x - this.x) * k, z: this.z + (finger.z - this.z) * k });
          if (dist(to, this.pos) >= C.minHop) {
            this.arrived = false;
            this.startHop(to, 'approach');
            request = 'hop';
            events.push({ type: 'bunnyHop', detail: 'approach' });
          } else {
            this.arriveOnce(gestures, events, cham, (h) => (haptic = h)); // the leash stops her: she looks and twitches, that is all she can do
          }
        }
      } else {
        this.arrived = false;
        if (!i.reduced && this.idleT >= C.homeAfter && this.gap <= 0 && i.state === 'sit' && dist(this.home, this.pos) > C.homeTol) {
          const d = dist(this.home, this.pos);
          const k = Math.min(C.hopMax, d) / d;
          this.startHop({ x: this.x + (this.home.x - this.x) * k, z: this.z + (this.home.z - this.z) * k }, 'home');
          request = 'hop';
          events.push({ type: 'bunnyHop', detail: 'home' });
        }
      }
    } else if (this.mode === 'hop' && this.hop) {
      const h = this.hop;
      h.t += dt;
      if (i.state === 'hop') h.seen = true;
      const u = smoother((h.t - BUNNY_HOP.airStart) / (BUNNY_HOP.airEnd - BUNNY_HOP.airStart));
      this.x = h.from.x + (h.to.x - h.from.x) * u;
      this.z = h.from.z + (h.to.z - h.from.z) * u;
      if (tapNear && h.purpose !== 'flee' && this.shy <= 0 && !this.pendingFlee) this.pendingFlee = tap!.at; // a sudden tap in mid air: she bolts when she lands
      if (h.t > 0.4 && !h.seen) {
        // the behaviour never started the hop (something else had her): she stays where she is
        this.hop = null;
        this.mode = 'idle';
        this.x = h.from.x;
        this.z = h.from.z;
      } else if (h.t >= BUNNY_HOP.free) {
        this.x = h.to.x;
        this.z = h.to.z;
        if (h.purpose === 'flee') {
          if (this.hopsLeft > 0) {
            // her table has no hop -> hop: wait until the hop has ended by itself and she is back in `sit`, then the next hop
            if (i.state === 'sit' || h.t >= BUNNY_HOP.length + 0.3) {
              this.hopsLeft--;
              const to = this.clampLeash({ x: this.x + this.fleeDir.x * C.fleeHop, z: this.z + this.fleeDir.z * C.fleeHop });
              this.startHop(to, 'flee');
              request = 'hop';
              events.push({ type: 'bunnyHop', detail: 'flee' });
            }
          } else {
            this.hop = null;
            this.mode = 'hiding';
            this.hideT = 0;
            request = 'hide';
            events.push({ type: 'bunnyHide' });
          }
        } else if (h.t >= BUNNY_HOP.length || i.state !== 'hop') {
          this.hop = null;
          this.mode = 'idle';
          this.gap = C.gap;
          if (this.pendingFlee) {
            const from = this.pendingFlee;
            this.pendingFlee = null;
            if (this.shy <= 0) startle(from);
          }
        }
      }
    } else if (this.mode === 'hiding') {
      this.hideT += dt;
      if (this.hideT >= C.hideFor && i.state === 'hide') {
        this.mode = 'peeking';
        this.peekT = 0;
        request = 'peek';
        events.push({ type: 'bunnyPeek' });
      }
    } else if (this.mode === 'peeking') {
      this.peekT += dt;
      if (this.peekT >= BUNNY_PEEK_LENGTH + 0.2 && i.state === 'hide') {
        this.mode = 'idle';
        this.shy = C.shyAfter;
        this.idleT = 0;
        this.gap = C.gap;
        request = 'sit';
        events.push({ type: 'bunnyBack' });
      }
    }

    this.yaw = lerpAngle(this.yaw, this.desYaw, 1 - Math.exp(-dt / C.turnTau));
    return { out: { request, gestures, haptic, x: this.x, z: this.z, yaw: this.yaw, mode: this.mode }, events, cham };
  }

  private arriveOnce(gestures: BunnyGesture[], events: PetEvent[], cham: ChamEvent[], setHaptic: (h: HapticName) => void): void {
    if (this.arrived) return;
    this.arrived = true;
    gestures.push('noseTwitch');
    events.push({ type: 'bunnyArrive' });
    cham.push({ kind: 'lean', toward: 'bunny' });
    setHaptic('tick');
  }
}

// ----------------------------------------------------------------------------------------------------------------------- Chamgadad
/** Chamgadad does not react while she is doing something of her own. */
const CHAM_BUSY: ReadonlySet<string> = new Set(['sleep', 'wake', 'hop', 'wave']);

export class Reactions {
  private lean = 0;
  private blink = 0;
  private ear = 0;

  update(dtIn: number, events: readonly ChamEvent[], chamState: string): ChamOut {
    const C = PET.cham;
    const dt = sane(dtIn);
    this.lean = Math.max(0, this.lean - dt);
    this.blink = Math.max(0, this.blink - dt);
    this.ear = Math.max(0, this.ear - dt);
    const out: ChamOut = { lean: null, blink: false, ear: false };
    if (CHAM_BUSY.has(chamState)) return out; // asked for nothing, and no cooldown is spent
    for (const e of events) {
      if (e.kind === 'lean' && this.lean <= 0 && out.lean === null) {
        out.lean = e.toward;
        this.lean = C.leanCooldown;
      } else if (e.kind === 'blink' && this.blink <= 0 && !out.blink) {
        out.blink = true;
        this.blink = C.blinkCooldown;
      } else if (e.kind === 'ear' && this.ear <= 0 && !out.ear) {
        out.ear = true;
        this.ear = C.earCooldown;
      }
    }
    return out;
  }
}

// ----------------------------------------------------------------------------------------------------------------------- the whole
export interface PetIn {
  catPresent: boolean;
  bunnyPresent: boolean;
  reduced: boolean;
  cat: CatIn;
  bunny: BunnyIn;
  /** Chamgadad's own posture (`behaviour.state`) */
  chamState: string;
}
export interface PetOut {
  cat: CatOut | null;
  bunny: BunnyOut | null;
  cham: ChamOut;
  haptic: HapticName | null;
  events: PetEvent[];
}

const LOG_CAP = 400;

export class PetMachine {
  readonly cat = new CatPet();
  readonly bunny: BunnyPet;
  private readonly react = new Reactions();
  readonly log: LogEntry[] = [];
  private t = 0;

  constructor(opts: { bunnyHome: V2; bunnyYaw?: number; bunnyLeash?: number }) {
    this.bunny = new BunnyPet(opts.bunnyHome, opts.bunnyYaw ?? 0, opts.bunnyLeash);
  }

  get clock(): number {
    return this.t;
  }

  update(dtIn: number, i: PetIn): PetOut {
    const dt = sane(dtIn);
    this.t += dt;
    const events: PetEvent[] = [];
    const cham: ChamEvent[] = [];
    let cat: CatOut | null = null;
    let bunny: BunnyOut | null = null;
    let haptic: HapticName | null = null;
    if (i.catPresent) {
      const s = this.cat.update(dt, i.cat);
      cat = s.out;
      events.push(...s.events);
      cham.push(...s.cham);
      haptic = s.out.haptic;
    }
    if (i.bunnyPresent) {
      const s = this.bunny.update(dt, { ...i.bunny, reduced: i.reduced });
      bunny = s.out;
      events.push(...s.events);
      cham.push(...s.cham);
      haptic = haptic ?? s.out.haptic;
    }
    const c = this.react.update(dt, cham, i.chamState);
    if (c.lean) events.push({ type: 'chamLean', detail: c.lean });
    if (c.blink) events.push({ type: 'chamBlink' });
    if (c.ear) events.push({ type: 'chamEar' });
    for (const e of events) {
      this.log.push({ t: Number(this.t.toFixed(2)), type: e.type, ...(e.detail !== undefined ? { detail: e.detail } : {}) });
      if (this.log.length > LOG_CAP) this.log.shift();
    }
    return { cat, bunny, cham: c, haptic, events };
  }
}

// -------------------------------------------------------------------------------------------------------- a scripted viewer (test only)
// So that a frame sequence can be repeated exactly (`?pet&stroke=3-12`): the same inputs the real fingers would make, on a timetable. Seconds on the page's own fixed clock.
//   &stroke=a-b          a finger strokes the cat from a to b (about 1.6 cat radii a second)
//   &rest=a-b            a hand rests on the cat
//   &tapcat=t,t          taps on the cat
//   &finger=a-b@x:z      a finger is held on the ground at world (x, z) (repeat the parameter for more)
//   &tapat=t@x:z         a tap on the ground at (x, z) (repeat)
export interface PetScript {
  stroke: [number, number][];
  rest: [number, number][];
  tapCat: number[];
  finger: { a: number; b: number; at: V2 }[];
  tapAt: { t: number; at: V2 }[];
}
export const SCRIPT_STROKE_RATE = 1.6;

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const v = Number(s);
  return finite(v) ? v : null;
};
const range = (s: string): [number, number] | null => {
  const [a, b] = s.split('-');
  const x = num(a);
  const y = num(b);
  return x !== null && y !== null && y > x && x >= 0 ? [x, y] : null;
};
const point = (s: string | undefined): V2 | null => {
  const [a, b] = (s ?? '').split(':');
  const x = num(a);
  const z = num(b);
  return x !== null && z !== null ? { x, z } : null;
};

export function parsePetScript(params: URLSearchParams): PetScript {
  const s: PetScript = { stroke: [], rest: [], tapCat: [], finger: [], tapAt: [] };
  for (const v of params.getAll('stroke')) for (const part of v.split(',')) { const r = range(part); if (r) s.stroke.push(r); }
  for (const v of params.getAll('rest')) for (const part of v.split(',')) { const r = range(part); if (r) s.rest.push(r); }
  for (const v of params.getAll('tapcat')) for (const part of v.split(',')) { const t = num(part); if (t !== null && t >= 0) s.tapCat.push(t); }
  for (const v of params.getAll('finger')) {
    const [rg, pt] = v.split('@');
    const r = range(rg ?? '');
    const p = point(pt);
    if (r && p) s.finger.push({ a: r[0], b: r[1], at: p });
  }
  for (const v of params.getAll('tapat')) {
    const [tt, pt] = v.split('@');
    const t = num(tt);
    const p = point(pt);
    if (t !== null && t >= 0 && p) s.tapAt.push({ t, at: p });
  }
  return s;
}

export interface ScriptStep {
  catOn: boolean;
  catMoved: number;
  catTap: boolean;
  finger: V2 | null;
  tap: V2 | null;
}
/** What the scripted viewer does in the step from `t0` to `t1`. */
export function petScriptAt(s: PetScript, t0: number, t1: number): ScriptStep {
  const inside = (r: [number, number]): boolean => t1 > r[0] && t1 <= r[1];
  const stroking = s.stroke.some(inside);
  const resting = s.rest.some(inside);
  const f = s.finger.find((w) => t1 > w.a && t1 <= w.b);
  const tp = s.tapAt.find((w) => w.t > t0 && w.t <= t1);
  return {
    catOn: stroking || resting,
    catMoved: stroking ? SCRIPT_STROKE_RATE * Math.max(0, t1 - t0) : 0,
    catTap: s.tapCat.some((t) => t > t0 && t <= t1),
    finger: f ? f.at : null,
    tap: tp ? tp.at : null,
  };
}
