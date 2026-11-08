// Phase 16: the small state engine the cat and the snow bunny share. Pure maths, no three.
// A state is either a POSTURE (held, with tiny idle motion) or a ONE-SHOT (a timed movement that settles into another state). Every change
// starts from a snapshot of what is on screen, so a request made at any moment, even in the middle of a blend, starts where the animal is
// and cannot pop. A pose is a flat record of numbers (`'head.rx': 0.2`), missing keys mean 0 (the rest pose), so blending is one lerp.
// Timing is lazy on purpose (AD: slow ease in and out, nothing snaps, nothing bounces like a toy).
import { makeRng } from '../chamgadad/blink';

export type Pose = Readonly<Record<string, number>>;
export type Channels = Readonly<Record<string, number>>;
/** A pose plus the single-number channels (eyes closed, breath size and rate, shiver, ...). */
export interface Sample {
  pose: Pose;
  ch: Channels;
}

export const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
export const smoother = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const finite = (x: number): boolean => Number.isFinite(x);

export function lerpRecord(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(a)) out[k] = a[k]! + ((b[k] ?? 0) - a[k]!) * t;
  for (const k of Object.keys(b)) if (!(k in a)) out[k] = b[k]! * t;
  return out;
}
export function lerpSample(a: Sample, b: Sample, t: number): Sample {
  return { pose: lerpRecord(a.pose, b.pose, t), ch: lerpRecord(a.ch, b.ch, t) };
}
export function sampleOf(pose: Pose, ch: Channels = {}): Sample {
  return { pose, ch };
}

/** Largest change of any pose number between two samples (radians for angles, metres for offsets). */
export function poseDistance(a: Sample, b: Sample): number {
  let m = 0;
  const keys = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
  for (const k of keys) m = Math.max(m, Math.abs((a.pose[k] ?? 0) - (b.pose[k] ?? 0)));
  return m;
}

export type Key = readonly [time: number, sample: Sample];
/** Smooth movement through keyed samples (time ascending). Before the first key and after the last it holds. Ease in and out at every key. */
export function keyframes(keys: readonly Key[], t: number): Sample {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (!(t > first[0])) return first[1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, s1] = keys[i]!;
    if (t < t1) {
      const [t0, s0] = keys[i - 1]!;
      return lerpSample(s0, s1, smoother((t - t0) / (t1 - t0)));
    }
  }
  return last[1];
}

// ---------------------------------------------------------------------------------------------------------------------
// Small effects the rigs read from a gesture's clock (seconds since it started; the engine says which are running).
// ---------------------------------------------------------------------------------------------------------------------
/** A quick flick that dies away: 1 at the start, ringing about 3 times, gone by `length`. Multiply by the part's angle. */
export function flickWave(t: number, length = 0.5): number {
  if (!(t >= 0) || t >= length) return 0;
  const u = t / length;
  return Math.sin(u * Math.PI * 5) * (1 - u) * (1 - u) * 1.6;
}
/** A drowsy blink: close, hold, open (seconds), returns 0 open .. 1 closed. */
export const SLOW_BLINK = { close: 0.55, hold: 0.35, open: 0.75 } as const;
export const SLOW_BLINK_LENGTH = SLOW_BLINK.close + SLOW_BLINK.hold + SLOW_BLINK.open;
export function slowBlinkAt(t: number): number {
  if (!(t >= 0) || t >= SLOW_BLINK_LENGTH) return 0;
  if (t < SLOW_BLINK.close) return smooth(t / SLOW_BLINK.close);
  if (t < SLOW_BLINK.close + SLOW_BLINK.hold) return 1;
  return 1 - smooth((t - SLOW_BLINK.close - SLOW_BLINK.hold) / SLOW_BLINK.open);
}
/** A burst of quick twitches: about 7 a second, an envelope that rises and falls, -1..1. */
export function twitchWave(t: number, length = 1.1): number {
  if (!(t >= 0) || t >= length) return 0;
  const u = t / length;
  return Math.sin(t * Math.PI * 2 * 7.5) * Math.sin(u * Math.PI);
}

// ---------------------------------------------------------------------------------------------------------------------
export interface StateDef<S extends string> {
  kind: 'posture' | 'oneShot';
  /** Seconds to blend in from wherever the animal is (grows with how far it must travel, up to MAX_TRAVEL_BLEND). */
  blend: number;
  /** The posture or the movement at `t` seconds after the state began (the blend is applied on top). Idle motion starts at 0 so t = 0 is the mean. */
  sample(t: number, side: 1 | -1): Sample;
  /** One-shots: how long it lasts, from when another request may interrupt it, and the state it settles into. */
  length?: number;
  free?: number;
  then?: S;
}

export interface GestureDef {
  /** How long it runs (seconds). */
  length: number;
  /** After it ends, how long before it may run again. */
  cooldown: number;
}

export interface AutoGesture<S extends string, G extends string> {
  gesture: G;
  /** Seconds between tries, uniformly random between these. */
  min: number;
  max: number;
  /** Only while in one of these states. */
  states: readonly S[];
}

