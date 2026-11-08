// Phase 18: vibration patterns and the rule that keeps them gentle. Pure (no DOM, no clock).
// Patterns are plain millisecond lists (vibrate, pause, vibrate ...). Names are generic on purpose; the acts decide which moment gets which.

/** `[A]` all of these are my numbers; a phone's motor makes anything under about 10 ms a faint tick. */
export const HAPTIC_PATTERNS = {
  tick: [8],
  tap: [12],
  soft: [18],
  press: [10, 40, 14],
  wake: [24, 70, 18],
  done: [12, 60, 12, 60, 26],
} as const satisfies Record<string, readonly number[]>;

export type HapticName = keyof typeof HAPTIC_PATTERNS;
export const HAPTIC_NAMES = Object.keys(HAPTIC_PATTERNS) as HapticName[];

export const MAX_PATTERN_LENGTH = 9;
export const MAX_PATTERN_MS = 600;
export const MAX_SEGMENT_MS = 200;

/** Whole milliseconds, each 1..200, at most 9 of them and 600 in total; anything else is cut. Never returns NaN. Empty for nonsense. */
export function sanitizePattern(p: readonly number[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (const raw of p) {
    if (out.length >= MAX_PATTERN_LENGTH) break;
    if (!Number.isFinite(raw)) continue;
    const v = Math.min(MAX_SEGMENT_MS, Math.max(1, Math.round(raw)));
    if (total + v > MAX_PATTERN_MS) break;
    out.push(v);
    total += v;
  }
  return out;
}

export interface HapticLimits {
  /** least gap between two buzzes (ms) */
  minGapMs: number;
  /** window for the budget (ms) */
  windowMs: number;
  /** most buzzing time in one window (ms) */
  budgetMs: number;
}

/** `[A]` 80 ms apart, and no more than 1.5 s of buzzing in any 10 s: a storm of taps cannot make her phone buzz continuously. */
export const HAPTIC_LIMITS: HapticLimits = { minGapMs: 80, windowMs: 10_000, budgetMs: 1500 };

export class HapticLimiter {
  private readonly lim: HapticLimits;
  private last = -Infinity;
  private spent: { t: number; ms: number }[] = [];

  constructor(lim: Partial<HapticLimits> = {}) {
    this.lim = { ...HAPTIC_LIMITS, ...lim };
  }

  /** Ask to buzz `pattern` at time `t` (ms). Returns true (and counts it) if allowed. */
  allow(pattern: readonly number[], t: number): boolean {
    if (!Number.isFinite(t) || pattern.length === 0) return false;
    const ms = pattern.reduce((a, b) => a + b, 0);
    if (t - this.last < this.lim.minGapMs) return false;
    this.spent = this.spent.filter((s) => t - s.t < this.lim.windowMs);
    const used = this.spent.reduce((a, s) => a + s.ms, 0);
    if (used + ms > this.lim.budgetMs) return false;
    this.spent.push({ t, ms });
    this.last = t;
    return true;
  }
}
