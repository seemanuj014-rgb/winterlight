// Phase 17: the camera director's maths. Pure: no three, no DOM, no clock, no random, so it is unit-tested.
// A SHOT is data: a spline for the eye, a spline for what it looks at, a field of view, a length in seconds and an ease.
// The DIRECTOR plays one shot at a time and never lets the picture pop:
//   - play(shot) starts from what is on screen (a decaying offset from the shot's own first frame), so a request at any moment is smooth;
//   - a very far jump (the nook is 50 m above the snow) is a CUT, flagged on the frame, never a 50 m dolly through nothing;
//   - when a shot ends the camera HOLDS its last frame, with the handheld drift still breathing;
//   - the handheld drift is a few slow sines (continuous in time, so it never pops and never sums to a shake); exactly 0 under reduced motion.
// Reduced motion (part of the machine, not an afterthought): no handheld, no zoom (the field of view stays put), moves 1.6 times slower.
// `[A]`: every number below is a first guess, tuned by eye in the `?tour` view.

export type V3 = [number, number, number];

export const MAX_DT = 0.1;
export const CUT_DISTANCE = 15; // metres: a jump longer than this is a cut
export const REDUCED_SLOWDOWN = 1.6;
export const MIN_SHOT_SECONDS = 0.5;
/** Aspect the shots' field of view is written for. Narrower than this (a tall phone) widens the vertical field so the same width stays in frame. */
export const REF_ASPECT = 0.95;
export const MAX_FOV_DEG = 72;

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const clamp01 = (x: number): number => (Number.isFinite(x) ? clamp(x, 0, 1) : 0);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smootherstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  len: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  lerp: (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
};
export const vec = v3;
export const finiteV3 = (a: V3): boolean => a.every(Number.isFinite);

// ---------------------------------------------------------------------------
// Paths: a Catmull-Rom spline through the points, walked at an even speed (arc length), so the ease alone sets how fast the camera goes.
// ---------------------------------------------------------------------------
export interface Path {
  readonly length: number;
  /** u in 0..1 by distance along the path */
  at(u: number): V3;
}

const SAMPLES_PER_SEGMENT = 24;

function catmull(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * (2 * p1[i]! + (-p0[i]! + p2[i]!) * t + (2 * p0[i]! - 5 * p1[i]! + 4 * p2[i]! - p3[i]!) * t2 + (-p0[i]! + 3 * p1[i]! - 3 * p2[i]! + p3[i]!) * t3);
  }
  return out;
}

export function makePath(points: readonly V3[]): Path {
  if (points.length === 0) throw new Error('a path needs at least one point');
  for (const p of points) if (!finiteV3(p)) throw new Error('a path point is not finite');
  if (points.length === 1) {
    const only = points[0]!;
    return { length: 0, at: () => [only[0], only[1], only[2]] };
  }
  const n = points.length;
  const pt = (i: number): V3 => points[clamp(i, 0, n - 1)]!;
  // ends: mirror the neighbour so the curve leaves the first point and arrives at the last one without a kink
  const ghostStart = v3.sub(v3.scale(pt(0), 2), pt(1));
  const ghostEnd = v3.sub(v3.scale(pt(n - 1), 2), pt(n - 2));
  const P = (i: number): V3 => (i < 0 ? ghostStart : i > n - 1 ? ghostEnd : pt(i));
  const segs = n - 1;
  const total = segs * SAMPLES_PER_SEGMENT;
  const pts: V3[] = [];
  for (let i = 0; i <= total; i++) {
    const s = Math.min(segs - 1, Math.floor(i / SAMPLES_PER_SEGMENT));
    const t = i === total ? 1 : (i - s * SAMPLES_PER_SEGMENT) / SAMPLES_PER_SEGMENT;
    pts.push(catmull(P(s - 1), P(s), P(s + 1), P(s + 2), t));
  }
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + v3.len(v3.sub(pts[i]!, pts[i - 1]!)));
  const length = cum[cum.length - 1]!;
  return {
    length,
    at(u: number): V3 {
      if (length <= 1e-9) return [pts[0]![0], pts[0]![1], pts[0]![2]];
      const d = clamp01(u) * length;
      let lo = 0;
      let hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid]! <= d) lo = mid;
        else hi = mid;
      }
      const span = cum[hi]! - cum[lo]!;
      const k = span <= 1e-12 ? 0 : (d - cum[lo]!) / span;
      return v3.lerp(pts[lo]!, pts[hi]!, k);
    },
  };
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------
export type EaseName = 'inOut' | 'in' | 'out' | 'linear';

