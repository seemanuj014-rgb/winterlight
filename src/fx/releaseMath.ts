// Phase 26: the release as a small machine. Pure (no three, no DOM, no clock, no random): it is told how much time passed and says what just happened.
//
//   idle  --start()-->  hush (RELEASE.hushS of quiet)  -->  release (the burst, the lanterns let go one by one)  -->  done (the last lantern is gone, the sky is empty)
//
// It emits three events, each ONCE and in order, however big a step was (a phone that slept still gets all three, in order):
//   `start`  at 0                       the sound hushes
//   `burst`  at RELEASE.hushS           the glitter bursts, the first lantern lets go, the sound swells
//   `done`   at releaseEndS()           Phase 27's letter may begin
// Reduced motion does not change the clock: the lanterns' own maths climbs slower and flickers not at all (`lanternPose`), and the beat's length stays the same, so the
// hush, the burst and the end are where the sound and the owner's eyes expect them. Everything numeric is `[A]`.

import { RELEASE, releaseEndS } from './lanternMath';

export type ReleasePhase = 'idle' | 'hush' | 'release' | 'done';
export type ReleaseEventType = 'start' | 'burst' | 'done';

export interface ReleaseEvent {
  type: ReleaseEventType;
  /** the machine's own time when it happened (seconds after start) */
  at: number;
}

export interface ReleaseOptions {
  onEvent?: (e: ReleaseEvent) => void;
}

/** a frame longer than this counts as this long (a stalled tab must not skip the beat), as in the other machines */
export const RELEASE_MAX_DT = 0.25;
/** after the end the clock holds here (the sky is empty; nothing moves) */
export const releaseHoldS = (): number => releaseEndS() + 1;

export class ReleaseMachine {
  private p: ReleasePhase = 'idle';
  private t = 0;
  private fired = { start: false, burst: false, done: false };
  readonly log: ReleaseEvent[] = [];
  private readonly onEvent: (e: ReleaseEvent) => void;

  constructor(o: ReleaseOptions = {}) {
    this.onEvent = o.onEvent ?? (() => undefined);
  }

  get phase(): ReleasePhase {
    return this.p;
  }
  /** seconds since `start()` (0 before it); holds at the end */
  get time(): number {
    return this.t;
  }
  get started(): boolean {
    return this.p !== 'idle';
  }
  get finished(): boolean {
    return this.p === 'done';
  }

  /** Begin. A second call does nothing (the release happens once). */
  start(): void {
    if (this.p !== 'idle') return;
    this.p = 'hush';
    this.t = 0;
    this.fire('start');
  }

  /** One step. Bad, negative or zero `dt` does nothing; a huge one counts as RELEASE_MAX_DT. Before `start()` nothing happens. */
  step(dt: number): void {
    if (this.p === 'idle' || this.p === 'done') return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.t = Math.min(releaseHoldS(), this.t + Math.min(RELEASE_MAX_DT, dt));
    this.settle();
  }

  private settle(): void {
    if (!this.fired.burst && this.t >= RELEASE.hushS) {
      this.p = 'release';
      this.fire('burst');
    }
    if (!this.fired.done && this.t >= releaseEndS()) {
      this.p = 'done';
      this.fire('done');
    }
  }

  private fire(type: ReleaseEventType): void {
    if (this.fired[type]) return;
    this.fired[type] = true;
    const e: ReleaseEvent = { type, at: Number(this.t.toFixed(3)) };
    if (this.log.length < 400) this.log.push(e);
    try {
      this.onEvent(e);
    } catch {
      /* a listener must never stop the release */
    }
  }
}
