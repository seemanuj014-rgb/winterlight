// Phase 25 (pure: no three, no DOM, no clock, no random): the rules of the birthday moment. The cake appears, a quiet beat to make a wish, then the candles go out one by one,
// either because she BLOWS (the detector in audio/blow.ts says how hard and for how long) or because she TAPS (always works). The machine knows nothing about the microphone:
// the act feeds it `setBlow(blowing, strength)`, and a tap is a tap. Same input, same result.

export const CANDLES = 5;

export const CAKE_TIMING = {
  /** the cake and table fade and rise into place */
  appear: 2.2,
  /** the quiet "make a wish" beat before the candles can be put out by a breath (the phase is `wish`) */
  wish: 3.6,
  /** a tap during the beat is ignored until the candles have been lit this long (a stray tap from the act before must not skip the wish) */
  tapAfter: 1.0,
  /** the hint shows this long after the beat, if nothing happened */
  hintAfter: 2.5,
  /** a candle takes this long to go from lit to out (a long breath of smoke); longer under reduced motion */
  dying: 0.55,
  dyingReduced: 1.0,
  /** seconds of breath for the first candle, then for each next one */
  needFirst: 0.35,
  perCandle: 0.3,
  /** breath effort drains at this rate (seconds per second) when not blowing */
  drain: 0.6,
  /** hold after the last flame before the act is done */
  holdAfter: 2.6,
} as const;

export type CakePhase = 'hidden' | 'appearing' | 'wish' | 'ready' | 'out' | 'done';
export type CandleState = 'lit' | 'dying' | 'out';
export type OutBy = 'blow' | 'tap';

export interface CakeEvent {
  at: number;
  type: 'begin' | 'wish' | 'ready' | 'candle' | 'out' | 'done';
  candle?: number;
  by?: OutBy;
  left?: number;
}

export interface CandleView {
  state: CandleState;
  /** 1 lit, easing to 0 as it dies */
  flame: number;
  /** 0..1 seconds-into-dying as a fraction; smoke wisp starts at 0 and the shader ages it */
  dyingFor: number;
  /** when it went out (machine seconds), or -1 */
  outAt: number;
  /** how hard the breath leans this flame, 0..1 */
  bend: number;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

export class CakeMachine {
  phase: CakePhase = 'hidden';
  readonly log: CakeEvent[] = [];
  private t = 0;
  private phaseT = 0;
  private candles: { state: CandleState; dyT: number; outAt: number }[] = Array.from({ length: CANDLES }, () => ({ state: 'lit', dyT: 0, outAt: -1 }));
  private effort = 0;
  private blowing = false;
  private strength = 0;
  private bendNow = 0;
  private firstOutAt = -1;
  private reducedMotion: boolean;
  private onEvent?: (e: CakeEvent) => void;

