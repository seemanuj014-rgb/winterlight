import { CHIME, PAD_CHORDS, PURR, SWELL, TINE, makeRng, midiToHz, scaleMidi, swellLevel, swellPartials, swellSeconds, windAt, type Footstep, type Mood, type NoteEvent } from './audioMath';

// Phase 23: the sounds themselves, as small functions that take ANY BaseAudioContext (live or offline), so the same code that plays in the page
// can be rendered to a WAV in the sandbox for the owner to listen to. No file is loaded; every sound is made of oscillators and noise.
// Nothing here reads the clock or Math.random: the caller gives the start time, and the noise comes from a seeded generator.

const EPS = 0.0001;

/** A buffer of soft noise (a brown-ish walk, scaled), seeded so it is the same every time. */
export function makeNoiseBuffer(ctx: BaseAudioContext, seconds = 2, seed = 7): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rng = makeRng(seed);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    last = (last + 0.04 * white) / 1.04; // brown-ish: soft and low, like wind
    d[i] = last * 3.2;
  }
  // make the loop seamless: fade the last 2000 samples toward the first value
  const fade = Math.min(2000, Math.floor(n / 4));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[n - fade + i] = d[n - fade + i]! * (1 - k) + d[i]! * k;
  }
  return buf;
}

/** A plain white-ish buffer for the crunch of a step (the brown one is too dull). */
export function makeWhiteBuffer(ctx: BaseAudioContext, seconds = 0.5, seed = 11): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) d[i] = rng() * 2 - 1;
  return buf;
}

function envelope(g: GainNode, t: number, attack: number, peak: number, dur: number): void {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(EPS, t + Math.max(attack + 0.05, dur));
}

/** A star chime: a sine and a faint octave, rung once and let go. */
export function ringChime(ctx: BaseAudioContext, dest: AudioNode, ev: NoteEvent): void {
  const t = ev.at;
  const hz = midiToHz(ev.midi);
  const g = ctx.createGain();
  g.connect(dest);
  envelope(g, t, CHIME.attack, ev.gain, ev.dur);
  const o1 = ctx.createOscillator();
  o1.type = 'sine';
  o1.frequency.setValueAtTime(hz, t);
  o1.connect(g);
  const og = ctx.createGain();
  og.gain.setValueAtTime(CHIME.octaveGain, t);
  og.gain.exponentialRampToValueAtTime(EPS, t + ev.dur * 0.5);
  og.connect(g);
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(hz * 2, t);
  o2.connect(og);
  const end = t + ev.dur + 0.1;
  o1.start(t);
  o2.start(t);
  o1.stop(end);
  o2.stop(end);
}

/** A music-box tine: a bright pure tone with a short-lived inharmonic partial on top (the "plink"). */
export function ringTine(ctx: BaseAudioContext, dest: AudioNode, ev: NoteEvent): void {
  const t = ev.at;
  const hz = midiToHz(ev.midi);
  const g = ctx.createGain();
  g.connect(dest);
  envelope(g, t, TINE.attack, ev.gain, ev.dur);
  const o1 = ctx.createOscillator();
  o1.type = 'sine';
  o1.frequency.setValueAtTime(hz, t);
  o1.connect(g);
  const pg = ctx.createGain();
  pg.gain.setValueAtTime(TINE.partialGain, t);
  pg.gain.exponentialRampToValueAtTime(EPS, t + Math.min(0.35, ev.dur * 0.4));
  pg.connect(g);
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(hz * TINE.partial, t);
  o2.connect(pg);
  const end = t + ev.dur + 0.1;
  o1.start(t);
  o2.start(t);
  o1.stop(end);
  o2.stop(end);
}

/** One soft step in snow: a short burst of noise through a band-pass, with a quick fall. */
export function playStep(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, t: number, s: Footstep): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(s.freq, t);
  bp.Q.setValueAtTime(0.9, t);
  const g = ctx.createGain();
  envelope(g, t, 0.008, s.gain, s.dur);
  let tail: AudioNode = g;
  src.connect(bp);
  bp.connect(g);
  if (typeof (ctx as BaseAudioContext).createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(s.pan, t);
    g.connect(p);
    tail = p;
  }
  tail.connect(dest);
  src.start(t, 0);
  src.stop(t + s.dur + 0.05);
}

/** Phase 25: a candle puffed out: noise through a wide, low band-pass with a soft rise (a breath, not a tap). */
export function playPuff(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, t: number, s: Footstep): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(s.freq, t);
  bp.Q.setValueAtTime(0.5, t);
  const g = ctx.createGain();
  envelope(g, t, 0.03, s.gain, s.dur);
  let tail: AudioNode = g;
  src.connect(bp);
  bp.connect(g);
  if (typeof (ctx as BaseAudioContext).createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(s.pan, t);
    g.connect(p);
    tail = p;
  }
  tail.connect(dest);
  src.start(t, 0);
  src.stop(t + s.dur + 0.05);
}

/**
 * Phase 26: the swell as the lanterns let go. A few soft sines (the cool chord an octave up) that fade in together, hold and fade out slowly: one shared envelope that follows
 * `swellLevel`, each partial arriving a little after the one below it. Then one quiet high chime near the top. Oscillators only; nothing is loaded.
 */
