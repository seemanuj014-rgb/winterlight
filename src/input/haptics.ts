import { HAPTIC_PATTERNS, HapticLimiter, sanitizePattern, type HapticName } from './hapticsMath';

// Phase 18: vibration where the browser has it (Android Chrome and friends; iOS Safari has none, and then every call is quietly nothing).
// Never throws, never buzzes before the viewer has touched the page (browsers block it and log a warning), never buzzes in a storm (see hapticsMath).

export interface Haptics {
  /** the browser has navigator.vibrate at all */
  readonly supported: boolean;
  /** on by default; the UI layer (Phase 24) offers the switch */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  /** buzz a named pattern. Returns true if it was sent to the motor. */
  pulse(name: HapticName): boolean;
  /** stop any buzz now (the page went to the background, a gesture was cancelled) */
  stop(): void;
}

export function createHaptics(opts: { enabled?: boolean } = {}): Haptics {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }) : null;
  const supported = !!nav && typeof nav.vibrate === 'function';
  const limiter = new HapticLimiter();
  let enabled = opts.enabled ?? true;
  return {
    supported,
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) this.stop();
    },
    pulse(name) {
      if (!supported || !enabled || !nav) return false;
      // browsers refuse to vibrate until the page has had a tap or key press; asking earlier only logs a warning
      if (nav.userActivation && !nav.userActivation.hasBeenActive) return false;
      const pattern = sanitizePattern(HAPTIC_PATTERNS[name] ?? []);
      if (!limiter.allow(pattern, performance.now())) return false;
      try {
        return nav.vibrate(pattern);
      } catch {
        return false;
      }
    },
    stop() {
      if (!supported || !nav) return;
      try {
        nav.vibrate(0);
      } catch {
        /* nothing to stop */
      }
    },
  };
}