export interface CritterDef<S extends string, G extends string> {
  initial: S;
  states: Record<S, StateDef<S>>;
  /** From a state, the states that may be requested directly. Anything else is routed through `via` or refused. */
  allow: Record<S, readonly S[]>;
  /** When `to` is not directly allowed from `from`, the state to go through first (the request waits behind it); null = refuse. */
  via(from: S, to: S): S | null;
  gestures: Record<G, GestureDef>;
  auto: readonly AutoGesture<S, G>[];
  /** Per-state number of rest breaths etc. live in the channels `breathAmp` and `breathHz`. */
}

export interface Frame<S extends string, G extends string> {
  state: S;
  pose: Pose;
  /** 0..1: how closed the eyes are being held. 0 = leave the automatic blinks alone. */
  eyes: number;
  /** About -1..1 times its size; the rig turns it into a small rise of the chest. */
  breath: number;
  /** A fast tiny tremor -1..1 (purr). Exactly 0 under reduced motion. */
  shiver: number;
  /** Other channels as they are now (hide, ...). */
  ch: Channels;
  /** 0..1: how far the blend into the current state has got. */
  blend: number;
  /** For every gesture, seconds since it started, or -1 when it is not running. */
  gt: Record<G, number>;
  /** The slow blink as 0..1 (already folded into `eyes`). */
  events: StateEvent<S>[];
}
export type StateEvent<S extends string> = { type: 'state'; from: S; to: S };

export const LAZY = { maxDt: 0.1, secondsPerUnit: 0.6, maxTravelBlend: 2.6, shiverHz: 12 } as const;
/** Reduced motion: movements shrink to this fraction of the way along a straight line, blends are slower, nothing happens on its own, no tremor. */
export const REDUCED = { amount: 0.35, blendScale: 1.6, breath: 0.5 } as const;

export type RequestResult = 'started' | 'queued' | 'routed' | 'same' | 'refused';

export interface CritterOptions {
  reducedMotion?: boolean;
  seed?: number;
  /** Automatic gestures (ear flicks, nose twitches, ...). Default: on unless reduced motion. */
  auto?: boolean;
}

export class Critter<S extends string, G extends string> {
  readonly def: CritterDef<S, G>;
  reducedMotion: boolean;
  /** Turn off for screenshots and tests that want exactly the requested motion. */
  auto: boolean;
  private cur: S;
  private t = 0;
  private blendT = Infinity;
  private blendDur = 1;
  private snap: Sample;
  private queue: { to: S; side: 1 | -1 } | null = null;
  private side: 1 | -1 = 1;
  private phase = 0;
  private shiverPhase = 0;
  private gtimes: Record<G, number>;
  private cool: Record<G, number>;
  private autoWait: number[];
  private rng: () => number;
  private pending: StateEvent<S>[] = [];
  private last: Frame<S, G>;

  constructor(def: CritterDef<S, G>, opts: CritterOptions = {}) {
    this.def = def;
    this.reducedMotion = !!opts.reducedMotion;
    this.auto = opts.auto ?? !this.reducedMotion;
    this.rng = makeRng(opts.seed ?? 11);
    this.cur = def.initial;
    this.gtimes = {} as Record<G, number>;
    this.cool = {} as Record<G, number>;
    for (const g of Object.keys(def.gestures) as G[]) {
      this.gtimes[g] = -1;
      this.cool[g] = 0;
    }
    this.autoWait = def.auto.map((a) => this.gap(a));
    this.snap = this.sampleNow();
    this.last = this.frameFrom(this.snap, 1, 0);
  }

  get state(): S {
    return this.cur;
  }
  /** Seconds in the current state. */
  get time(): number {
    return this.t;
  }
  get frame(): Frame<S, G> {
    return this.last;
  }

  private gap(a: AutoGesture<S, G>): number {
    return a.min + this.rng() * (a.max - a.min);
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.auto = !on;
  }

  /** The state's own sample at the current time, with reduced motion applied (not the blend). */
  private sampleNow(): Sample {
    const d = this.def.states[this.cur];
    const full = d.sample(this.t, this.side);
    if (!this.reducedMotion) return full;
    if (d.kind === 'oneShot' && d.length) {
      const s0 = d.sample(0, this.side);
      const s1 = d.sample(d.length, this.side);
      const line = lerpSample(s0, s1, smooth(this.t / d.length));
      return lerpSample(line, full, REDUCED.amount);
    }
    return lerpSample(d.sample(0, this.side), full, REDUCED.amount);
  }

  private startState(to: S): void {
    const from = this.cur;
    this.snap = this.displayed();
    this.cur = to;
    this.t = 0;
    this.blendT = 0;
    const d = this.def.states[to];
    const dist = poseDistance(this.snap, this.sampleNow());
    const scale = this.reducedMotion ? REDUCED.blendScale : 1;
    this.blendDur = Math.max(0.05, Math.min(LAZY.maxTravelBlend * scale, Math.max(d.blend, LAZY.secondsPerUnit * dist) * scale));
    this.pending.push({ type: 'state', from, to });
  }