  constructor(opts: { reducedMotion?: boolean; onEvent?: (e: CakeEvent) => void } = {}) {
    this.reducedMotion = !!opts.reducedMotion;
    this.onEvent = opts.onEvent;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  private emit(e: Omit<CakeEvent, 'at'>): void {
    const ev: CakeEvent = { at: this.t, ...e };
    this.log.push(ev);
    if (this.log.length > 400) this.log.shift();
    try {
      this.onEvent?.(ev);
    } catch {
      /* a listener must not stop the act */
    }
  }

  private go(p: CakePhase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  /** start: the cake appears */
  begin(): void {
    if (this.phase !== 'hidden') return;
    this.go('appearing');
    this.emit({ type: 'begin' });
  }

  /** the breath, each frame: is somebody blowing, and how hard (0..1) */
  setBlow(blowing: boolean, strength: number): void {
    this.blowing = !!blowing;
    this.strength = clamp01(strength);
  }

  get litCount(): number {
    return this.candles.filter((c) => c.state === 'lit').length;
  }
  get outCount(): number {
    return this.candles.filter((c) => c.state !== 'lit').length;
  }
  /** index of the first candle still lit, or -1 */
  get nextLit(): number {
    return this.candles.findIndex((c) => c.state === 'lit');
  }

  private extinguish(i: number, by: OutBy): boolean {
    const c = this.candles[i];
    if (!c || c.state !== 'lit') return false;
    c.state = 'dying';
    c.dyT = 0;
    c.outAt = this.t;
    if (this.firstOutAt < 0) this.firstOutAt = this.t;
    this.emit({ type: 'candle', candle: i, by, left: this.litCount });
    if (this.litCount === 0) {
      this.go('out');
      this.emit({ type: 'out' });
    }
    return true;
  }

  /** A tap or key press. `candle` = a specific candle, or null / omitted = the next lit one (a tap on the cake itself, so a thumb never has to hit a wick). Returns true if a flame went out. */
  tap(candle: number | null = null): boolean {
    if (this.phase === 'hidden' || this.phase === 'appearing' || this.phase === 'out' || this.phase === 'done') return false;
    if (this.phase === 'wish') {
      if (this.phaseT < CAKE_TIMING.tapAfter) return false;
      this.go('ready');
      this.emit({ type: 'ready' });
    }
    const i = candle === null ? this.nextLit : candle;
    return this.extinguish(i, 'tap');
  }

  /** the cake's own fade-in, 0..1 */
  get appear(): number {
    if (this.phase === 'hidden') return 0;
    if (this.phase === 'appearing') return smooth(this.phaseT / CAKE_TIMING.appear);
    return 1;
  }

  /** how lit the scene is, 0..1: the share of flames still alight (the warm point light follows it) */
  get light(): number {
    return this.candles.reduce((s, c) => s + (c.state === 'lit' ? 1 : c.state === 'dying' ? Math.max(0, 1 - c.dyT / this.dyingTime()) : 0), 0) / CANDLES;
  }

  private dyingTime(): number {
    return this.reducedMotion ? CAKE_TIMING.dyingReduced : CAKE_TIMING.dying;
  }

  get candleViews(): CandleView[] {
    const dt = this.dyingTime();
    const lean = this.bendNow * (this.reducedMotion ? 0.4 : 1);
    const next = this.nextLit;
    return this.candles.map((c, i) => ({
      state: c.state,
      flame: c.state === 'lit' ? 1 : c.state === 'dying' ? Math.max(0, 1 - c.dyT / dt) : 0,
      dyingFor: c.state === 'lit' ? 0 : c.state === 'dying' ? clamp01(c.dyT / dt) : 1,
      outAt: c.outAt,
      bend: c.state === 'out' ? 0 : lean * (i === next ? 1 : 0.65),
    }));
  }

  /** 0..1: the quiet line ("make a wish"): in with the wish beat, gone once the first flame goes out */
  get line(): number {
    if (this.phase === 'wish') return smooth(this.phaseT / 0.9);
    if (this.phase === 'ready') return this.firstOutAt < 0 ? 1 : 1 - smooth((this.t - this.firstOutAt) / 0.8);
    return 0;
  }

  /** 0..1: the hint (how to blow it out), only while she has not yet put one out */
  get hint(): number {
    if (this.phase !== 'ready' || this.firstOutAt >= 0) return 0;
    return smooth((this.phaseT - CAKE_TIMING.hintAfter) / 1.2);
  }

  /** true from the moment the candle moment begins until the last flame is out: the microphone may be open */
  get micWanted(): boolean {
    return this.phase === 'ready';
  }

  update(dt: number): void {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 0;
    this.t += step;
    this.phaseT += step;
    // flames that are dying
    for (const c of this.candles) if (c.state === 'dying') {
      c.dyT += step;
      if (c.dyT >= this.dyingTime()) c.state = 'out';
    }
    // the lean of the flames toward the breath: quick up, slow down
    const target = this.phase === 'ready' && this.blowing ? this.strength : 0;
    const tau = target > this.bendNow ? 0.1 : 0.35;
    this.bendNow += (target - this.bendNow) * (1 - Math.exp(-step / tau));
    switch (this.phase) {
      case 'appearing':
        if (this.phaseT >= CAKE_TIMING.appear) {
          this.go('wish');
          this.emit({ type: 'wish' });
        }
        break;
      case 'wish':
        if (this.phaseT >= CAKE_TIMING.wish) {
          this.go('ready');
          this.emit({ type: 'ready' });
        }
        break;
      case 'ready': {
        if (this.blowing) this.effort += step * (0.7 + 0.7 * this.strength);
        else this.effort = Math.max(0, this.effort - step * CAKE_TIMING.drain);
        // candles go out one by one as the breath goes on: the first after `needFirst` seconds of effort, each next after `perCandle` more
        const T = CAKE_TIMING;
        const want = this.effort < T.needFirst ? 0 : 1 + Math.floor((this.effort - T.needFirst) / T.perCandle);
        while (this.phase === 'ready' && this.outCount < want) if (!this.extinguish(this.nextLit, 'blow')) break;
        break;
      }
      case 'out': {
        const lastOut = Math.max(...this.candles.map((c) => c.outAt));
        if (this.t - lastOut >= CAKE_TIMING.holdAfter) {
          this.go('done');
          this.emit({ type: 'done' });
        }
        break;
      }
      default:
        break;
    }
  }

  get time(): number {
    return this.t;
  }
}

/** `&blow=2-3.5,6-7` for the test view: a scripted breath in machine seconds, so a headless page can show the flames lean and go out without a microphone */
export function parseBlowScript(raw: string | null): [number, number][] {
  if (!raw) return [];
  const out: [number, number][] = [];
  for (const part of raw.split(',')) {
    const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(part.trim());
    if (m && Number(m[2]) > Number(m[1])) out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}
export function scriptedBlow(script: readonly [number, number][], t: number): boolean {
  return script.some(([a, b]) => t >= a && t < b);
}