export interface Shot {
  name: string;
  /** where the camera is: a spline through these (one point = a held position) */
  eye: readonly V3[];
  /** what it looks at: a spline through these */
  look: readonly V3[];
  /** vertical field of view in degrees at `REF_ASPECT`: [start, end] */
  fov: readonly [number, number];
  seconds: number;
  ease?: EaseName;
  /** how much handheld drift, 0..2 (default 1); a walking shot asks for a little more */
  handheld?: number;
  /** seconds the camera stays put after the shot ends before the next queued shot may start (default 0) */
  hold?: number;
  /** named scalars over the shot's own time (0..1): [time, value] keys, smooth between; they stay at the last value afterwards (a door that has opened stays open) */
  channels?: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  /** named moments (time 0..1) the app can react to (Chamgadad waves, the bunny peeks); each fires once per play */
  cues?: readonly { at: number; name: string }[];
}

export function ease(kind: EaseName | undefined, x: number): number {
  const t = clamp01(x);
  switch (kind ?? 'inOut') {
    case 'linear':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - (1 - t) * (1 - t) * (1 - t);
    default:
      return smootherstep(t);
  }
}

/** A channel's value at time u (0..1): flat before the first key and after the last, smootherstep between keys. */
export function channelAt(keys: readonly (readonly [number, number])[], u: number): number {
  if (keys.length === 0) return 0;
  const t = clamp01(u);
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    if (t <= b[0]) return lerp(a[1], b[1], smootherstep((t - a[0]) / Math.max(1e-9, b[0] - a[0])));
  }
  return keys[keys.length - 1]![1];
}

/** The field of view to use, given the width over height of the screen. The shot's number is for REF_ASPECT; a narrower screen widens it (capped). */
export function fovForAspect(fovDeg: number, aspect: number): number {
  const a = Number.isFinite(aspect) && aspect > 0.05 ? aspect : REF_ASPECT;
  if (a >= REF_ASPECT) return fovDeg;
  const half = Math.atan(Math.tan((fovDeg * Math.PI) / 360) * (REF_ASPECT / a));
  return Math.min(MAX_FOV_DEG, (half * 360) / Math.PI);
}

// ---------------------------------------------------------------------------
// Handheld: slow, small, never random. Three sines per channel at frequencies that do not line up, so it never visibly repeats.
// ---------------------------------------------------------------------------
export const HANDHELD = {
  /** metres */
  pos: 0.012,
  /** radians (about 0.1 degree) */
  turn: 0.0018,
  /** radians (about 0.06 degree) */
  roll: 0.001,
  freq: [0.23, 0.37, 0.61] as const,
};

export interface HandheldOut {
  dx: number;
  dy: number;
  dz: number;
  yaw: number;
  pitch: number;
  roll: number;
}

const wave = (t: number, phase: number): number => {
  const f = HANDHELD.freq;
  return (Math.sin(2 * Math.PI * f[0] * t + phase) * 0.55 + Math.sin(2 * Math.PI * f[1] * t + phase * 1.7 + 1.3) * 0.3 + Math.sin(2 * Math.PI * f[2] * t + phase * 2.3 + 2.1) * 0.15);
};

export function handheld(t: number, amount: number): HandheldOut {
  const a = Number.isFinite(amount) ? clamp(amount, 0, 2) : 0;
  const tt = Number.isFinite(t) ? t : 0;
  if (a === 0) return { dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, roll: 0 };
  return {
    dx: wave(tt, 0.4) * HANDHELD.pos * a,
    dy: wave(tt, 1.9) * HANDHELD.pos * 0.7 * a,
    dz: wave(tt, 3.1) * HANDHELD.pos * 0.5 * a,
    yaw: wave(tt, 4.2) * HANDHELD.turn * a,
    pitch: wave(tt, 5.3) * HANDHELD.turn * 0.8 * a,
    roll: wave(tt, 6.4) * HANDHELD.roll * a,
  };
}

/** The angle between two directions, in radians (0 if either has no length). */
export function angleBetween(a: V3, b: V3): number {
  const la = v3.len(a);
  const lb = v3.len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return Math.acos(clamp(c, -1, 1));
}

