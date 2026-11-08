// Phase 17: how the loading bar moves. Pure: no DOM, no clock, so it is unit-tested.
// Goals: the bar never goes backwards, never sits perfectly still while the boot is alive (a slow creep, capped just ahead of the real progress),
// never shows full until the boot is really done, and when it is done it gets to full quickly without a jump.

export const CREEP_PER_SEC = 0.006;
export const CREEP_HEADROOM = 0.08;
export const CREEP_CEILING = 0.97;
export const APPROACH_SEC = 0.35;
export const FINISH_SEC = 0.5;
/** seconds without any real progress before the screen says the connection is slow, and before it offers a reload */
export const SLOW_AFTER = 8;
export const STUCK_AFTER = 25;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export class ProgressEase {
  private p: number;
  constructor(start = 0) {
    this.p = clamp01(start);
  }
  get shown(): number {
    return this.p;
  }
  /** target: the real progress 0..1; done: the boot has finished (the bar runs to full) */
  update(dt: number, target: number, done: boolean): number {
    const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    const t = clamp01(target);
    let next = this.p;
    if (done) {
      next = Math.min(1, Math.max(next + d / FINISH_SEC, next + (1 - next) * (1 - Math.exp(-d / 0.2))));
    } else {
      if (next < t) next += (t - next) * (1 - Math.exp(-d / APPROACH_SEC));
      const cap = Math.min(CREEP_CEILING, t + CREEP_HEADROOM);
      if (next >= t - 0.004 && next < cap) next = Math.min(cap, next + CREEP_PER_SEC * d);
      next = Math.min(next, CREEP_CEILING);
    }
    this.p = Math.max(this.p, next);
    return this.p;
  }
}

export type Stall = 'ok' | 'slow' | 'stuck';
export function stallLevel(secondsSinceProgress: number): Stall {
  const s = Number.isFinite(secondsSinceProgress) ? secondsSinceProgress : 0;
  return s >= STUCK_AFTER ? 'stuck' : s >= SLOW_AFTER ? 'slow' : 'ok';
}
