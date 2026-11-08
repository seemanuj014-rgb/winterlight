// Phase 8: secondary motion for the two ears. Pure maths, no three, so it can be tested to death.
//
// Each ear hangs on a pivot (Phase 6: the middle of the ear's base, hidden inside the head) and has four small springs:
//   rz    swing in the drawing's plane (the main follow-through when the head rolls or moves sideways)
//   rx    tip tilting toward / away from the viewer (head nods)
//   ry    tip twisting toward / away from the viewer (head turns)
//   flex  the inner bowl (her fold) turning a little against the back flap, so the fold looks like it bends
// At rest every value is 0, so the ear is exactly where Phase 6 put it and the drawing still matches.
//
// Two modes (the low tier gets the cheap one): 'spring' (above) and 'sway' (a slow sine, no head coupling).
// Everything marked [A] is a tuning guess for the owner to feel, not something read from her drawing.
import type { QualityTier } from '../../core/quality';

export type EarName = 'upright' | 'angled';
export const EAR_NAMES: readonly EarName[] = ['upright', 'angled'];
export type EarMotionMode = 'spring' | 'sway';

// ---------------------------------------------------------------------------------------------------------------------
// One spring, integrated implicitly so it cannot blow up whatever the frame time
// ---------------------------------------------------------------------------------------------------------------------

export interface SpringParams {
  /** Undamped natural frequency in Hz. */
  freq: number;
  /** Damping ratio: 0 never settles, 1 settles without overshoot, below 1 wobbles. */
  damping: number;
}
export interface Spring {
  x: number;
  v: number;
}
export const newSpring = (): Spring => ({ x: 0, v: 0 });

/** Longest single integration step. A longer frame is split into steps of at most this. */
export const MAX_SUBSTEP = 1 / 120;
/** A frame longer than this is treated as this long (a tab that was asleep must not fling the ears). */
export const MAX_DT = 0.1;

/**
 * Advance a spring toward `target` by `dt` seconds. Backward Euler: v' = (v + h w^2 (target - x)) / (1 + 2 z w h + w^2 h^2),
 * x' = x + h v'. For any h >= 0 the new state is no larger than the old one in energy, so there is no step size that explodes.
 * Bad input (NaN, infinity, negative dt) does nothing.
 */
export function stepSpring(s: Spring, target: number, dt: number, p: SpringParams): void {
  if (!(dt > 0) || !Number.isFinite(dt) || !Number.isFinite(target) || !Number.isFinite(s.x) || !Number.isFinite(s.v)) return;
  const total = Math.min(dt, MAX_DT);
  const n = Math.max(1, Math.ceil(total / MAX_SUBSTEP));
  const h = total / n;
  const w = 2 * Math.PI * Math.max(0, p.freq);
  const z = Math.max(0, p.damping);
  for (let i = 0; i < n; i++) {
    s.v = (s.v + h * w * w * (target - s.x)) / (1 + 2 * z * w * h + w * w * h * h);
    s.x += h * s.v;
  }
}

