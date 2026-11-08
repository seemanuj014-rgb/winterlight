// Phase 10: the behaviour state machine. Pure maths, no three.
// It holds one POSTURE (rest, breathe, sleep, sitLookUp, findFinger, curiousLean) or one-shot (wake, hop, wave) at a time, plus two small
// face GESTURES (slowBlink, earFlick) that never change the posture. Every change starts from a snapshot of what is on screen, so a
// request made at any moment, even in the middle of another blend, starts where Chamgadad is and cannot pop.
// The timing is "lazy" (LAZY below): slow blends, long holds, eyes that lead and a head that follows, nothing that overshoots.
import { blendPose, SIT, type Pose } from './pose';
import { STATES, canTransition, routePath, smoother, type Ctx, type GestureName, type Sample, type StateName, HOP_EVENTS } from './states';

export interface LazyProfile {
  /** Multiplies every state's blend time. */
  blendScale: number;
  /** Half-lives (seconds to cover half the distance) of the things that follow a target. */
  eyesHalfLife: number;
  zsHalfLife: number;
  pointerHalfLife: number;
  /** Frames longer than this count as this long. */
  maxDt: number;
  /** A slow blink: close, hold, open (seconds). The automatic blinks of face.ts are quicker; this is the drowsy one. */
  slowBlink: { close: number; hold: number; open: number };
  /** After a gesture, how long before the same one may run again. */
  gestureCooldown: number;
}

export const LAZY: LazyProfile = {
  blendScale: 1,
  eyesHalfLife: 0.3,
  zsHalfLife: 0.9,
  pointerHalfLife: 0.28,
  maxDt: 0.1,
  slowBlink: { close: 0.55, hold: 0.35, open: 0.75 },
  gestureCooldown: 0.4,
};

/** Reduced motion: movements shrink to this fraction of the way from the rest pose, blends are slower, nothing happens on its own. */
export const REDUCED = { amount: 0.35, blendScale: 1.6, breath: 0.5 } as const;

export type EarName = 'upright' | 'angled' | 'both';
export type BehaviourEvent =
  | { type: 'earFlick'; which: EarName; strength: number }
  | { type: 'state'; from: StateName; to: StateName };

export interface Frame {
  state: StateName;
  /** The pose to apply with `applyPose`. */
  pose: Pose;
  gaze: readonly [number, number];
  /** 0..1 how closed the eyes are held; the rig hands it to the face. 0 = leave the automatic blinks alone. */
  eyes: number;
  zs: number;
  stretch: number;
  /** The breath right now, about -1..1 times its size (the rig turns it into a small rise of the chest). */
  breath: number;
  /** 0..1 how far the blend into the current state has got (1 = fully there). */
  blend: number;
  gesture: GestureName | null;
  events: BehaviourEvent[];
}

export interface BehaviourOptions {
  reducedMotion?: boolean;
  profile?: Partial<LazyProfile>;
}

export type RequestResult = 'started' | 'queued' | 'routed' | 'same' | 'refused';

interface Snapshot {
  pose: Pose;
  stretch: number;
  breathAmp: number;
  breathHz: number;
  gaze: readonly [number, number];
}

/** Largest change of any number between two poses (radians for angles, world units for offsets). */
export function poseDistance(a: Pose, b: Pose): number {
  let m = 0;
  for (const n of Object.keys(a) as (keyof Pose)[]) for (let i = 0; i < 3; i++) m = Math.max(m, Math.abs(a[n].pos[i]! - b[n].pos[i]!), Math.abs(a[n].rot[i]! - b[n].rot[i]!));
  return m;
}
const SECONDS_PER_RADIAN = 0.6;
const MAX_TRAVEL_BLEND = 2.6;