export function playSwell(ctx: BaseAudioContext, dest: AudioNode, t: number): void {
  const total = swellSeconds();
  const g = ctx.createGain();
  g.connect(dest);
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0, t);
  // follow the pure curve with enough breakpoints that the line is smooth (every 0.25 s)
  for (let s = 0.25; s <= total + 0.001; s += 0.25) g.gain.linearRampToValueAtTime(swellLevel(s), t + s);
  g.gain.linearRampToValueAtTime(0, t + total + 0.1);
  for (const p of swellPartials()) {
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0, t);
    pg.gain.setValueAtTime(0, t + p.at);
    pg.gain.linearRampToValueAtTime(p.gain, t + p.at + 1.2);
    pg.connect(g);
    for (const detune of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(midiToHz(p.midi), t);
      o.detune.setValueAtTime(detune, t);
      o.connect(pg);
      o.start(t);
      o.stop(t + total + 0.2);
    }
  }
  ringChime(ctx, dest, { at: t + SWELL.chimeAt, midi: scaleMidi(SWELL.chimeIndex) + 12, dur: 3, gain: SWELL.chimeGain });
}

export interface Loop {
  /** fade in over `fade` seconds */
  start(t: number, fade?: number): void;
  /** fade out then stop */
  stop(t: number, fade?: number): void;
  readonly playing: boolean;
}

/** The cat's purr: a low oscillator whose loudness pulses about 25 times a second. */
export function createPurr(ctx: BaseAudioContext, dest: AudioNode): Loop {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  const pulse = ctx.createGain();
  pulse.gain.value = 0.5;
  pulse.connect(out);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = PURR.baseHz;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  o.connect(lp);
  lp.connect(pulse);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = PURR.pulseHz;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth);
  depth.connect(pulse.gain);
  let started = false;
  let playing = false;
  return {
    start(t, fade = PURR.fadeIn) {
      if (!started) {
        o.start(t);
        lfo.start(t);
        started = true;
      }
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(PURR.gain, t + fade);
      playing = true;
    },
    stop(t, fade = PURR.fadeOut) {
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + fade);
      playing = false;
    },
    get playing() {
      return playing;
    },
  };
}

export interface Beds {
  setMood(mood: Mood, t: number): void;
  /** call now and then (a few times a second is plenty) to let the wind breathe */
  breathe(t: number): void;
  start(t: number, fade?: number): void;
  stop(t: number): void;
}

/** The two beds under everything: wind with a snow hush over it, and a low two-chord pad that follows the act. */
export function createBeds(ctx: BaseAudioContext, dest: AudioNode): Beds {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);

  // wind: brown noise through a moving band-pass
  const noise = makeNoiseBuffer(ctx, 4, 7);
  const wind = ctx.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const wbp = ctx.createBiquadFilter();
  wbp.type = 'bandpass';
  wbp.Q.value = 0.6;
  const wg = ctx.createGain();
  wg.gain.value = 0.08;
  wind.connect(wbp);
  wbp.connect(wg);
  wg.connect(out);

  // snow hush: the same noise, high and very quiet
  const hush = ctx.createBufferSource();
  hush.buffer = noise;
  hush.loop = true;
  hush.playbackRate.value = 1.7;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3200;
  const hg = ctx.createGain();
  hg.gain.value = 0.012;
  hush.connect(hp);
  hp.connect(hg);
  hg.connect(out);

  // pad: three soft sines per mood, only the current mood is audible
  const padOut = ctx.createGain();
  padOut.gain.value = 0.5;
  const plp = ctx.createBiquadFilter();
  plp.type = 'lowpass';
  plp.frequency.value = 700;
  padOut.connect(plp);
  plp.connect(out);
  const moods = {} as Record<Mood, GainNode>;
  const oscs: OscillatorNode[] = [];
  for (const m of Object.keys(PAD_CHORDS) as Mood[]) {
    const mg = ctx.createGain();
    mg.gain.value = 0;
    mg.connect(padOut);
    moods[m] = mg;
    PAD_CHORDS[m].forEach((midi, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midiToHz(midi);
      o.detune.value = (i - 1) * 4; // a few cents apart, so the chord shimmers a little
      const og = ctx.createGain();
      og.gain.value = 0.045;
      o.connect(og);
      og.connect(mg);
      oscs.push(o);
    });
  }

  let started = false;
  let mood: Mood = 'cool';
  return {
    setMood(m, t) {
      mood = m;
      for (const k of Object.keys(moods) as Mood[]) {
        moods[k].gain.cancelScheduledValues(t);
        moods[k].gain.setTargetAtTime(k === m ? 1 : 0, t, 2.5);
      }
    },
    breathe(t) {
      const w = windAt(t);
      wbp.frequency.setTargetAtTime(w.freq, t, 1.5);
      wg.gain.setTargetAtTime(w.gain, t, 1.5);
    },
    start(t, fade = 3) {
      if (!started) {
        wind.start(t);
        hush.start(t);
        oscs.forEach((o) => o.start(t));
        started = true;
        moods[mood].gain.setValueAtTime(1, t);
      }
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(1, t + fade);
    },
    stop(t) {
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.5);
    },
  };
}
