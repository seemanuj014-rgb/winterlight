// Phase 27: the letter ritual as a small machine. Pure (no three, no DOM, no clock, no random): it is told what happened and how much time passed, and says what to do.
//
//   idle --start()--> arriving (the envelope comes down) --> waiting (it hangs there, for as long as she likes) --open()--> opening (the flap, the letter rises)
//        --> reading (the reader is open) --close()--> closed (the sign-off; "read again" is always on offer) --readAgain()--> reading ...
//
// Rules from the storyboard, kept here so a test can pin them:
//   * The letter is NEVER skipped and NEVER auto-advanced: `waiting` has no timer, and nothing but `open()` (a tap, Enter or Space) leaves it.
//   * "Read again" goes straight to `reading` (no second ritual) and works any number of times.
//   * `read` fires ONCE, the first time she has scrolled to the end (`reportProgress(>= READ_AT)`), and only while the reader is open.
//   * Events fire once each and in order, however big a step was; a long frame is capped (a stalled tab must not skip the beat).
// The words of the letter are not here and never will be: this file knows nothing about its text. Every number is `[A]`.

export type LetterPhase = 'idle' | 'arriving' | 'waiting' | 'opening' | 'reading' | 'closed';
export type LetterEventType = 'arrive' | 'ready' | 'opening' | 'open' | 'read' | 'close';

export interface LetterEvent {
  type: LetterEventType;
  /** the machine's own clock when it happened (seconds) */
  at: number;
}

/** How she gets the letter. The storyboard names two; the owner chooses (open question): `lantern` is the default because Phase 26's lanterns are built. */
export type LetterDelivery = 'lantern' | 'table';

export const LETTER = {
  /** seconds for the envelope to come down (a lantern drifts; on the table it only fades in) */
  arriveS: { lantern: 7, table: 2.2 } as Record<LetterDelivery, number>,
  /** seconds of the opening animation (flap, letter rises) */
  openS: 2.4,
  /** how far down she must have scrolled for the letter to count as read */
  readAt: 0.97,
  /** a frame longer than this counts as this long */
  maxDt: 0.25,
  /** reduced motion: the same beats, a shorter arrival and a plain opening (nothing drifts; it appears and she opens it) */
  reducedArriveS: 1.2,
  reducedOpenS: 0.6,
} as const;

export interface LetterOptions {
  delivery?: LetterDelivery;
  reducedMotion?: boolean;
  onEvent?: (e: LetterEvent) => void;
}

export class LetterMachine {
  private p: LetterPhase = 'idle';
  private t = 0;
  private phaseT = 0;
  private wasRead = false;
  private opened = 0;
  readonly log: LetterEvent[] = [];
  private readonly delivery: LetterDelivery;
  private reduced: boolean;
  private readonly onEvent: (e: LetterEvent) => void;

  constructor(o: LetterOptions = {}) {
    this.delivery = o.delivery ?? 'lantern';
    this.reduced = o.reducedMotion === true;
    this.onEvent = o.onEvent ?? (() => undefined);
  }

  get phase(): LetterPhase {
    return this.p;
  }
  get time(): number {
    return this.t;
  }
  /** seconds spent in the current phase */
  get phaseTime(): number {
    return this.phaseT;
  }
  get read(): boolean {
    return this.wasRead;
  }
  /** how many times the reader has been opened (the first is the ritual, the rest are "read again") */
  get timesOpened(): number {
    return this.opened;
  }
  get arriveSeconds(): number {
    return this.reduced ? LETTER.reducedArriveS : LETTER.arriveS[this.delivery];
  }
  get openSeconds(): number {
    return this.reduced ? LETTER.reducedOpenS : LETTER.openS;
  }
  /** 0..1 through the arrival (for the picture) */
  get arriveProgress(): number {
    if (this.p === 'idle') return 0;
    if (this.p !== 'arriving') return 1;
    return Math.min(1, this.phaseT / this.arriveSeconds);
  }
  /** 0..1 through the opening animation */
  get openProgress(): number {
    if (this.p === 'idle' || this.p === 'arriving' || this.p === 'waiting') return 0;
    if (this.p !== 'opening') return 1;
    return Math.min(1, this.phaseT / this.openSeconds);
  }
  /** can she open it right now (a tap or Enter does something)? */
  get canOpen(): boolean {
    return this.p === 'waiting';
  }
  /** is "read again" on offer? (only once she has closed it; never before the first reading) */
  get canReadAgain(): boolean {
    return this.p === 'closed';
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  private emit(type: LetterEventType): void {
    const e: LetterEvent = { type, at: this.t };
    this.log.push(e);
    if (this.log.length > 100) this.log.shift();
    try {
      this.onEvent(e);
    } catch {
      /* one bad listener never stops the ritual */
    }
  }
  private go(p: LetterPhase): void {
    this.p = p;
    this.phaseT = 0;
  }

  /** Begin the delivery. A second call does nothing (it arrives once). */
  start(): void {
    if (this.p !== 'idle') return;
    this.go('arriving');
    this.emit('arrive');
  }

  /** She taps, presses Enter or Space on the envelope. Only works while it is waiting. Returns whether it did anything. */
  open(): boolean {
    if (this.p !== 'waiting') return false;
    this.go('opening');
    this.emit('opening');
    return true;
  }

  /** She puts the letter away (the close button or Escape). Only from `reading`. */
  close(): boolean {
    if (this.p !== 'reading') return false;
    this.go('closed');
    this.emit('close');
    return true;
  }

  /** "Read again": straight back to the reader, no ritual. Only once she has closed it. */
  readAgain(): boolean {
    if (this.p !== 'closed') return false;
    this.opened++;
    this.go('reading');
    this.emit('open');
    return true;
  }

  /** The reader reports how far down she has scrolled (0..1). `read` fires once, only while reading. NaN and out-of-range values are ignored or clamped. */
  reportProgress(p: number): void {
    if (this.p !== 'reading' || this.wasRead) return;
    if (typeof p !== 'number' || Number.isNaN(p)) return;
    if (p >= LETTER.readAt) {
      this.wasRead = true;
      this.emit('read');
    }
  }

  /** Restore "she has read it before" from saved progress (no event: nothing happened now). */
  markReadFromProgress(): void {
    this.wasRead = true;
  }

  /** Advance the clock. Frames longer than `LETTER.maxDt` count as that long; bad numbers are ignored. */
  step(dt: number): void {
    if (typeof dt !== 'number' || !(dt > 0) || !Number.isFinite(dt)) return;
    const d = Math.min(dt, LETTER.maxDt);
    this.t += d;
    this.phaseT += d;
    if (this.p === 'arriving' && this.phaseT >= this.arriveSeconds) {
      this.go('waiting');
      this.emit('ready');
    } else if (this.p === 'opening' && this.phaseT >= this.openSeconds) {
      this.opened++;
      this.go('reading');
      this.emit('open');
    }
  }
}

/** The quiet sign-off: the owner's own two strings from content/credits.json, in that order, nothing added. Blank strings are left out. */
export function signOffLines(credits: { sign_off: string; made_by: string }): string[] {
  return [credits.sign_off, credits.made_by].filter((s) => typeof s === 'string' && s.trim() !== '');
}

/** The text the reader shows is the file's text, byte for byte. This exists so a test can pin the one function every path goes through. */
export function letterTextFor(fileText: string): string {
  return fileText;
}
