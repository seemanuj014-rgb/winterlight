// Phase 18: gesture classification. Pure (no three, no DOM, no clock): every sample carries its own time, so the same stream always gives the same answer.
// One finger (or the mouse, or the keyboard) makes ONE gesture at a time:
//   press, then exactly one of:  tap  |  holdstart ... holdend (then, if the finger wanders far, dragstart ... dragend)  |  dragstart, drag*, dragend  |  cancel.
// A second finger landing cancels the gesture in progress and everything is ignored until every finger is up (so a pinch or a stray palm never becomes a tap).
// What a gesture MEANS (wake, pet, connect a star) is not decided here; that is the acts' job.

export type PointerKind = 'touch' | 'mouse' | 'pen' | 'key';

export interface Sample {
  /** pointer id; the keyboard is -1 */
  id: number;
  phase: 'down' | 'move' | 'up' | 'cancel';
  /** px in the element's own box */
  x: number;
  y: number;
  /** ms, any monotonic clock */
  t: number;
  kind: PointerKind;
}

export interface GestureConfig {
  /** held still this long = a hold (ms) */
  holdMs: number;
  /** how far a finger may wander before a press stops being a tap or a hold and becomes a drag (px) */
  slop: Record<PointerKind, number>;
  /** once a hold has started it forgives more wobble, since she is pressing, not aiming (px) */
  holdSlop: number;
}

/** `[A]` every number is mine: touch slop 14 px (a thumb rolls), mouse 6, hold at 0.5 s (a tap is under that), a hold may drift 28 px. */
export const GESTURE_DEFAULTS: GestureConfig = {
  holdMs: 500,
  slop: { touch: 14, mouse: 6, pen: 9, key: 6 },
  holdSlop: 28,
};

export type GestureType = 'press' | 'tap' | 'holdstart' | 'holdend' | 'dragstart' | 'drag' | 'dragend' | 'cancel';
export type EndReason = 'release' | 'moved' | 'multi' | 'cancel' | 'reset';

export interface GestureEvent {
  type: GestureType;
  id: number;
  kind: PointerKind;
  /** where the pointer is now */
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
  t: number;
  /** distance from the start */
  dx: number;
  dy: number;
  /** movement since the previous event of this gesture (drag only, else 0) */
  ddx: number;
  ddy: number;
  /** ms since the press */
  duration: number;
  /** why a holdend, dragend or cancel happened */
  reason?: EndReason;
}

type Mode = 'idle' | 'pressed' | 'holding' | 'dragging';

export class GestureClassifier {
  readonly cfg: GestureConfig;
  private mode: Mode = 'idle';
  private multi = false;
  private down = new Set<number>();
  private id = 0;
  private kind: PointerKind = 'touch';
  private sx = 0;
  private sy = 0;
  private st = 0;
  private x = 0;
  private y = 0;
  private lastT = 0;
  private out: GestureEvent[] = [];

  constructor(cfg: Partial<GestureConfig> = {}) {
    this.cfg = { ...GESTURE_DEFAULTS, ...cfg, slop: { ...GESTURE_DEFAULTS.slop, ...(cfg.slop ?? {}) } };
  }

  /** the gesture in progress, if any */
  get state(): Mode {
    return this.mode;
  }
  get ignoring(): boolean {
    return this.multi;
  }
  /** the pointer that owns the gesture, or null */
  get activeId(): number | null {
    return this.mode === 'idle' ? null : this.id;
  }

  /** When the next hold would start (ms on the sample clock), or null. The DOM layer sets a timer for it and then calls tick. */
  holdDeadline(): number | null {
    return this.mode === 'pressed' ? this.st + this.cfg.holdMs : null;
  }

  private ev(type: GestureType, t: number, reason?: EndReason, ddx = 0, ddy = 0): GestureEvent {
    const e: GestureEvent = {
      type,
      id: this.id,
      kind: this.kind,
      x: this.x,
      y: this.y,
      startX: this.sx,
      startY: this.sy,
      startT: this.st,
      t,
      dx: this.x - this.sx,
      dy: this.y - this.sy,
      ddx,
      ddy,
      duration: Math.max(0, t - this.st),
    };
    if (reason) e.reason = reason;
    return e;
  }

  /** end whatever is in progress, saying why. Always leaves the classifier idle and every started pair closed. */
  private finish(t: number, reason: EndReason): void {
    if (this.mode === 'pressed') this.out.push(this.ev('cancel', t, reason));
    else if (this.mode === 'holding') this.out.push(this.ev('holdend', t, reason));
    else if (this.mode === 'dragging') this.out.push(this.ev('dragend', t, reason));
    this.mode = 'idle';
  }

