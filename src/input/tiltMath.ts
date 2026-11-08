// Phase 18: device tilt -> a gentle -1..1 parallax. Pure (no three, no DOM, no clock).
// Three parts: (1) `TiltFilter` turns raw beta/gamma degrees and the screen's turn into x and y, with a neutral that re-centres slowly,
// a dead zone, a limit, and a critically smooth follower (frame-rate independent); (2) `nextTiltState` is the permission and support machine
// (iOS asks first, desktop has no sensor, the viewer may say no or switch it off); (3) `blendParallax` picks tilt, or a small share of the mouse,
// or nothing (reduced motion is always nothing).
// SIGNS ARE UNPROVEN: the sandbox has no sensor. `TILT_SIGN` is the one place to flip if on her phone the picture leans the wrong way.

export interface TiltConfig {
  /** degrees of tilt from neutral that give the full 1.0 */
  rangeDeg: number;
  /** degrees ignored around neutral, so a hand's shake does nothing */
  deadDeg: number;
  /** seconds for the output to cover about 63 percent of a change */
  followSec: number;
  /** seconds for the neutral to drift toward where the phone is held now */
  restSec: number;
}

/** `[A]` 14 degrees for full effect, 0.8 degree dead zone, 0.22 s follow, 7 s to re-centre. */
export const TILT_DEFAULTS: TiltConfig = { rangeDeg: 14, deadDeg: 0.8, followSec: 0.22, restSec: 7 };

/** `[A]` flip a sign here if the leaning is backwards on a real phone */
export const TILT_SIGN = { x: 1, y: 1 } as const;

export const wrapDeg = (d: number): number => {
  let v = d % 360;
  if (v > 180) v -= 360;
  else if (v <= -180) v += 360;
  return v;
};

/** Nearest of 0, 90, 180, 270 for whatever the browser reports (negative, 360 and odd values included). */
export function screenQuarter(angleDeg: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(angleDeg)) return 0;
  const q = ((Math.round(angleDeg / 90) % 4) + 4) % 4;
  return (q * 90) as 0 | 90 | 180 | 270;
}

/**
 * Device-frame tilt (gamma = left/right, beta = front/back) -> the screen's own right and up, for the screen turned `angle` degrees.
 * It is a plain rotation: the four angles are quarter turns of one another (tested).
 */
export function toScreenFrame(gamma: number, beta: number, angle: number): { u: number; v: number } {
  const q = screenQuarter(angle);
  const c = q === 90 ? 0 : q === 270 ? 0 : q === 0 ? 1 : -1;
  const s = q === 90 ? 1 : q === 270 ? -1 : 0;
  return { u: gamma * c + beta * s, v: -gamma * s + beta * c };
}

const clamp1 = (v: number): number => Math.min(1, Math.max(-1, v));

export class TiltFilter {
  readonly cfg: TiltConfig;
  private reduced: boolean;
  private nu = 0;
  private nv = 0;
  private tu = 0;
  private tv = 0;
  private ox = 0;
  private oy = 0;
  private quarter = -1;
  private have = false;

  constructor(cfg: Partial<TiltConfig> = {}, reducedMotion = false) {
    this.cfg = { ...TILT_DEFAULTS, ...cfg };
    this.reduced = reducedMotion;
  }

  get x(): number {
    return this.reduced ? 0 : this.ox;
  }
  get y(): number {
    return this.reduced ? 0 : this.oy;
  }
  get hasSample(): boolean {
    return this.have;
  }
  setReduced(on: boolean): void {
    this.reduced = on;
    if (on) {
      this.ox = 0;
      this.oy = 0;
    }
  }

  /** Forget the neutral and the position (the next sample becomes neutral). */
  reset(): void {
    this.have = false;
    this.quarter = -1;
    this.tu = this.tv = this.ox = this.oy = 0;
  }

