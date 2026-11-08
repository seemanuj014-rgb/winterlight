export type QualityTier = 'low' | 'mid' | 'high';

export interface QualitySettings {
  tier: QualityTier;
  maxPixelRatio: number;
  maxParticles: number;
  postprocessing: boolean;
}

const TABLE: Record<QualityTier, QualitySettings> = {
  low: { tier: 'low', maxPixelRatio: 1.25, maxParticles: 800, postprocessing: false },
  mid: { tier: 'mid', maxPixelRatio: 1.75, maxParticles: 2500, postprocessing: true },
  high: { tier: 'high', maxPixelRatio: 2, maxParticles: 6000, postprocessing: true },
};

export function settingsFor(tier: QualityTier): QualitySettings {
  return TABLE[tier];
}

export function pickInitialTier(hardwareConcurrency: number, deviceMemoryGB: number | undefined, reducedMotion: boolean): QualityTier {
  if (reducedMotion) return 'low';
  if ((deviceMemoryGB ?? 4) <= 2 || hardwareConcurrency <= 4) return 'low';
  if (hardwareConcurrency >= 8 && (deviceMemoryGB ?? 4) >= 6) return 'high';
  return 'mid';
}

// ---------------------------------------------------------------------------
// FPS watchdog (Phase 2). Pure state machine: no three, no DOM, no clock.
// It only ever steps the tier DOWN, and never back up within a session (PB).
// ---------------------------------------------------------------------------

export const TIER_ORDER: readonly QualityTier[] = ['high', 'mid', 'low'];

/** One tier lower; 'low' stays 'low'. */
export function lowerTier(tier: QualityTier): QualityTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)] ?? 'low';
}

export interface WatchdogOptions {
  /** Frames ignored at the start and after every step-down (shader compile, resize settling). */
  warmupFrames: number;
  /** Frames averaged per judgement. */
  windowFrames: number;
  /** Consecutive slow windows needed before stepping down ("sustained"). */
  strikesToStepDown: number;
  /** Samples above this are tab switches or stalls, not performance: ignored entirely. */
  ignoreAboveMs: number;
  /** Each sample is clamped to this so one hitch cannot sink a whole window. */
  clampMs: number;
  /** A window whose mean frame time exceeds this is slow, per current tier. */
  slowMs: Record<QualityTier, number>;
}

export const DEFAULT_WATCHDOG: WatchdogOptions = {
  warmupFrames: 60,
  windowFrames: 120,
  strikesToStepDown: 2,
  ignoreAboveMs: 1000,
  clampMs: 100,
  // high targets 60 fps: slow below ~40. mid targets 45 to 60: slow below ~28, so a phone
  // capped at 30 fps by the OS (33.3 ms) is not punished again. low has nowhere to go.
  slowMs: { high: 25, mid: 35.7, low: Infinity },
};

export class FpsWatchdog {
  private current: QualityTier;
  private readonly opts: WatchdogOptions;
  private warm = 0;
  private count = 0;
  private sum = 0;
  private strikes = 0;

  constructor(startTier: QualityTier, opts: Partial<WatchdogOptions> = {}) {
    this.current = startTier;
    this.opts = { ...DEFAULT_WATCHDOG, ...opts, slowMs: { ...DEFAULT_WATCHDOG.slowMs, ...opts.slowMs } };
  }

  get tier(): QualityTier {
    return this.current;
  }

  /** Feed one frame time in ms. Returns the new (lower) tier when it steps down, else null. */
  push(frameMs: number): QualityTier | null {
    const o = this.opts;
    if (!(frameMs > 0) || frameMs > o.ignoreAboveMs) return null;
    if (this.current === 'low') return null;
    if (this.warm < o.warmupFrames) {
      this.warm++;
      return null;
    }
    this.sum += Math.min(frameMs, o.clampMs);
    this.count++;
    if (this.count < o.windowFrames) return null;

    const mean = this.sum / this.count;
    this.sum = 0;
    this.count = 0;
    if (mean <= o.slowMs[this.current]) {
      this.strikes = 0;
      return null;
    }
    this.strikes++;
    if (this.strikes < o.strikesToStepDown) return null;

    this.current = lowerTier(this.current);
    this.strikes = 0;
    this.warm = 0;
    return this.current;
  }
}