const finite = (x: number): boolean => Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export class Behaviour {
  readonly profile: LazyProfile;
  reducedMotion: boolean;
  private cur: StateName = 'rest';
  private t = 0; // seconds in the current state
  private blendT = Infinity; // seconds since the current blend began
  private blendDur = 1;
  private snap: Snapshot;
  private resume: StateName = 'rest';
  private queue: { to: StateName; side?: -1 | 1; hold?: number } | null = null;
  /** The posture to take after the current one-shot, when it was started on top of a waiting queue (route paths). */
  private route: StateName[] = [];
  private side: -1 | 1 = 1;
  /** State time at which a posture relaxes to rest (Infinity = never). */
  private holdUntil = Infinity;
  private pointer: [number, number] | null = null;
  private pointerS: [number, number] = [0, 0];
  private eyes = 0;
  private zs = 0;
  private phase = 0;
  private last: Frame;
  private gestureName: GestureName | null = null;
  private gestureT = 0;
  private cooldown: Record<GestureName, number> = { slowBlink: 0, earFlick: 0 };
  private fired = new Set<number>();
  private pending: BehaviourEvent[] = [];

  constructor(opts: BehaviourOptions = {}) {
    this.profile = { ...LAZY, ...opts.profile };
    this.reducedMotion = !!opts.reducedMotion;
    const s = this.sampleNow();
    this.snap = { pose: s.pose, stretch: s.stretch, breathAmp: s.breathAmp, breathHz: s.breathHz, gaze: s.gaze };
    this.last = { state: 'rest', pose: s.pose, gaze: s.gaze, eyes: 0, zs: 0, stretch: 0, breath: 0, blend: 1, gesture: null, events: [] };
  }

  get state(): StateName {
    return this.cur;
  }
  get timeInState(): number {
    return this.t;
  }
  get isOneShot(): boolean {
    return STATES[this.cur].oneShot;
  }
  /** What is waiting (a request made while a one-shot could not be interrupted). */
  get queued(): StateName | null {
    return this.queue?.to ?? null;
  }
  get frame(): Frame {
    return this.last;
  }

  /** Where her finger is, in the head's frame, -1..1 (x right, y up); null when there is no pointer. */
  setPointer(x: number | null, y = 0): void {
    if (x === null || !finite(x) || !finite(y)) {
      this.pointer = null;
      return;
    }
    this.pointer = [clamp(x, -1, 1), clamp(y, -1, 1)];
    if (this.cur === 'findFinger') this.holdUntil = this.t + STATES.findFinger.hold; // still being followed: keep looking
  }

  /**
   * Ask for a posture. Legal ones start now (or when a one-shot reaches its free point); sleeping Chamgadad wakes first and then goes
   * where asked; a request for the state it is already in does nothing. `side` picks the side of a curious lean, `hold` how long a
   * posture lasts before it relaxes to rest.
   */
  request(to: StateName, opts: { side?: -1 | 1; hold?: number } = {}): RequestResult {
    if (!(to in STATES)) return 'refused';
    if (this.reducedMotion && STATES[to].reducedAs) to = STATES[to].reducedAs!;
    if (to === this.cur && !this.queue) return 'same';
    const def = STATES[this.cur];
    const free = !def.oneShot || this.t >= def.free;
    if (!free) {
      // the latest request wins; a one-shot finishes its main motion first
      this.queue = { to, ...opts };
      return 'queued';
    }
    this.queue = null;
    if (to === this.cur) return 'same';
    if (this.reducedMotion && this.cur === 'sleep' && (to === 'rest' || to === 'wake')) {
      // reduced motion: no unroll and stretch, a slow plain blend from the curl to the rest pose
      this.go('rest', opts);
      return 'started';
    }
    if (to === 'wake') {
      if (this.cur !== 'sleep') return 'refused';
      this.go('wake', opts);
      return 'started';
    }
    if (canTransition(this.cur, to)) {
      this.go(to, opts);
      return 'started';
    }
    const path = routePath(this.cur, to);
    if (path.length === 0) return 'refused';
    this.route = path.slice(1);
    this.queue = null;
    this.routeOpts = opts;
    this.go(path[0]!, path.length === 1 ? opts : {});
    return path.length === 1 ? 'started' : 'routed';
  }
  private routeOpts: { side?: -1 | 1; hold?: number } = {};

  /** A face gesture. Refused while asleep or waking, or while one is running or cooling down. Returns whether it started. */
  gesture(name: GestureName): boolean {
    if (this.cur === 'sleep' || this.cur === 'wake') return false;
    if (this.cooldown[name] > 0) return false;
    if (name === 'slowBlink') {
      if (this.gestureName === 'slowBlink') return false;
      this.gestureName = 'slowBlink';
      this.gestureT = 0;
    } else {
      this.pending.push({ type: 'earFlick', which: 'both', strength: 0.9 });
    }
    this.cooldown[name] = this.profile.gestureCooldown;
    return true;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  private go(to: StateName, opts: { side?: -1 | 1; hold?: number }): void {
    const from = this.cur;
    const def = STATES[to];
    this.snap = { pose: this.last.pose, stretch: this.last.stretch, breathAmp: this.lastAmp, breathHz: this.lastHz, gaze: this.last.gaze };
    // a one-shot started from a posture returns to that posture (a sleeping one wakes into rest instead)
    if (def.oneShot) this.resume = to === 'wake' ? 'rest' : from === 'sleep' || STATES[from].oneShot ? 'rest' : from;
    this.cur = to;
    this.t = 0;
    this.fired.clear();
    this.blendT = 0;
    // lazy: the further the body has to travel, the longer it takes (about 0.6 s per radian), so a hop asked for with the arms still
    // stretched up gives the arms time to come down instead of snapping
    const slow = this.profile.blendScale * (this.reducedMotion ? REDUCED.blendScale : 1);
    const travel = poseDistance(this.snap.pose, def.sample(0, { pointer: this.pointerS, side: this.side }).pose);
    this.blendDur = Math.max(0.01, def.blendIn * slow, Math.min(MAX_TRAVEL_BLEND, travel * SECONDS_PER_RADIAN) * slow);
    this.holdUntil = opts.hold ?? def.hold;
    if (opts.side) this.side = opts.side;
    this.pending.push({ type: 'state', from, to });
  }
  private lastAmp = 1;
  private lastHz = 0.22;

  private sampleNow(): Sample {
    const def = STATES[this.cur];
    const ctx: Ctx = { pointer: this.pointerS, side: this.side };
    let s = def.sample(def.oneShot ? Math.min(this.t, def.duration) : this.t, ctx);
    if (this.reducedMotion && def.scalable) {
      s = {
        ...s,
        pose: blendPose(def.base, s.pose, REDUCED.amount),
        stretch: s.stretch * REDUCED.amount,
        gaze: [s.gaze[0] * 0.6, s.gaze[1] * 0.6],
        breathAmp: s.breathAmp * REDUCED.breath,
      };
    }
    return s;
  }

  /** Advance by dt seconds and return what to show. */
  update(dt: number): Frame {
    const p = this.profile;
    const step = finite(dt) && dt > 0 ? Math.min(dt, p.maxDt) : 0;
    if (step > 0) this.advance(step);
    const s = this.sampleNow();
    const k = this.blendT >= this.blendDur ? 1 : smoother(this.blendT / this.blendDur);
    const pose = k >= 1 ? s.pose : blendPose(this.snap.pose, s.pose, k);
    const lerp = (a: number, b: number): number => a + (b - a) * k;
    const stretch = lerp(this.snap.stretch, s.stretch);
    const amp = lerp(this.snap.breathAmp, s.breathAmp);
    const hz = lerp(this.snap.breathHz, s.breathHz);
    this.lastAmp = amp;
    this.lastHz = hz;
    if (step > 0) {
      this.phase = (this.phase + hz * step) % 1;
      const ke = 1 - Math.pow(0.5, step / p.eyesHalfLife);
      const kz = 1 - Math.pow(0.5, step / p.zsHalfLife);
      this.eyes += (s.eyes - this.eyes) * ke;
      this.zs += (s.zs - this.zs) * kz;
    }
    let eyes = this.eyes;
    if (this.gestureName === 'slowBlink') eyes = Math.max(eyes, this.slowBlinkAt(this.gestureT));
    const gaze: readonly [number, number] = [lerp(this.snap.gaze[0], s.gaze[0]), lerp(this.snap.gaze[1], s.gaze[1])];
    const events = this.pending;
    this.pending = [];
    this.last = {
      state: this.cur,
      pose,
      gaze,
      eyes: eyes < 0.002 ? 0 : eyes,
      zs: this.zs < 0.002 ? 0 : this.zs,
      stretch,
      breath: Math.sin(this.phase * 2 * Math.PI) * amp,
      blend: k,
      gesture: this.gestureName,
      events,
    };
    return this.last;
  }

  private slowBlinkAt(t: number): number {
    const { close, hold, open } = this.profile.slowBlink;
    if (t <= 0) return 0;
    if (t < close) return smoother(t / close);
    if (t < close + hold) return 1;
    if (t < close + hold + open) return 1 - smoother((t - close - hold) / open);
    return 0;
  }

  private advance(dt: number): void {
    this.t += dt;
    this.blendT += dt;
    for (const g of ['slowBlink', 'earFlick'] as const) this.cooldown[g] = Math.max(0, this.cooldown[g] - dt);
    if (this.gestureName === 'slowBlink') {
      this.gestureT += dt;
      const { close, hold, open } = this.profile.slowBlink;
      if (this.gestureT >= close + hold + open) this.gestureName = null;
    }
    // the pointer: her finger moves, the head follows a little behind the eyes
    const target: [number, number] = this.pointer ?? [0, 0];
    const kp = 1 - Math.pow(0.5, dt / this.profile.pointerHalfLife);
    const lost = this.pointer === null && this.cur === 'findFinger';
    if (!lost) {
      this.pointerS[0] += (target[0] - this.pointerS[0]) * kp;
      this.pointerS[1] += (target[1] - this.pointerS[1]) * kp;
    }
    const def = STATES[this.cur];
    // time-keyed events inside a one-shot (the ear flicks of the hop)
    if (this.cur === 'hop' && !this.reducedMotion) {
      HOP_EVENTS.forEach((e, i) => {
        if (this.t >= e.at && !this.fired.has(i)) {
          this.fired.add(i);
          this.pending.push({ type: 'earFlick', which: e.which, strength: e.strength });
        }
      });
    }
    // a waiting request goes when the one-shot reaches its free point
    if (this.queue && (!def.oneShot || this.t >= def.free)) {
      const q = this.queue;
      this.queue = null;
      this.request(q.to, q);
      return;
    }
    if (def.oneShot) {
      if (this.t >= def.duration) {
        const next = this.route.shift() ?? this.resume;
        this.go(next, this.route.length === 0 ? this.routeOpts : {});
        if (this.route.length === 0) this.routeOpts = {};
      }
      return;
    }
    // a route in progress: a base state reached on the way (rest after a wake) goes on at once
    if (this.route.length) {
      const next = this.route.shift()!;
      this.go(next, this.route.length === 0 ? this.routeOpts : {});
      return;
    }
    if (this.holdUntil !== Infinity && this.t >= this.holdUntil) {
      this.go('rest', {});
    }
  }
}

export const REST_POSE: Pose = SIT;
