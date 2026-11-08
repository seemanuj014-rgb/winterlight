// Phase 19: the maths of Act 1 (the sleepy nook) and Act 2 (the door). Pure: no three, no DOM, no clock, no random, so it is unit-tested.
// Two small machines. They are fed what the viewer is doing (pressed / holding / taps), the seconds that passed and what the camera is playing, and they say what the
// world should do (which shot, which Chamgadad state, how bright the lamp, where she stands, how far the door is open, what words show). They touch nothing themselves.
//
// Act 1: Chamgadad asleep. A HOLD (or a few TAPS, or Enter / Space through the keyboard) raises the light; when it is full she wakes, stretches, and her eyes find the finger.
//   "Let her sleep": if nobody touches the screen for a while the sleep deepens (the lamp sinks, the camera drifts in) and the owner's line appears.
// Act 2: she waves you along, hops across the room to the door, opens it, the camera is pushed out into the snow.
// Nothing can be failed and nothing is timed against her: waiting only makes the sleep deeper, and every hold or tap path ends in the same wake.
// `[A]`: every number below is a first guess, tuned by eye in the `?acts` view.

import { HOP_AIR_END, HOP_AIR_START, STATES, type StateName } from '../character/chamgadad/states';
import type { HapticName } from '../input/hapticsMath';
import { NOOK } from '../world/cabinMath';
import type { ShotName } from '../world/shots';
import { REDUCED_SLOWDOWN } from '../core/directorMath';

export type V3 = readonly [number, number, number];

