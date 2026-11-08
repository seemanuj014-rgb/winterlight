// Phase 25: telling a BLOW from speech, a clap, a hiss and a hum. Pure: no DOM, no Web Audio, no clock; it takes frames of samples and a frame length in seconds,
// so it is tested on synthetic buffers (tests/blow.test.ts) and fed by `mic.ts` in the page.
//
// What a blow looks like to a phone microphone (AU: "input level plus low-frequency energy"): loud for a moment, noise-like (NO pitch), with its energy piled up low
// (wind rumble, below about 500 Hz) and a medium zero-crossing rate, and it LASTS (a breath is a third of a second at least). Speech is pitched (voiced sounds repeat
// 80 to 300 times a second), an "s" or "sh" is high and hissy, a clap is one loud frame, a hum is low but a pure repeating tone. Four features, all `[A]`, tuned on
// synthetic signals only: the real microphone, the real breath and iOS are owner-device gaps.

export interface BlowFeatures {
  /** root-mean-square level of the frame, 0..1 */
  rms: number;
  /** share of the frame's energy below `LOW_CUT_HZ` (0..1) */
  low: number;
  /** zero crossings per second after removing the average */
  zcrHz: number;
  /** strongest repeat (normalised autocorrelation) at a pitch of 40..400 Hz, 0..1: speech and tones are high, breath is low */
  pitched: number;
}

export const LOW_CUT_HZ = 500;
export const PITCH_HZ = { min: 40, max: 400 } as const;

export const BLOW_DEFAULTS = {
  /** the quietest frame that can be a blow, whatever the room sounds like */
  gateRms: 0.02,
  /** and it must be this many times the room's own noise floor */
  floorTimes: 2.5,
  maxPitched: 0.45,
  minLow: 0.45,
  zcrHz: [150, 2600] as readonly [number, number],
  /** a blow must go on this long (seconds of breathy frames) to count as one */
  needS: 0.35,
  /** how fast the effort drains once the breath stops (seconds of effort per second) */
  drain: 1.5,
  /** how long the detector listens to the room before it can say anything */
  calibrateS: 0.4,
  /** rms above the gate at which strength reads 1 */
  strengthRange: 0.16,
  strengthTau: 0.12,
} as const;
export type BlowConfig = typeof BLOW_DEFAULTS;

const EMPTY: BlowFeatures = { rms: 0, low: 0, zcrHz: 0, pitched: 0 };

/** Measure one frame. Bad input (empty, NaN, a bad sample rate) reads as silence, never throws. */
export function analyseFrame(samples: ArrayLike<number>, sampleRate: number): BlowFeatures {
  const n = samples.length;
  if (!(n >= 64) || !Number.isFinite(sampleRate) || sampleRate < 4000) return { ...EMPTY };
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i]!;
    if (!Number.isFinite(v)) return { ...EMPTY };
    mean += v;
  }
  mean /= n;
  // energy, zero crossings, and the one-pole low-pass energy in one pass
  const a = 1 - Math.exp((-2 * Math.PI * LOW_CUT_HZ) / sampleRate);
  let e = 0, lpE = 0, lp = 0, cross = 0, prev = samples[0]! - mean;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = samples[i]! - mean;
    x[i] = v;
    e += v * v;
    lp += a * (v - lp);
    lpE += lp * lp;
    if ((v >= 0) !== (prev >= 0)) cross++;
    prev = v;
  }
  const rms = Math.sqrt(e / n);
  if (rms < 1e-6) return { ...EMPTY, rms };
  const low = Math.min(1, lpE / e);
  const zcrHz = (cross * sampleRate) / n; // sign changes per second
  // decimate to about 8 kHz by block averaging (also a gentle low-pass), then look for a repeat at 40..400 Hz
  const d = Math.max(1, Math.round(sampleRate / 8000));
  const m = Math.floor(n / d);
  const y = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let k = 0; k < d; k++) s += x[i * d + k]!;
    y[i] = s / d;
  }
  const fsd = sampleRate / d;
  const lagMin = Math.max(2, Math.floor(fsd / PITCH_HZ.max));
  const lagMax = Math.min(m - 8, Math.ceil(fsd / PITCH_HZ.min));
  let r0 = 0;
  for (let i = 0; i < m; i++) r0 += y[i]! * y[i]!;
  let best = 0;
  if (r0 > 1e-12 && lagMax > lagMin) {
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let s = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + lag < m; i++) {
        s += y[i]! * y[i + lag]!;
        e1 += y[i]! * y[i]!;
        e2 += y[i + lag]! * y[i + lag]!;
      }
      const r = s / (Math.sqrt(e1 * e2) + 1e-12);
      if (r > best) best = r;
    }
  }
  return { rms, low, zcrHz, pitched: Math.max(0, Math.min(1, best)) };
}

export interface BlowReading {
  /** this frame looks like breath */
  breathy: boolean;
  /** breath lasting at least `needS` right now */
  blowing: boolean;
  /** 0..1, how hard (smoothed level over the gate) while blowing, else easing to 0 */
  strength: number;
  /** seconds of breath in a row (drains when it stops) */
  effort: number;
  /** the room's noise level the detector settled on */
  floor: number;
  /** still listening to the room */
  calibrating: boolean;
}

/** Feed it features and the frame's length; it says whether somebody is blowing. Deterministic. */
export class BlowDetector {
  private cfg: BlowConfig;
  private t = 0;
  private floorSum = 0;
  private floorN = 0;
  private floor = 0;
  private effort = 0;
  private strength = 0;
  constructor(cfg: Partial<BlowConfig> = {}) {
    this.cfg = { ...BLOW_DEFAULTS, ...cfg };
  }
  reset(): void {
    this.t = 0; this.floorSum = 0; this.floorN = 0; this.floor = 0; this.effort = 0; this.strength = 0;
  }
  push(f: BlowFeatures, dt: number): BlowReading {
    const c = this.cfg;
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 0;
    const rms = Number.isFinite(f.rms) ? Math.max(0, f.rms) : 0;
    this.t += step;
    const calibrating = this.t < c.calibrateS;
    if (calibrating) {
      // the room before anyone blows: nothing counts yet
      this.floorSum += rms * step;
      this.floorN += step;
      this.floor = this.floorN > 0 ? this.floorSum / this.floorN : 0;
      this.strength = 0;
      return { breathy: false, blowing: false, strength: 0, effort: 0, floor: this.floor, calibrating: true };
    }
    const gate = Math.max(c.gateRms, this.floor * c.floorTimes);
    const breathy =
      rms >= gate && f.pitched <= c.maxPitched && f.low >= c.minLow && f.zcrHz >= c.zcrHz[0] && f.zcrHz <= c.zcrHz[1];
    if (breathy) this.effort += step;
    else this.effort = Math.max(0, this.effort - step * c.drain);
    // the room's floor follows slow changes, only from frames that are quiet and not breath
    if (!breathy && rms < gate) this.floor += (rms - this.floor) * Math.min(1, step * 0.8);
    const blowing = this.effort >= c.needS;
    const target = blowing ? Math.max(0, Math.min(1, (rms - gate) / c.strengthRange)) : 0;
    const k = 1 - Math.exp(-step / c.strengthTau);
    this.strength += (target - this.strength) * k;
    return { breathy, blowing, strength: this.strength, effort: this.effort, floor: this.floor, calibrating: false };
  }
}
