// Phase 7: blinking. Pure maths, no three.
// One blink is close fast, hold a moment, open a little slower. The value is 0 (open) to 1 (closed, a soft curved ink line).
// Blinks come on a calm random rhythm from a seeded generator, so a test can replay them and a screenshot is repeatable.

export const BLINK = { close: 0.07, hold: 0.05, open: 0.14 } as const;
export const BLINK_TOTAL = BLINK.close + BLINK.hold + BLINK.open;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Closedness at `t` seconds after a blink starts. 0 before and after. */
export function blinkAt(t: number): number {
  if (!(t > 0) || t >= BLINK_TOTAL) return 0;
  if (t < BLINK.close) return smooth(t / BLINK.close);
  if (t < BLINK.close + BLINK.hold) return 1;
  return 1 - smooth((t - BLINK.close - BLINK.hold) / BLINK.open);
}

/** Small seeded generator (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BlinkOptions {
  minGap: number;
  maxGap: number;
  /** Chance that a blink is followed straight away by a second one. */
  doubleChance: number;
}
export const BLINK_RHYTHM: BlinkOptions = { minGap: 2.4, maxGap: 6, doubleChance: 0.12 };

export class Blinker {
  /** Turn off for reduced motion: no automatic blinks (a manual `trigger()` still works). */
  auto = true;
  private t = Infinity; // time since the current blink started
  private wait: number;
  private rng: () => number;
  private o: BlinkOptions;
  private pendingDouble = false;

  constructor(seed = 7, options: Partial<BlinkOptions> = {}) {
    this.o = { ...BLINK_RHYTHM, ...options };
    this.rng = makeRng(seed);
    this.wait = this.nextGap();
  }

  private nextGap(): number {
    return this.o.minGap + this.rng() * (this.o.maxGap - this.o.minGap);
  }

  trigger(): void {
    this.t = 0;
  }

  /** Advance by dt seconds, return the closedness. */
  update(dt: number): number {
    if (!(dt > 0)) return blinkAt(this.t);
    if (this.t < BLINK_TOTAL) {
      this.t += dt;
      if (this.t >= BLINK_TOTAL && this.pendingDouble) {
        this.pendingDouble = false;
        this.t = 0.02; // a quick second blink straight after the first
      }
    } else if (this.auto) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.t = 0;
        this.pendingDouble = this.rng() < this.o.doubleChance;
        this.wait = this.nextGap();
      }
    }
    return blinkAt(this.t);
  }
}
