// Phase 28: the finale as a small machine. Pure (no three, no DOM, no clock, no random): it is told how much time passed and says where the beat is.
//
//   idle --start()--> lifting (the five shapes lift off their patches) --> joining (they drift together into one message) --> swelling (the aurora swells, the music box plays)
//        --> pulling (the camera pulls back through the pines to the cabin in the valley) --> done (stay a while begins) --replay()--> lifting ...
//
// Rules, kept here so a test can pin them:
//   * Events fire once each and in order, however big a step was; a long frame is capped (a stalled tab must not skip the beat).
//   * `start()` and `replay()` only work from the right phase; a second call does nothing. The beat can be replayed any number of times once it is done.
//   * The finale asks nothing of her (no input, no choice, no microphone). It never ends the card: `done` hands over to stay a while, which has no end.
//   * Progress numbers are 0..1 and are the ONLY thing a picture reads, so a frozen frame, a test and the page agree.
// The words are not here: the message across the sky is the owner's `finale_sky_message` from content/credits.json, passed through `finaleMessageFor`. Every number is `[A]`.

export type FinalePhase = 'idle' | 'lifting' | 'joining' | 'swelling' | 'pulling' | 'done';
export type FinaleEventType = 'start' | 'join' | 'swell' | 'pullback' | 'done';

export interface FinaleEvent {
  type: FinaleEventType;
  /** the machine's own clock when it happened (seconds) */
  at: number;
}

export const FINALE = {
  /** seconds per beat (normal motion) */
  liftS: 4,
  joinS: 6,
  swellS: 6,
  pullS: 8,
  /** reduced motion: the same beats and order, short and plain (the pictures fade instead of travelling) */
  reducedLiftS: 1.2,
  reducedJoinS: 1.8,
  reducedSwellS: 2,
  reducedPullS: 2.4,
  /** a frame longer than this counts as this long */
  maxDt: 0.25,
} as const;

export interface FinaleOptions {
  reducedMotion?: boolean;
  onEvent?: (e: FinaleEvent) => void;
}

const ORDER: FinalePhase[] = ['lifting', 'joining', 'swelling', 'pulling'];

export class FinaleMachine {
  private p: FinalePhase = 'idle';
  private t = 0;
  private phaseT = 0;
  private plays = 0;
  private reduced: boolean;
  readonly log: FinaleEvent[] = [];
  private readonly onEvent: (e: FinaleEvent) => void;

  constructor(o: FinaleOptions = {}) {
    this.reduced = o.reducedMotion === true;
    this.onEvent = o.onEvent ?? (() => undefined);
  }

  get phase(): FinalePhase {
    return this.p;
  }
  get time(): number {
    return this.t;
  }
  get phaseTime(): number {
    return this.phaseT;
  }
  /** how many times the beat has begun (the first is the finale, the rest are replays) */
  get timesStarted(): number {
    return this.plays;
  }
  get started(): boolean {
    return this.p !== 'idle';
  }
  get finished(): boolean {
    return this.p === 'done';
  }
  /** seconds the current beat lasts (0 when idle or done) */
  get phaseSeconds(): number {
    return this.secondsOf(this.p);
  }
  get totalSeconds(): number {
    return ORDER.reduce((s, p) => s + this.secondsOf(p), 0);
  }

  private secondsOf(p: FinalePhase): number {
    const r = this.reduced;
    if (p === 'lifting') return r ? FINALE.reducedLiftS : FINALE.liftS;
    if (p === 'joining') return r ? FINALE.reducedJoinS : FINALE.joinS;
    if (p === 'swelling') return r ? FINALE.reducedSwellS : FINALE.swellS;
    if (p === 'pulling') return r ? FINALE.reducedPullS : FINALE.pullS;
    return 0;
  }
  /** 0..1 through one beat: 0 before it, 1 after it, linear within it */
  private progressOf(p: FinalePhase): number {
    if (this.p === 'idle') return 0;
    const mine = ORDER.indexOf(p);
    const now = this.p === 'done' ? ORDER.length : ORDER.indexOf(this.p);
    if (now > mine) return 1;
    if (now < mine) return 0;
    return Math.min(1, this.phaseT / this.secondsOf(p));
  }
  /** the five shapes lifting off their patches */
  get liftProgress(): number {
    return this.progressOf('lifting');
  }
  /** the shapes drifting together into one message (the message is readable at 1) */
  get joinProgress(): number {
    return this.progressOf('joining');
  }
  /** the aurora swelling (it holds at 1 after, so the pull-back is under a full sky) */
  get auroraSwell(): number {
    return this.progressOf('swelling');
  }
  /** the camera pulling back through the pines to the cabin */
  get pullProgress(): number {
    return this.progressOf('pulling');
  }
  /** 0..1 over the whole finale */
  get progress(): number {
    if (this.p === 'idle') return 0;
    if (this.p === 'done') return 1;
    const total = this.totalSeconds;
    let before = 0;
    for (const p of ORDER) {
      if (p === this.p) break;
      before += this.secondsOf(p);
    }
    return Math.min(1, (before + this.phaseT) / total);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  private emit(type: FinaleEventType): void {
    const e: FinaleEvent = { type, at: this.t };
    this.log.push(e);
    if (this.log.length > 100) this.log.shift();
    try {
      this.onEvent(e);
    } catch {
      /* one bad listener never stops the beat */
    }
  }
  private go(p: FinalePhase): void {
    this.p = p;
    this.phaseT = 0;
  }

  /** Begin the finale. Only from idle; a second call does nothing. */
  start(): void {
    if (this.p !== 'idle') return;
    this.plays++;
    this.go('lifting');
    this.emit('start');
  }

  /** Play it again from the top. Only once it is done (never cuts a beat in half). Returns whether it did anything. */
  replay(): boolean {
    if (this.p !== 'done') return false;
    this.plays++;
    this.go('lifting');
    this.emit('start');
    return true;
  }

  /** Advance the clock. Frames longer than `FINALE.maxDt` count as that long; bad numbers are ignored. One step crosses at most one beat, so every event is seen in order. */
  step(dt: number): void {
    if (typeof dt !== 'number' || !(dt > 0) || !Number.isFinite(dt)) return;
    const d = Math.min(dt, FINALE.maxDt);
    this.t += d;
    this.phaseT += d;
    if (this.p === 'lifting' && this.phaseT >= this.secondsOf('lifting')) {
      this.go('joining');
      this.emit('join');
    } else if (this.p === 'joining' && this.phaseT >= this.secondsOf('joining')) {
      this.go('swelling');
      this.emit('swell');
    } else if (this.p === 'swelling' && this.phaseT >= this.secondsOf('swelling')) {
      this.go('pulling');
      this.emit('pullback');
    } else if (this.p === 'pulling' && this.phaseT >= this.secondsOf('pulling')) {
      this.go('done');
      this.emit('done');
    }
  }
}

/** The message across the sky is the owner's own string from content/credits.json, as it is (a placeholder shows as a placeholder, like the wishes). The one door every path goes through. */
export function finaleMessageFor(credits: { finale_sky_message: string }): string {
  return credits.finale_sky_message;
}
