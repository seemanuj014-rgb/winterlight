import { LIMITER } from './audioMath';
import { createBeds, createPurr, makeWhiteBuffer, type Beds, type Loop } from './voices';

// Phase 23: the one place the mixing graph is built, so the live page and the offline render (the WAV the owner listens to) share exactly the same nodes.
//
//   voices -> sfx gain ----\
//   beds   -> bed gain ----+-> duck gain -> master gain -> limiter (compressor) -> destination
//
// Takes any BaseAudioContext. Nothing here starts a sound or reads a clock.

export interface Graph {
  readonly limiter: DynamicsCompressorNode;
  readonly master: GainNode;
  readonly duck: GainNode;
  readonly sfx: GainNode;
  readonly bedGain: GainNode;
  readonly beds: Beds;
  readonly purr: Loop;
  readonly white: AudioBuffer;
}

export interface GraphOptions {
  /** the master level before the limiter (0 when muted) */
  gain: number;
  /** reduced motion also means a calmer bed */
  reducedMotion?: boolean;
}

export function buildGraph(c: BaseAudioContext, o: GraphOptions): Graph {
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  limiter.connect(c.destination);
  const master = c.createGain();
  master.gain.value = o.gain;
  master.connect(limiter);
  const duck = c.createGain();
  duck.gain.value = 1;
  duck.connect(master);
  const sfx = c.createGain();
  sfx.gain.value = 1;
  sfx.connect(duck);
  const bedGain = c.createGain();
  bedGain.gain.value = o.reducedMotion ? 0.6 : 1;
  bedGain.connect(duck);
  const beds = createBeds(c, bedGain);
  const purr = createPurr(c, sfx);
  const white = makeWhiteBuffer(c, 0.5, 11);
  return { limiter, master, duck, sfx, bedGain, beds, purr, white };
}
