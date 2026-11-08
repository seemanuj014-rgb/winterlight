// Phase 31: low-power mode. Pure: no three, no DOM, no clock.
// The FPS watchdog (quality.ts) only steps the tier down. When the card is ALREADY at the lowest tier and still
// slow for a sustained stretch, this governor switches on low power: the picture is drawn at most 30 times a second
// (the simulation keeps its fixed step, so nothing slows down, it just looks at the scene less often).
// It never switches back off inside a session (same rule as the watchdog).

export const LOW_POWER_FPS = 30;

export interface PowerOptions {
  warmupFrames: number;
  windowFrames: number;
  /** consecutive slow windows before low power turns on */
  strikes: number;
  /** a window whose mean frame time is above this is slow (40 ms = under 25 fps) */
  slowMs: number;
  /** frames above this are tab switches or stalls, ignored */
  ignoreAboveMs: number;
  clampMs: number;
}

export const DEFAULT_POWER: PowerOptions = { warmupFrames: 60, windowFrames: 120, strikes: 2, slowMs: 40, ignoreAboveMs: 1000, clampMs: 100 };

export class PowerGovernor {
  private on = false;
  private warm = 0;
  private count = 0;
  private sum = 0;
  private strikes = 0;
  private lastDrawMs: number | null = null;
  private readonly o: PowerOptions;

  constructor(opts: Partial<PowerOptions> = {}, private readonly fps: number = LOW_POWER_FPS) {
    this.o = { ...DEFAULT_POWER, ...opts };
  }

  get lowPower(): boolean {
    return this.on;
  }

  /** Switch on by hand (a test knob, or `?lowpower`). */
  enter(): void {
    this.on = true;
  }

  /** Feed one real frame time. Returns true exactly once, on the frame low power turns on. Only counts at the lowest tier. */
  push(frameMs: number, atLowestTier: boolean): boolean {
    const o = this.o;
    if (this.on || !atLowestTier || !(frameMs > 0) || frameMs > o.ignoreAboveMs) return false;
    if (this.warm < o.warmupFrames) {
      this.warm++;
      return false;
    }
    this.sum += Math.min(frameMs, o.clampMs);
    this.count++;
    if (this.count < o.windowFrames) return false;
    const mean = this.sum / this.count;
    this.sum = 0;
    this.count = 0;
    if (mean <= o.slowMs) {
      this.strikes = 0;
      return false;
    }
    if (++this.strikes < o.strikes) return false;
    this.on = true;
    return true;
  }

  /** Should this animation frame be drawn? Always true outside low power. A 2 ms slack so a 60 Hz screen lands on 30, not 20. */
  shouldDraw(nowMs: number): boolean {
    if (!this.on) return true;
    const gap = 1000 / this.fps - 2;
    if (this.lastDrawMs === null || nowMs - this.lastDrawMs >= gap) {
      this.lastDrawMs = nowMs;
      return true;
    }
    return false;
  }
}