export const clamp01 = (x: number): number => (Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0);
export const smoothstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const finiteOr = (x: number, d: number): number => (Number.isFinite(x) ? x : d);
/** Turn from angle a toward b by the shortest way (radians), a fraction k of the way. */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}
/** A follower: moves `cur` toward `target` with this half-life (seconds); frame-rate independent. */
export function follow(cur: number, target: number, halfLife: number, dt: number): number {
  if (!(dt > 0)) return cur;
  const k = 1 - Math.pow(0.5, dt / Math.max(1e-6, halfLife));
  return cur + (target - cur) * k;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------
export const ACT1 = {
  /** seconds of nobody touching before the small hint ("hold to wake Chamgadad") fades in */
  hintAfter: 3,
  /** a full hold, in seconds (progress 0 -> 1) */
  holdSeconds: 3,
  /** pressing but not yet a hold (the first 500 ms): the light starts to rise at this share of the full rate */
  pressShare: 0.3,
  /** each tap adds this much (about six taps wake her; the tap path for anyone who cannot hold) */
  tapGain: 0.17,
  /** after letting go, the light waits this long and then sinks back at this rate per second (she does not snap back to sleep) */
  sinkDelay: 1.2,
  sinkRate: 0.18,
  /** nobody has touched the screen for this long: the sleep deepens */
  sleepAfter: 20,
  /** the sleep takes this long to deepen, and the line appears when it is this deep */
  deepenSeconds: 7,
  lineAtDeep: 0.55,
  /** how quickly the line and the hint fade (half-lives, seconds) */
  fadeHalfLife: 0.45,
  /** the lamp's resting level, and how far a deep sleep lowers it */
  lampRest: 0.55,
  lampDeepDrop: 0.17,
  /** the wake itself: Chamgadad's `wake` state takes this long, then she rests a moment */
  wakeSeconds: STATES.wake.duration + 0.5,
  /** her eyes follow the finger for this long before she waves you along */
  noticeSeconds: 5,
} as const;

export const ACT2 = {
  /** a hop (the behaviour's `hop` state) takes 2.6 s; the next is asked for just after */
  hopPeriod: STATES.hop.duration + 0.1,
  /** the longest one hop may travel (m); the path is cut into equal hops no longer than this */
  maxHop: 1.25,
  /** her turn toward where she is going (half-life, seconds) */
  turnHalfLife: 0.28,
  /** the cat wakes this long after she sets off */
  catWakeAt: 0.8,
  /** at the door: a pause, the door swings open over this long, a pause again */
  doorPauseBefore: 0.9,
  doorOpenSeconds: 2.0,
  doorPauseAfter: 1.5,
  /** the first shot out in the snow: stay on the stage this long (after its wave starts) before the act is done */
  outsideHold: 3,
  // Reduced motion: no hops, a slow glide instead, and every time here (the walk, the door) is stretched by the camera's own `REDUCED_SLOWDOWN`, so she and
  // the camera stay together. (First written as a 5 s glide with the door untouched: in the browser the slower camera had not reached the door when she had, and
  // she was out of frame.)
} as const;

// ---------------------------------------------------------------------------
// Words (the owner's, from content/nook.json; the hint is the storyboard's own phrase)
// ---------------------------------------------------------------------------
export const HINT_TEXT = 'hold to wake Chamgadad';
export const SLEEP_LINE_MAX = 200;
export const SLEEP_SECRET_ID = 'let-her-sleep';

/** `content/nook.json` -> the line, or null when it is missing, a placeholder, not a string or too long. The words themselves are never changed. */
export function parseNookLine(raw: string): string | null {
  try {
    const o: unknown = JSON.parse(raw);
    if (typeof o !== 'object' || o === null) return null;
    const v = (o as Record<string, unknown>).sleep_line;
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (t === '' || t === 'TODO_OWNER' || t.length > SLEEP_LINE_MAX) return null;
    return v;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// A scripted viewer (test only: `&hold=3-7,20-21&tap=9,10&pointer=0.4,0.2`), so a frame sequence is repeatable
// ---------------------------------------------------------------------------
export interface Script {
  holds: [number, number][];
  taps: number[];
  pointer: [number, number] | null;
}
export function parseScript(search: URLSearchParams): Script {
  const holds: [number, number][] = [];
  for (const part of (search.get('hold') ?? '').split(',')) {
    const [a, b] = part.split('-').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && b! > a!) holds.push([a!, b!]);
  }
  const taps = (search.get('tap') ?? '').split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  const pt = (search.get('pointer') ?? '').split(',').map(Number);
  const pointer: [number, number] | null = pt.length === 2 && pt.every(Number.isFinite) ? [Math.max(-1, Math.min(1, pt[0]!)), Math.max(-1, Math.min(1, pt[1]!))] : null;
  return { holds, taps, pointer };
}
/** What a scripted viewer is doing in the step from `prevT` to `t`. A hold counts as a hold 0.5 s after it begins, like the real classifier. */
export function scriptAt(s: Script, prevT: number, t: number): { pressed: boolean; holding: boolean; taps: number } {
  let pressed = false;
  let holding = false;
  for (const [a, b] of s.holds) {
    if (t > a && prevT <= b) {
      pressed = true;
      if (t - a >= 0.5) holding = true;
    }
  }
  // each tap falls in exactly one step: the span is (prevT, t], and the next step starts from this one's t, so nothing is counted twice or missed
  const taps = s.taps.filter((x) => x > prevT && x <= t).length;
  return { pressed, holding, taps };
}

// ---------------------------------------------------------------------------
// The log: every transition, so a run can be read afterwards
// ---------------------------------------------------------------------------
/** a run's log never grows past this (a viewer who fidgets for an hour must not grow memory) */
export const LOG_MAX = 400;

export interface LogEntry {
  /** seconds since the machine started */
  t: number;
  what: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Act 1
// ---------------------------------------------------------------------------
export type Act1Phase = 'asleep' | 'waking' | 'noticing' | 'beckoning' | 'done';

export interface Act1In {
  /** a finger (or the mouse, or a key) is down */
  pressed: boolean;
  /** it has been down long enough to be a hold */
  holding: boolean;
  /** taps since the last step */
  taps: number;
}

export interface Act1Out {
  phase: Act1Phase;
  /** 0..1, how far the hold has got (what the viewer's hand has done) */
  progress: number;
  /** 0..1 the lamp dial for `nook.setLamp` (0.55 is the resting low lamp) */
  lamp: number;
  /** 0..1 how visible the hint and the line are */
  hint: number;
  line: number;
  /** 0..1 how deep the sleep is */
  deep: number;
  /** a shot to start now (once), or null */
  shot: ShotName | null;
  /** a Chamgadad state to ask for now (once), or null */
  chamgadad: StateName | null;
  haptic: HapticName | null;
  /** the secret id the moment it is found, once per run */
  secret: string | null;
  /** her eyes should follow the finger */
  tracking: boolean;
  /** she can be picked and held (the keyboard's ring shows) */
  holdable: boolean;
  /** true on the one step the act ends */
  done: boolean;
}

export class Act1Machine {
  phase: Act1Phase = 'asleep';
  progress = 0;
  private t = 0;
  private idle = 0;
  private sinceRelease = Infinity;
  private shown = 0; // the light the viewer sees (follows progress, so a tap is a swell, not a step)
  private hint = 0;
  private line = 0;
  private deep = 0;
  private deepStarted = false;
  private secretFound = false;
  private phaseT = 0;
  private started = false;
  private wasHolding = false;
  private wasPressed = false;
  readonly log: LogEntry[] = [];
  /** the owner's line, or null: without it the secret still happens (the lamp and the camera), just without words */
  constructor(private readonly hasLine: boolean = true) {}

  private note(what: string, extra: Record<string, unknown> = {}): void {
    if (this.log.length < LOG_MAX) this.log.push({ t: Number(this.t.toFixed(3)), what, ...extra });
  }

  update(dt: number, inp: Act1In): Act1Out {
    const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    this.t += d;
    this.phaseT += d;
    let shot: ShotName | null = null;
    let chamgadad: StateName | null = null;
    let haptic: HapticName | null = null;
    let secret: string | null = null;
    let done = false;
    if (!this.started) {
      this.started = true;
      shot = 'nookWide';
      this.note('start', { shot });
    }

    if (this.phase === 'asleep') {
      const pressed = !!inp.pressed;
      const holding = pressed && !!inp.holding;
      const taps = Math.max(0, Math.min(10, Math.floor(finiteOr(inp.taps, 0))));
      const touched = pressed || taps > 0;
      if (touched) {
        if (!this.wasPressed && pressed) this.note('press', { progress: Number(this.progress.toFixed(3)) });
        this.idle = 0;
        this.sinceRelease = 0;
        if (this.deepStarted) {
          this.deepStarted = false;
          this.note('stirred', { deep: Number(this.deep.toFixed(2)) });
        }
      } else {
        this.idle += d;
        this.sinceRelease += d;
      }
      if (this.wasPressed && !pressed) this.note('release', { progress: Number(this.progress.toFixed(3)) });
      this.wasPressed = pressed;

      const rate = 1 / ACT1.holdSeconds;
      if (holding) this.progress += rate * d;
      else if (pressed) this.progress += rate * ACT1.pressShare * d;
      if (taps > 0) {
        this.progress += ACT1.tapGain * taps;
        this.note('tap', { taps, progress: Number(clamp01(this.progress).toFixed(3)) });
        haptic = 'tap';
      }
      if (!pressed && this.sinceRelease > ACT1.sinkDelay) this.progress = Math.max(0, this.progress - ACT1.sinkRate * d);
      this.progress = clamp01(this.progress);
      if (holding && !this.wasHolding) haptic = haptic ?? 'press';
      this.wasHolding = holding;

      // the secret: nobody has touched the screen for a long while, so the sleep deepens
      const wantDeep = this.progress === 0 && this.idle >= ACT1.sleepAfter;
      if (wantDeep && !this.deepStarted) {
        this.deepStarted = true;
        shot = 'nookSleep';
        this.note('deepen', { idle: Number(this.idle.toFixed(1)) });
      }
      this.deep = clamp01(this.deep + ((wantDeep ? 1 : -2) * d) / ACT1.deepenSeconds);
      const lineWanted = this.hasLine && this.deep >= ACT1.lineAtDeep && this.progress === 0;
      if (this.deep >= ACT1.lineAtDeep && !this.secretFound) {
        this.secretFound = true;
        secret = SLEEP_SECRET_ID;
        this.note('secret', { id: SLEEP_SECRET_ID, line: this.hasLine });
      }
      this.line = follow(this.line, lineWanted ? 1 : 0, ACT1.fadeHalfLife, d);
      const hintWanted = this.idle >= ACT1.hintAfter && this.progress < 0.25;
      this.hint = follow(this.hint, hintWanted ? 1 : 0, ACT1.fadeHalfLife, d);
      this.shown = follow(this.shown, this.progress, 0.35, d);

      if (this.progress >= 1) {
        this.phase = 'waking';
        this.phaseT = 0;
        this.shown = 1;
        shot = 'nookBed';
        chamgadad = 'wake';
        haptic = 'wake';
        this.note('wake', { after: Number(this.t.toFixed(2)), deep: Number(this.deep.toFixed(2)) });
      }
    } else {
      // after the wake the light stays high and the words go
      this.shown = follow(this.shown, 1, 0.35, d);
      this.hint = follow(this.hint, 0, ACT1.fadeHalfLife, d);
      this.line = follow(this.line, 0, ACT1.fadeHalfLife, d);
      this.deep = clamp01(this.deep - d / 1.5);
      if (this.phase === 'waking' && this.phaseT >= ACT1.wakeSeconds) {
        this.phase = 'noticing';
        this.phaseT = 0;
        chamgadad = 'findFinger';
        this.note('noticing');
      } else if (this.phase === 'noticing' && this.phaseT >= ACT1.noticeSeconds) {
        this.phase = 'beckoning';
        this.phaseT = 0;
        chamgadad = 'wave';
        this.note('beckoning');
      } else if (this.phase === 'beckoning' && this.phaseT >= STATES.wave.duration) {
        this.phase = 'done';
        this.phaseT = 0;
        done = true;
        this.note('done');
      }
    }
    const lamp = clamp01(ACT1.lampRest + (1 - ACT1.lampRest) * this.shown - ACT1.lampDeepDrop * this.deep);
    return {
      phase: this.phase,
      progress: this.progress,
      lamp,
      hint: this.hint < 0.01 ? 0 : this.hint,
      line: this.line < 0.01 ? 0 : this.line,
      deep: this.deep,
      shot,
      chamgadad,
      haptic,
      secret,
      tracking: this.phase === 'noticing' || this.phase === 'beckoning' || this.phase === 'done',
      holdable: this.phase === 'asleep',
      done,
    };
  }
  get elapsed(): number {
    return this.t;
  }
  get secretSeen(): boolean {
    return this.secretFound;
  }
}

// ---------------------------------------------------------------------------
// Act 2: the walk
// ---------------------------------------------------------------------------
/** Where she stands to open the door, in the nook's own frame (the door is in the right wall; she faces +x). */
export const DOOR_SPOT: V3 = [NOOK.hx - 0.8, 0, NOOK.doorZ + 0.5];
/** The way from the bed to the door, in the nook's own frame: [x, ground y, z]. The first point is where she sleeps (the top of the blanket). */
export const WALK_POINTS: readonly V3[] = [
  [NOOK.sleepSpot[0], NOOK.bed.top + 0.1, NOOK.sleepSpot[2]],
  [-0.95, 0, -0.05], // off the bed's front edge, onto the floor
  [0.45, 0, 0.4], // across the rug
  DOOR_SPOT,
];

export interface Hop {
  from: V3;
  to: V3;
  /** the direction of travel, radians about the vertical, 0 = +z (the holder's own convention) */
  yaw: number;
}

/** Cut a polyline into equal hops no longer than `maxHop`. The ground height follows the polyline (so the first hop steps down off the bed). */
export function planWalk(points: readonly V3[] = WALK_POINTS, maxHop: number = ACT2.maxHop): Hop[] {
  if (points.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![2] - points[i - 1]![2]));
  const total = cum[cum.length - 1]!;
  if (!(total > 1e-6)) return [];
  const n = Math.max(1, Math.ceil(total / Math.max(0.05, maxHop)));
  const at = (s: number): V3 => {
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < s) i++;
    const span = cum[i]! - cum[i - 1]!;
    const k = span <= 1e-9 ? 0 : clamp01((s - cum[i - 1]!) / span);
    const a = points[i - 1]!;
    const b = points[i]!;
    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  };
  const hops: Hop[] = [];
  for (let h = 0; h < n; h++) {
    const from = at((total * h) / n);
    const to = at((total * (h + 1)) / n);
    hops.push({ from, to, yaw: Math.atan2(to[0] - from[0], to[2] - from[2]) });
  }
  return hops;
}

/** How far through its hop she has travelled, 0..1, `t` seconds after the hop was asked for: nothing while she crouches, a smooth slide while she is in the air, nothing after. */
export function hopTravel(t: number): number {
  return smoothstep((finiteOr(t, 0) - HOP_AIR_START) / (HOP_AIR_END - HOP_AIR_START));
}

export type Act2Phase = 'walking' | 'opening' | 'pushOut' | 'outside' | 'done';

export interface Act2In {
  /** which shot the camera is playing and how far into it (seconds), for knowing when the stage shot has settled */
  shot: string | null;
  shotElapsed: number;
}

export interface Act2Out {
  phase: Act2Phase;
  shot: ShotName | null;
  /** with `shot`: cut to it (true), or move there from where the camera is (false) */
  cut: boolean;
  /** shots to queue after it */
  then: readonly ShotName[];
  chamgadad: StateName | null;
  /** with `chamgadad: 'curiousLean'` */
  lean: -1 | 1 | null;
  cat: 'wake' | null;
  /** where she stands in the NOOK's own frame and which way she faces (only while the camera is in the nook) */
  spot: { x: number; y: number; z: number; yaw: number } | null;
  /** 0..1 the nook door */
  nookDoor: number;
  haptic: HapticName | null;
  /** the act is entering Act 2 now (once) */
  enter: boolean;
  done: boolean;
}

export class Act2Machine {
  phase: Act2Phase = 'walking';
  readonly hops: Hop[];
  readonly log: LogEntry[] = [];
  private t = 0;
  private phaseT = 0;
  private started = false;
  private nextHop = 0;
  private yaw: number;
  private pos: V3;
  private catWoken = false;
  private door = 0;
  private leaned = false;
  private stageShotSeen = 0;
  private pendingShot: ShotName | null = null;

  constructor(
    private readonly opts: { reduced?: boolean; startYaw?: number; points?: readonly V3[] } = {},
  ) {
    this.hops = planWalk(opts.points ?? WALK_POINTS);
    this.pos = (opts.points ?? WALK_POINTS)[0]!;
    this.yaw = finiteOr(opts.startYaw ?? 0, 0);
  }

  private note(what: string, extra: Record<string, unknown> = {}): void {
    if (this.log.length < LOG_MAX) this.log.push({ t: Number(this.t.toFixed(3)), what, ...extra });
  }

  /** 1, or the camera's slowdown under reduced motion */
  private get slow(): number {
    return this.opts.reduced ? REDUCED_SLOWDOWN : 1;
  }

  /** the whole walk takes this long (s) */
  get walkSeconds(): number {
    return this.hops.length * ACT2.hopPeriod * this.slow;
  }

  update(dt: number, inp: Act2In): Act2Out {
    const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    this.t += d;
    this.phaseT += d;
    let shot: ShotName | null = null;
    let cut = false;
    let then: readonly ShotName[] = [];
    let chamgadad: StateName | null = null;
    let lean: -1 | 1 | null = null;
    let cat: 'wake' | null = null;
    let haptic: HapticName | null = null;
    let enter = false;
    let done = false;
    let spotOut = false;

    if (!this.started) {
      this.started = true;
      enter = true;
      shot = 'nookWalk';
      this.note('start', { hops: this.hops.length, reduced: !!this.opts.reduced });
    }

    if (this.phase === 'walking') {
      spotOut = true;
      const tw = this.phaseT;
      if (!this.catWoken && tw >= ACT2.catWakeAt) {
        this.catWoken = true;
        cat = 'wake';
        this.note('catWakes');
      }
      if (this.opts.reduced) {
        // no hops: she glides slowly (a quiet lean, not a bounce) and everything else is as it was
        if (this.nextHop === 0) {
          this.nextHop = 1;
          chamgadad = 'curiousLean';
          lean = 1;
        }
        const u = smoothstep(tw / this.walkSeconds);
        this.placeAlong(u);
        this.faceToward(this.hops[Math.min(this.hops.length - 1, Math.floor(u * this.hops.length))]!.yaw, d);
        if (tw >= this.walkSeconds) this.toOpening();
      } else {
        const k = Math.min(this.hops.length - 1, Math.floor(tw / ACT2.hopPeriod));
        if (this.nextHop <= k && this.nextHop < this.hops.length) {
          chamgadad = 'hop';
          haptic = 'tick';
          this.note('hop', { n: this.nextHop + 1, of: this.hops.length });
          this.nextHop++;
        }
        const hop = this.hops[k]!;
        const local = tw - k * ACT2.hopPeriod;
        const u = hopTravel(local);
        this.pos = [lerp(hop.from[0], hop.to[0], u), lerp(hop.from[1], hop.to[1], u), lerp(hop.from[2], hop.to[2], u)];
        // she turns toward where she is going as she crouches (before the spring), and stays turned between hops
        this.faceToward(hop.yaw, d);
        if (tw >= this.walkSeconds) this.toOpening();
      }
    } else if (this.phase === 'opening') {
      spotOut = true;
      this.pos = DOOR_SPOT;
      this.faceToward(Math.PI / 2, d); // toward +x, the door
      if (!this.leaned) {
        this.leaned = true;
        chamgadad = 'curiousLean';
        lean = 1;
      }
      const slow = this.slow;
      const u = (this.phaseT - ACT2.doorPauseBefore * slow) / (ACT2.doorOpenSeconds * slow);
      const next = smoothstep(u);
      if (this.door === 0 && next > 0) this.note('doorOpens');
      this.door = next;
      if (this.phaseT >= (ACT2.doorPauseBefore + ACT2.doorOpenSeconds + ACT2.doorPauseAfter) * slow) {
        this.phase = 'pushOut';
        this.phaseT = 0;
        shot = 'doorOut';
        cut = true;
        then = ['snowWalk', 'stage'];
        chamgadad = 'rest';
        haptic = 'soft';
        this.note('pushOut');
      }
    } else if (this.phase === 'pushOut') {
      // the camera is out in the cabin's doorway; the nook is hidden. The first shot is playing, the next two queue behind it.
      if (inp.shot === 'stage') {
        this.phase = 'outside';
        this.phaseT = 0;
        this.note('outside');
      }
    } else if (this.phase === 'outside') {
      if (inp.shot === 'stage') this.stageShotSeen = Math.max(this.stageShotSeen, finiteOr(inp.shotElapsed, 0));
      if (this.stageShotSeen >= ACT2.outsideHold) {
        this.phase = 'done';
        done = true;
        this.note('done');
      }
    }

    if (this.pendingShot && !shot) {
      shot = this.pendingShot;
      this.pendingShot = null;
    }
    return {
      phase: this.phase,
      shot,
      cut,
      then,
      chamgadad,
      lean,
      cat,
      spot: spotOut ? { x: this.pos[0], y: this.pos[1], z: this.pos[2], yaw: this.yaw } : null,
      nookDoor: this.door,
      haptic,
      enter,
      done,
    };
  }

  private toOpening(): void {
    this.phase = 'opening';
    this.phaseT = 0;
    this.pos = DOOR_SPOT;
    this.pendingShot = 'nookAtDoor';
    this.note('atDoor');
  }
  private placeAlong(u: number): void {
    const n = this.hops.length;
    const f = clamp01(u) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    const h = this.hops[i]!;
    this.pos = [lerp(h.from[0], h.to[0], k), lerp(h.from[1], h.to[1], k), lerp(h.from[2], h.to[2], k)];
  }
  private faceToward(yaw: number, d: number): void {
    this.yaw = lerpAngle(this.yaw, yaw, 1 - Math.pow(0.5, d / ACT2.turnHalfLife));
  }
}