  /** One sensor reading. Returns false (and changes nothing) for null, NaN or infinity, which is what a desktop browser sends. */
  push(gamma: number | null | undefined, beta: number | null | undefined, screenAngle: number): boolean {
    if (gamma == null || beta == null || !Number.isFinite(gamma) || !Number.isFinite(beta)) return false;
    const q = screenQuarter(screenAngle);
    const { u, v } = toScreenFrame(gamma, beta, q);
    this.lastU = u;
    this.lastV = v;
    if (!this.have || q !== this.quarter) {
      // first reading, or the phone was turned: wherever it is held now is neutral
      this.nu = u;
      this.nv = v;
      this.quarter = q;
      this.have = true;
      this.tu = this.tv = 0;
      return true;
    }
    this.tu = this.shape(wrapDeg(u - this.nu));
    this.tv = this.shape(wrapDeg(v - this.nv));
    return true;
  }
  private lastU = 0;
  private lastV = 0;

  private shape(deg: number): number {
    const d = Math.max(0, Math.abs(deg) - this.cfg.deadDeg);
    return clamp1((Math.sign(deg) * d) / this.cfg.rangeDeg);
  }

  /** Per frame. dt is clamped, NaN and negative are ignored. */
  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const d = Math.min(dt, 0.1);
    if (this.reduced) {
      this.ox = this.oy = 0;
      return;
    }
    const k = 1 - Math.exp(-d / this.cfg.followSec);
    this.ox += (TILT_SIGN.x * this.tu - this.ox) * k;
    this.oy += (TILT_SIGN.y * this.tv - this.oy) * k;
    if (this.have) {
      // the neutral drifts toward where the phone is held: sitting back in a chair stops counting as a tilt after a while
      const kn = 1 - Math.exp(-d / this.cfg.restSec);
      this.nu += wrapDeg(this.lastU - this.nu) * kn;
      this.nv += wrapDeg(this.lastV - this.nv) * kn;
    }
  }
}

// ---- permission and support ------------------------------------------------------------------------------------------------------------

export type TiltState =
  | 'unsupported' // no sensor, or the page is not a secure context
  | 'needs-permission' // iOS: must be asked from a tap
  | 'waiting' // listening, nothing valid has arrived yet
  | 'on'
  | 'denied' // she said no
  | 'off'; // she (or the card) switched it off

export type TiltEvent = 'init-unsupported' | 'init-needs-permission' | 'init-listen' | 'sample' | 'timeout' | 'granted' | 'refused' | 'disable' | 'enable';

/** The whole state machine. A state not listed for an event stays as it is. Never throws. */
export function nextTiltState(state: TiltState, ev: TiltEvent): TiltState {
  switch (ev) {
    case 'init-unsupported':
      return 'unsupported';
    case 'init-needs-permission':
      return state === 'unsupported' ? state : 'needs-permission';
    case 'init-listen':
      return state === 'unsupported' ? state : 'waiting';
    case 'sample':
      return state === 'waiting' || state === 'on' ? 'on' : state;
    case 'timeout':
      return state === 'waiting' ? 'unsupported' : state;
    case 'granted':
      return state === 'needs-permission' || state === 'denied' ? 'waiting' : state;
    case 'refused':
      return state === 'needs-permission' ? 'denied' : state;
    case 'disable':
      return state === 'unsupported' || state === 'denied' ? state : 'off';
    case 'enable':
      return state === 'off' ? 'waiting' : state;
  }
}

// ---- which parallax ---------------------------------------------------------------------------------------------------------------------

export interface ParallaxInput {
  tilt: { x: number; y: number };
  tiltState: TiltState;
  /** -1..1, y up */
  pointer: { x: number; y: number; active: boolean; kind: 'touch' | 'mouse' | 'pen' | 'key' | 'none' };
  reducedMotion: boolean;
  /** how much of the mouse's position counts when there is no tilt (0..1) */
  mouseShare?: number;
}

/** Tilt when it is on; else a small share of the mouse (a finger is not a hover, so touch gives nothing); else nothing. Reduced motion: nothing, always. */
export function blendParallax(i: ParallaxInput): { x: number; y: number } {
  if (i.reducedMotion) return { x: 0, y: 0 };
  if (i.tiltState === 'on') return { x: clamp1(i.tilt.x), y: clamp1(i.tilt.y) };
  if (i.pointer.kind === 'mouse' && i.pointer.active) {
    const k = Math.min(1, Math.max(0, i.mouseShare ?? 0.35));
    return { x: clamp1(i.pointer.x) * k, y: clamp1(i.pointer.y) * k };
  }
  return { x: 0, y: 0 };
}