  /** What is on screen right now (the blend, if one is running). */
  private displayed(): Sample {
    const target = this.sampleNow();
    if (this.blendT >= this.blendDur) return target;
    return lerpSample(this.snap, target, smoother(this.blendT / this.blendDur));
  }

  request(to: S, opts: { side?: 1 | -1 } = {}): RequestResult {
    const side = opts.side ?? this.side;
    if (!(to in this.def.states)) return 'refused';
    const d = this.def.states[this.cur];
    if (to === this.cur && d.kind === 'posture') {
      this.side = side;
      return 'same';
    }
    if (d.kind === 'oneShot' && d.free !== undefined && this.t < d.free) {
      this.queue = { to, side };
      return 'queued';
    }
    if (d.kind === 'oneShot' && d.free === undefined) {
      this.queue = { to, side };
      return 'queued';
    }
    if (!this.def.allow[this.cur].includes(to)) {
      const via = this.def.via(this.cur, to);
      if (via === null || !this.def.allow[this.cur].includes(via)) return 'refused';
      this.queue = { to, side };
      this.side = side;
      this.startState(via);
      return 'routed';
    }
    this.side = side;
    this.queue = null;
    this.startState(to);
    return 'started';
  }

  /** Start a gesture now. False when it is running, cooling down or not known. Gestures never change the posture. */
  gesture(g: G): boolean {
    const gd = this.def.gestures[g];
    if (!gd || this.gtimes[g] >= 0 || this.cool[g] > 0) return false;
    this.gtimes[g] = 0;
    return true;
  }

  private frameFrom(s: Sample, _blend: number, dt: number): Frame<S, G> {
    const reduced = this.reducedMotion;
    const amp = (s.ch.breathAmp ?? 0) * (reduced ? REDUCED.breath : 1);
    const hz = s.ch.breathHz ?? 0.2;
    this.phase = (this.phase + dt * hz) % 1;
    this.shiverPhase = (this.shiverPhase + dt * LAZY.shiverHz) % 1;
    const events = this.pending;
    this.pending = [];
    // a slow blink or anything else that closes the eyes is folded in by the rig; here the held closure is the state's
    const frame: Frame<S, G> = {
      state: this.cur,
      pose: s.pose,
      eyes: clamp(s.ch.eyes ?? 0, 0, 1),
      breath: Math.sin(this.phase * Math.PI * 2) * amp,
      shiver: reduced ? 0 : Math.sin(this.shiverPhase * Math.PI * 2) * (s.ch.shiver ?? 0),
      ch: s.ch,
      blend: this.blendT >= this.blendDur ? 1 : this.blendT / this.blendDur,
      gt: { ...this.gtimes },
      events,
    };
    return frame;
  }

  update(dtIn: number): Frame<S, G> {
    const dt = finite(dtIn) && dtIn > 0 ? Math.min(dtIn, LAZY.maxDt) : 0;
    this.t += dt;
    this.blendT += dt;
    const d = this.def.states[this.cur];
    if (d.kind === 'oneShot') {
      if (this.queue && d.free !== undefined && this.t >= d.free && this.t < (d.length ?? Infinity)) {
        const q = this.queue;
        this.queue = null;
        if (this.def.allow[this.cur].includes(q.to)) {
          this.side = q.side;
          this.startState(q.to);
        } else {
          this.queue = q;
        }
      }
      if (this.def.states[this.cur].kind === 'oneShot' && this.t >= (this.def.states[this.cur].length ?? 0)) {
        const cd = this.def.states[this.cur];
        const next = cd.then ?? this.def.initial;
        const q = this.queue;
        this.queue = null;
        this.startState(next);
        if (q) this.request(q.to, { side: q.side });
      }
    } else if (this.queue) {
      const q = this.queue;
      this.queue = null;
      this.request(q.to, { side: q.side });
    }
    // gestures
    for (const g of Object.keys(this.def.gestures) as G[]) {
      if (this.cool[g] > 0) this.cool[g] = Math.max(0, this.cool[g] - dt);
      if (this.gtimes[g] >= 0) {
        this.gtimes[g] += dt;
        if (this.gtimes[g] >= this.def.gestures[g].length) {
          this.gtimes[g] = -1;
          this.cool[g] = this.def.gestures[g].cooldown;
        }
      }
    }
    if (this.auto && !this.reducedMotion) {
      this.def.auto.forEach((a, i) => {
        this.autoWait[i]! -= dt;
        if (this.autoWait[i]! <= 0) {
          this.autoWait[i] = this.gap(a);
          if (a.states.includes(this.cur)) this.gesture(a.gesture);
        }
      });
    }
    this.last = this.frameFrom(this.displayed(), this.blendT >= this.blendDur ? 1 : this.blendT / this.blendDur, dt);
    return this.last;
  }
}
