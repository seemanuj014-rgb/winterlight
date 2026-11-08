// Fixed-step simulation plus variable-rate render, with pause reasons.
// No three import: the stepper is pure and unit-tested.

export const FIXED_DT = 1 / 60;

export class FixedStepper {
  private acc = 0;

  constructor(
    readonly stepSec: number = FIXED_DT,
    /** A frame longer than this (tab was throttled, debugger) is treated as this long. */
    readonly maxFrameSec: number = 0.1,
    /** Hard cap on catch-up steps per frame; beyond it the backlog is dropped, not replayed. */
    readonly maxSteps: number = 5,
  ) {}

  /** Returns how many fixed steps to run, and alpha in [0,1) for render interpolation. */
  advance(frameSec: number): { steps: number; alpha: number } {
    const f = Math.min(Math.max(frameSec, 0), this.maxFrameSec);
    this.acc += f;
    let steps = Math.floor(this.acc / this.stepSec + 1e-9);
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.acc = 0;
    } else {
      this.acc = Math.max(0, this.acc - steps * this.stepSec);
    }
    return { steps, alpha: this.acc / this.stepSec };
  }

  reset(): void {
    this.acc = 0;
  }
}

export interface LoopHandlers {
  /** Runs 0..n times per frame with the constant FIXED_DT. */
  step(dtSec: number): void;
  /** Runs once per frame. frameSec is the real time since the previous frame (0 on the first frame after a start or resume). */
  render(alpha: number, frameSec: number): void;
}

export interface Loop {
  start(): void;
  /** Pause for a named reason; the loop runs only when no reasons are active. */
  pause(reason: string): void;
  resume(reason: string): void;
  readonly running: boolean;
  dispose(): void;
}

export function createLoop(handlers: LoopHandlers, doc: Document = document): Loop {
  const reasons = new Set<string>();
  const stepper = new FixedStepper();
  let raf = 0;
  let last: number | null = null;
  let started = false;
  let disposed = false;

  const frame = (t: number): void => {
    // Schedule first, so one thrown error in a handler does not freeze the card.
    raf = requestAnimationFrame(frame);
    const frameSec = last === null ? 0 : (t - last) / 1000;
    last = t;
    const { steps, alpha } = stepper.advance(frameSec);
    for (let i = 0; i < steps; i++) handlers.step(FIXED_DT);
    handlers.render(alpha, frameSec);
  };

  const sync = (): void => {
    const shouldRun = started && !disposed && reasons.size === 0;
    if (shouldRun && !raf) {
      last = null; // no giant dt after a pause
      stepper.reset();
      raf = requestAnimationFrame(frame);
    } else if (!shouldRun && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const onVisibility = (): void => {
    if (doc.hidden) reasons.add('hidden');
    else reasons.delete('hidden');
    sync();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  if (doc.hidden) reasons.add('hidden');

  return {
    start() {
      started = true;
      sync();
    },
    pause(reason) {
      reasons.add(reason);
      sync();
    },
    resume(reason) {
      reasons.delete(reason);
      sync();
    },
    get running() {
      return raf !== 0;
    },
    dispose() {
      disposed = true;
      doc.removeEventListener('visibilitychange', onVisibility);
      sync();
    },
  };
}