const unit = (a: V3): V3 => {
  const l = v3.len(a);
  return l < 1e-12 ? [0, 0, -1] : [a[0] / l, a[1] / l, a[2] / l];
};
/** Turn from unit direction a to unit direction b along the great circle, t in 0..1 (the shortest way; an exact reversal turns about the vertical). */
export function slerpUnit(a: V3, b: V3, t: number): V3 {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const th = Math.acos(dot);
  if (th < 1e-6) return unit(v3.lerp(a, b, t));
  if (Math.PI - th < 1e-4) {
    // opposite: any perpendicular will do; turn about the vertical (or about x if a is vertical)
    const axis: V3 = Math.abs(a[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
    const ang = Math.PI * t;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const cr: V3 = [axis[1] * a[2] - axis[2] * a[1], axis[2] * a[0] - axis[0] * a[2], axis[0] * a[1] - axis[1] * a[0]];
    const ad = axis[0] * a[0] + axis[1] * a[1] + axis[2] * a[2];
    return unit([a[0] * c + cr[0] * sn + axis[0] * ad * (1 - c), a[1] * c + cr[1] * sn + axis[1] * ad * (1 - c), a[2] * c + cr[2] * sn + axis[2] * ad * (1 - c)]);
  }
  const sn = Math.sin(th);
  return unit(v3.add(v3.scale(a, Math.sin((1 - t) * th) / sn), v3.scale(b, Math.sin(t * th) / sn)));
}

/** Turn a direction a little: yaw about world up, pitch about the horizontal axis across it. Small angles only. */
export function nudgeDirection(dir: V3, yaw: number, pitch: number): V3 {
  const [x, y, z] = dir;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  let d: V3 = [x * cy + z * sy, y, -x * sy + z * cy];
  const h = Math.hypot(d[0], d[2]);
  if (h > 1e-9) {
    // pitch: rotate in the vertical plane that holds the direction
    const ang = Math.atan2(d[1], h) + pitch;
    const lim = (89 * Math.PI) / 180;
    const a2 = clamp(ang, -lim, lim);
    const len = Math.hypot(d[0], d[1], d[2]);
    const nh = Math.cos(a2) * len;
    d = [(d[0] / h) * nh, Math.sin(a2) * len, (d[2] / h) * nh];
  }
  return d;
}

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------
export interface Frame {
  eye: V3;
  look: V3;
  /** vertical field of view in degrees, at REF_ASPECT (use `fovForAspect` for the screen) */
  fov: number;
  /** radians about the view axis */
  roll: number;
  /** scalar channels, kept at their last value */
  values: Record<string, number>;
  /** cues that fired during this update */
  cues: string[];
  /** true on the frame a play() cut instead of moving */
  cut: boolean;
  shot: string | null;
  /** seconds into the current shot (grows past its length while holding) */
  elapsed: number;
  playing: boolean;
}

interface Pose {
  eye: V3;
  look: V3;
  fov: number;
}

/** What melts away when a shot starts from the picture on screen: the eye and field of view move by an offset, the view direction turns along the great circle. */
interface Blend {
  eye: V3;
  fov: number;
  dir: V3;
  len: number;
}

interface Compiled {
  shot: Shot;
  eye: Path;
  look: Path;
  seconds: number;
}

export interface DirectorOptions {
  reducedMotion?: boolean;
}

export class Director {
  private reduced: boolean;
  private compiled: Compiled | null = null;
  private elapsed = 0;
  private clock = 0;
  private offset: Blend | null = null;
  private blendSec = 1;
  private base: Pose | null = null;
  private queue: Shot[] = [];
  private values: Record<string, number> = {};
  private fired = new Set<string>();
  private pendingCut = false;
  private cache = new Map<Shot, Compiled>();
  private current: Frame;

  constructor(opts: DirectorOptions = {}) {
    this.reduced = !!opts.reducedMotion;
    this.current = { eye: [0, 0, 0], look: [0, 0, -1], fov: 40, roll: 0, values: {}, cues: [], cut: false, shot: null, elapsed: 0, playing: false };
  }

  get frame(): Frame {
    return this.current;
  }
  get playing(): boolean {
    return !!this.compiled && this.elapsed < this.shotSeconds(this.compiled);
  }
  get queued(): number {
    return this.queue.length;
  }
  get reducedMotion(): boolean {
    return this.reduced;
  }
  setReducedMotion(on: boolean): void {
    this.reduced = !!on;
  }

  private compile(shot: Shot): Compiled {
    const hit = this.cache.get(shot);
    if (hit) return hit;
    if (shot.fov.length !== 2 || !shot.fov.every((f) => Number.isFinite(f) && f > 5 && f < 120)) throw new Error(`shot ${shot.name}: bad fov`);
    if (!Number.isFinite(shot.seconds) || shot.seconds <= 0) throw new Error(`shot ${shot.name}: bad length`);
    const c: Compiled = { shot, eye: makePath(shot.eye), look: makePath(shot.look), seconds: Math.max(MIN_SHOT_SECONDS, shot.seconds) };
    this.cache.set(shot, c);
    return c;
  }

  private shotSeconds(c: Compiled): number {
    return c.seconds * (this.reduced ? REDUCED_SLOWDOWN : 1);
  }

  /** the shot's own pose at its time `elapsed` (no offset, no handheld) */
  private pose(c: Compiled, elapsed: number): Pose {
    const u = ease(c.shot.ease, elapsed / this.shotSeconds(c));
    const fovU = this.reduced ? 0 : u; // no zoom under reduced motion
    return { eye: c.eye.at(u), look: c.look.at(u), fov: lerp(c.shot.fov[0], c.shot.fov[1], fovU) };
  }

  /**
   * Play a shot now. It starts from the picture on screen: the difference between that and the shot's first frame melts away over the first part of the shot.
   * `cut: true` (or a first frame, or a jump over CUT_DISTANCE) starts it exactly at its first frame instead. Latest request wins; the queue is dropped.
   */
  play(shot: Shot, opts: { cut?: boolean } = {}): void {
    const c = this.compile(shot);
    this.queue = [];
    this.start(c, !!opts.cut);
  }

  /** Play this shot after the current one has ended and held (a sequence). With nothing playing it starts now. */
  then(shot: Shot): void {
    this.compile(shot);
    if (!this.compiled) this.play(shot);
    else this.queue.push(shot);
  }

  private start(c: Compiled, cutRequested: boolean): void {
    const first = this.pose(c, 0);
    let cut = cutRequested || !this.base;
    this.offset = null;
    if (!cut && this.base) {
      const dirOld = v3.sub(this.base.look, this.base.eye);
      const off: Blend = { eye: v3.sub(this.base.eye, first.eye), fov: this.base.fov - first.fov, dir: unit(dirOld), len: v3.len(dirOld) };
      const dist = v3.len(off.eye);
      if (dist > CUT_DISTANCE) cut = true;
      else {
        this.offset = off;
        // A longer move takes longer, and so does a bigger turn (so the camera never whips round to a new target): about 6.4 degrees a second at the fastest.
        // Never shorter than 0.8 s and never longer than the shot itself.
        const turnDeg = (angleBetween(v3.sub(this.base.look, this.base.eye), v3.sub(first.look, first.eye)) * 180) / Math.PI;
        const sec = this.shotSeconds(c);
        this.blendSec = Math.min(sec, Math.max(0.8 + dist * 0.55, turnDeg * 0.156) * (this.reduced ? REDUCED_SLOWDOWN : 1));
      }
    }
    this.compiled = c;
    this.elapsed = 0;
    this.fired.clear();
    this.pendingCut = cut;
    if (cut) this.base = null;
  }

  /** Advance by dt seconds (a fixed step is fine) and return the frame. Bad dt counts as 0, long frames as MAX_DT. */
  update(dt: number): Frame {
    const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
    this.clock += d;
    const c = this.compiled;
    if (!c) return this.current;
    this.elapsed += d;
    const sec = this.shotSeconds(c);

    // the next queued shot starts when this one has ended and held
    if (this.elapsed >= sec + (c.shot.hold ?? 0) && this.queue.length) {
      const next = this.queue.shift()!;
      this.start(this.compile(next), false);
    }
    const cc = this.compiled!;
    const el = this.elapsed;
    const secNow = this.shotSeconds(cc);
    const p = this.pose(cc, Math.min(el, secNow));
    let eye = p.eye;
    let look = p.look;
    let fov = p.fov;
    if (this.offset) {
      const sBlend = smootherstep(el / this.blendSec);
      if (sBlend >= 1) this.offset = null;
      else {
        const k = 1 - sBlend;
        eye = v3.add(eye, v3.scale(this.offset.eye, k));
        const shotDir = v3.sub(p.look, p.eye);
        const dir = slerpUnit(this.offset.dir, unit(shotDir), sBlend);
        look = v3.add(eye, v3.scale(dir, lerp(this.offset.len, v3.len(shotDir), sBlend)));
        fov += this.offset.fov * k * (this.reduced ? 0 : 1);
        if (this.reduced) fov = p.fov; // no zoom at all
      }
    }
    this.base = { eye, look, fov };

    // channels and cues
    const u = clamp01(el / secNow);
    if (cc.shot.channels) for (const [name, keys] of Object.entries(cc.shot.channels)) this.values[name] = channelAt(keys, u);
    const cues: string[] = [];
    for (const q of cc.shot.cues ?? []) {
      if (u >= q.at && !this.fired.has(q.name + '@' + q.at)) {
        this.fired.add(q.name + '@' + q.at);
        cues.push(q.name);
      }
    }

    // handheld (after the base is stored: the drift is never baked into the next shot's starting point)
    const h = handheld(this.clock, this.reduced ? 0 : cc.shot.handheld ?? 1);
    const eyeOut: V3 = [eye[0] + h.dx, eye[1] + h.dy, eye[2] + h.dz];
    const dir = nudgeDirection(v3.sub(look, eye), h.yaw, h.pitch);
    const lookOut = v3.add(eyeOut, dir);

    const cut = this.pendingCut;
    this.pendingCut = false;
    this.current = { eye: eyeOut, look: lookOut, fov, roll: h.roll, values: { ...this.values }, cues, cut, shot: cc.shot.name, elapsed: el, playing: el < secNow };
    return this.current;
  }
}