/** Keep a spring inside +-max. A spring pushed into the wall loses its outward speed (no jitter against the limit). */
export function clampSpring(s: Spring, max: number): void {
  if (s.x > max) {
    s.x = max;
    if (s.v > 0) s.v = 0;
  } else if (s.x < -max) {
    s.x = -max;
    if (s.v < 0) s.v = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Numbers to tune by feel [A]
// ---------------------------------------------------------------------------------------------------------------------

export const EAR_SPRING = {
  swing: { freq: 2.4, damping: 0.3 },
  tilt: { freq: 2.8, damping: 0.4 },
  flex: { freq: 4, damping: 0.25 },
} as const satisfies Record<string, SpringParams>;

/** Hard limits in radians (about 24, 14 and 4 degrees). Past these an ear would push through the head. */
export const EAR_LIMITS = { swing: 0.42, tilt: 0.25, flex: 0.07 } as const;

/** How much of the head's own rotation (in the head's frame) the ear refuses to follow, per axis. 1 would be an ear fixed in space. */
export const FOLLOW_GAIN = { x: 0.35, y: 0.35, z: 0.7 } as const;
/** How much of a sideways move of the head the ear lags behind, as radians per world unit of move, per unit of ear length. */
export const MOVE_GAIN = 0.5;
/** The fold bends against the swing: flex target = -FLEX_FROM_SWING * swing. */
export const FLEX_FROM_SWING = 0.16;
/** Per ear: the upright ear's fold flexes fully (Phase 8 text); the angled ear's fold, which is drawn too, flexes half as much. */
export const FLEX_GAIN: Record<EarName, number> = { upright: 1, angled: 0.5 };
/** Reduced motion: the head still tugs the ears a little (it would look dead otherwise) but nothing moves on its own. */
export const REDUCED_FOLLOW_SCALE = 0.4;

/** The flick: the ear's swing target jumps by FLICK_ANGLE and comes back; the spring adds the overshoot. */
export const FLICK = { rise: 0.05, fall: 0.16, angle: 0.3 } as const;
export const FLICK_TOTAL = FLICK.rise + FLICK.fall;

/** Idle sway (a sleepy character): tiny and slow. Spring mode only gets it on the swing target; sway mode is just this. */
export const IDLE_SWAY = { amplitude: 0.025, hz: 0.21 } as const;
/** Automatic flicks: seconds between them, and how strong they are (fraction of FLICK.angle). */
export const AUTO_FLICK = { minGap: 7, maxGap: 16, minStrength: 0.6, maxStrength: 1 } as const;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Shape of one flick, 0 before and after, 1 at the top, for `t` seconds after it starts. */
export function flickAt(t: number): number {
  if (!(t > 0) || t >= FLICK_TOTAL) return 0;
  if (t < FLICK.rise) return smooth(t / FLICK.rise);
  return 1 - smooth((t - FLICK.rise) / FLICK.fall);
}

/** The cheap mode for the low tier; the mid and high tiers get the springs. */
export function earModeForTier(tier: QualityTier): EarMotionMode {
  return tier === 'low' ? 'sway' : 'spring';
}

// ---------------------------------------------------------------------------------------------------------------------
// Ear geometry in the drawing's plane
// ---------------------------------------------------------------------------------------------------------------------

export interface EarAxis {
  /** Unit vector from the pivot to the tip, in x, y. */
  dir: [number, number];
  /** Distance from the pivot to the tip. */
  length: number;
  /** -1 if this ear is on the viewer's left of the head's middle, +1 if on the right. */
  outwardX: -1 | 1;
}

/** The tip is the vertex farthest from the pivot (in x, y). `positions` is x, y, z triples. */
export function earAxis(positions: ArrayLike<number>, pivot: readonly number[], headCentreX: number): EarAxis {
  let best = -1;
  let bx = 0;
  let by = 1;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const dx = positions[i]! - pivot[0]!;
    const dy = positions[i + 1]! - pivot[1]!;
    const d = dx * dx + dy * dy;
    if (d > best) {
      best = d;
      bx = dx;
      by = dy;
    }
  }
  const length = Math.sqrt(Math.max(best, 0));
  const dir: [number, number] = length > 1e-9 ? [bx / length, by / length] : [0, 1];
  return { dir, length: Math.max(length, 1e-9), outwardX: pivot[0]! < headCentreX ? -1 : 1 };
}

/** Rotation about z (radians) that moves the tip by -m for a move m of the head: the ear lags behind. Per unit of move per unit of length. */
export function lagAngle(dir: readonly [number, number], mx: number, my: number): number {
  return mx * dir[1] - my * dir[0];
}

/** Which way a flick swings: +1 or -1 about z. The tip goes outward and up, never into the head. */
export function flickSign(dir: readonly [number, number], outwardX: number): 1 | -1 {
  // rotating by +theta about z moves the tip along (-dir.y, dir.x)
  const score = -dir[1] * (0.5 * outwardX) + dir[0] * 1;
  return score >= 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------------------------------------------------
// Both ears
// ---------------------------------------------------------------------------------------------------------------------

export interface EarPose {
  rx: number;
  ry: number;
  rz: number;
  /** Extra rotation of the bowl about z, relative to the ear. */
  flex: number;
}
export interface EarMotionOptions {
  mode?: EarMotionMode;
  reducedMotion?: boolean;
  seed?: number;
}
export interface HeadDelta {
  /** Rotation of the head since the last frame, in the head's own axes, radians (small angles). */
  rx: number;
  ry: number;
  rz: number;
  /** Move of the head since the last frame, in the head's own axes, world units. */
  mx: number;
  my: number;
}

interface EarState {
  rx: Spring;
  ry: Spring;
  rz: Spring;
  flex: Spring;
  axis: EarAxis;
  flickT: number;
  flickK: number;
}

/** Small seeded generator (mulberry32), same as blink.ts. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class EarMotion {
  mode: EarMotionMode;
  /** Automatic flicks. Off by default under reduced motion. */
  auto: boolean;
  readonly reduced: boolean;
  private ears: Record<EarName, EarState>;
  private time = 0;
  private rng: () => number;
  private nextFlickIn: number;

  constructor(axes: Record<EarName, EarAxis>, opts: EarMotionOptions = {}) {
    this.mode = opts.mode ?? 'spring';
    this.reduced = opts.reducedMotion ?? false;
    this.auto = !this.reduced;
    this.rng = makeRng(opts.seed ?? 11);
    this.nextFlickIn = this.gap();
    const mk = (axis: EarAxis): EarState => ({ rx: newSpring(), ry: newSpring(), rz: newSpring(), flex: newSpring(), axis, flickT: Infinity, flickK: 0 });
    this.ears = { upright: mk(axes.upright), angled: mk(axes.angled) };
  }

  private gap(): number {
    return AUTO_FLICK.minGap + this.rng() * (AUTO_FLICK.maxGap - AUTO_FLICK.minGap);
  }

  /** Start a flick now. `strength` 0..1 of the full flick angle. */
  flick(which: EarName | 'both', strength = 1): void {
    const k = Number.isFinite(strength) ? Math.min(Math.max(strength, 0), 1) : 0;
    for (const n of EAR_NAMES) {
      if (which !== 'both' && which !== n) continue;
      this.ears[n].flickT = 0;
      this.ears[n].flickK = k;
    }
  }

  /** Both ears back at rest, no flick in progress. */
  reset(): void {
    for (const n of EAR_NAMES) {
      const e = this.ears[n];
      e.rx = newSpring();
      e.ry = newSpring();
      e.rz = newSpring();
      e.flex = newSpring();
      e.flickT = Infinity;
      e.flickK = 0;
    }
  }

  /** Tell the springs how the head moved this frame. Does nothing in sway mode. */
  couple(d: HeadDelta): void {
    if (this.mode !== 'spring') return;
    const scale = this.reduced ? REDUCED_FOLLOW_SCALE : 1;
    for (const n of EAR_NAMES) {
      const e = this.ears[n];
      // the ear is left behind by the head's own rotation, so it turns the opposite way relative to the head
      e.rx.x -= FOLLOW_GAIN.x * scale * finite(d.rx);
      e.ry.x -= FOLLOW_GAIN.y * scale * finite(d.ry);
      e.rz.x -= FOLLOW_GAIN.z * scale * finite(d.rz);
      // and by a sideways or up and down move of the head
      e.rz.x += (MOVE_GAIN * scale * lagAngle(e.axis.dir, finite(d.mx), finite(d.my))) / e.axis.length;
      clampSpring(e.rx, EAR_LIMITS.tilt);
      clampSpring(e.ry, EAR_LIMITS.tilt);
      clampSpring(e.rz, EAR_LIMITS.swing);
    }
  }

  /** Where the ear is now. The returned object is fresh, safe to keep. */
  pose(n: EarName): EarPose {
    const e = this.ears[n];
    if (this.mode === 'sway') {
      return { rx: 0, ry: 0, rz: this.swayAngle(n) + this.flickTarget(e), flex: 0 };
    }
    return { rx: e.rx.x, ry: e.ry.x, rz: e.rz.x, flex: e.flex.x };
  }

  private swayAngle(n: EarName): number {
    if (this.reduced) return 0;
    const phase = n === 'upright' ? 0 : 2.1;
    return IDLE_SWAY.amplitude * Math.sin(2 * Math.PI * IDLE_SWAY.hz * this.time + phase);
  }

  private flickTarget(e: EarState): number {
    return flickSign(e.axis.dir, e.axis.outwardX) * FLICK.angle * e.flickK * flickAt(e.flickT);
  }

  update(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const step = Math.min(dt, MAX_DT);
    this.time += step;
    if (this.auto) {
      this.nextFlickIn -= step;
      if (this.nextFlickIn <= 0) {
        const who: EarName = this.rng() < 0.65 ? 'upright' : 'angled';
        this.flick(who, AUTO_FLICK.minStrength + this.rng() * (AUTO_FLICK.maxStrength - AUTO_FLICK.minStrength));
        this.nextFlickIn = this.gap();
      }
    }
    for (const n of EAR_NAMES) {
      const e = this.ears[n];
      e.flickT += step;
      if (this.mode === 'sway') continue; // pose() reads the sine and the flick shape directly
      const swingTarget = this.swayAngle(n) + this.flickTarget(e);
      stepSpring(e.rz, swingTarget, step, EAR_SPRING.swing);
      stepSpring(e.rx, 0, step, EAR_SPRING.tilt);
      stepSpring(e.ry, 0, step, EAR_SPRING.tilt);
      clampSpring(e.rz, EAR_LIMITS.swing);
      clampSpring(e.rx, EAR_LIMITS.tilt);
      clampSpring(e.ry, EAR_LIMITS.tilt);
      // the fold bends against the swing, one spring behind it
      stepSpring(e.flex, -FLEX_FROM_SWING * FLEX_GAIN[n] * e.rz.x, step, EAR_SPRING.flex);
      clampSpring(e.flex, EAR_LIMITS.flex);
    }
  }
}

function finite(x: number): number {
  return Number.isFinite(x) ? x : 0;
}