  /** Advance time with no new sample: starts a hold when the press has lasted long enough. */
  tick(t: number): GestureEvent[] {
    this.out = [];
    if (Number.isFinite(t)) {
      t = Math.max(t, this.lastT);
      this.lastT = t;
      if (this.mode === 'pressed' && t - this.st >= this.cfg.holdMs) {
        this.mode = 'holding';
        this.out.push(this.ev('holdstart', this.st + this.cfg.holdMs));
      }
    }
    return this.out;
  }

  /** Feed one sample; returns the gesture events it caused (usually none or one). Nonsense samples (NaN) are dropped. */
  push(s: Sample): GestureEvent[] {
    this.out = [];
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.t)) return this.out;
    const t = Math.max(s.t, this.lastT);
    this.lastT = t;
    const own = this.mode !== 'idle' && s.id === this.id;

    if (s.phase === 'down') {
      if (this.down.has(s.id) && own) {
        // a second 'down' for the same pointer: its 'up' was lost somewhere. Drop the old gesture and start fresh.
        this.finish(t, 'reset');
        this.down.delete(s.id);
      }
      this.down.add(s.id);
      if (this.multi) return this.out;
      if (this.mode !== 'idle' || this.down.size > 1) {
        // a second pointer: the first gesture is spoiled, and so is this one
        this.finish(t, 'multi');
        this.multi = true;
        return this.out;
      }
      this.mode = 'pressed';
      this.id = s.id;
      this.kind = s.kind;
      this.sx = this.x = s.x;
      this.sy = this.y = s.y;
      this.st = t;
      this.out.push(this.ev('press', t));
      return this.out;
    }

    if (s.phase === 'move') {
      if (!own || this.multi) return this.out;
      // a hold that was due before this sample starts first, so the order is always right
      if (this.mode === 'pressed' && t - this.st >= this.cfg.holdMs) {
        this.mode = 'holding';
        this.out.push(this.ev('holdstart', this.st + this.cfg.holdMs));
      }
      const px = this.x;
      const py = this.y;
      this.x = s.x;
      this.y = s.y;
      const far = Math.hypot(this.x - this.sx, this.y - this.sy);
      if (this.mode === 'pressed' && far > this.cfg.slop[this.kind]) {
        this.mode = 'dragging';
        this.out.push(this.ev('dragstart', t));
        this.out.push(this.ev('drag', t, undefined, this.x - this.sx, this.y - this.sy));
      } else if (this.mode === 'holding' && far > this.cfg.holdSlop) {
        this.out.push(this.ev('holdend', t, 'moved'));
        this.mode = 'dragging';
        this.out.push(this.ev('dragstart', t));
        this.out.push(this.ev('drag', t, undefined, this.x - px, this.y - py));
      } else if (this.mode === 'dragging') {
        this.out.push(this.ev('drag', t, undefined, this.x - px, this.y - py));
      }
      return this.out;
    }

    // up or cancel
    this.down.delete(s.id);
    if (this.down.size === 0 && this.multi) {
      this.multi = false;
      return this.out;
    }
    if (!own || this.multi) return this.out;
    if (s.phase === 'cancel') {
      this.finish(t, 'cancel');
      return this.out;
    }
    if (this.mode === 'pressed' && t - this.st >= this.cfg.holdMs) {
      this.mode = 'holding';
      this.out.push(this.ev('holdstart', this.st + this.cfg.holdMs));
    }
    this.x = s.x;
    this.y = s.y;
    if (this.mode === 'pressed') {
      this.out.push(this.ev('tap', t));
      this.mode = 'idle';
    } else this.finish(t, 'release');
    return this.out;
  }

  /** Cancel everything now (window lost focus, page hidden, input switched off) and forget every pointer. */
  reset(t: number): GestureEvent[] {
    this.out = [];
    const tt = Number.isFinite(t) ? Math.max(t, this.lastT) : this.lastT;
    this.lastT = tt;
    this.finish(tt, 'reset');
    this.down.clear();
    this.multi = false;
    return this.out;
  }
}

/** Screen position -> -1..1 across the element, x to the right, y UP (the way a camera and a head want it). Anything bad gives 0. */
export function normalizePointer(x: number, y: number, width: number, height: number): { x: number; y: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const nx = (x / width) * 2 - 1;
  const ny = 1 - (y / height) * 2;
  return { x: Math.min(1, Math.max(-1, nx)), y: Math.min(1, Math.max(-1, ny)) };
}
