// Phase 23: all the sound maths. Pure (no Web Audio, no DOM, no clock, no Math.random): every function takes its inputs and gives the same answer.
// The Web Audio side (engine.ts, voices.ts) only turns these numbers into nodes, so the notes, the timing and the mixing can be tested without a speaker.
// `[A]` marks a number that is mine, to be tuned by ear by the owner.

// ---- notes: ONE scale for everything ------------------------------------------------------------------------------------------------------

/** MIDI note 69 is A4 = 440 Hz. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** C major pentatonic (C D E G A): any note over any other sounds fine, so the order a star is touched in never makes a wrong note. */
export const PENTATONIC = [0, 2, 4, 7, 9] as const;
/** `[A]` the chimes live from C5 up two octaves; low enough to be soft, high enough to read as ice. */
export const SCALE_ROOT_MIDI = 72;
export const SCALE_SPAN = PENTATONIC.length * 2; // two octaves: indices 0..9

/** Degree index (any integer, wraps over octaves) to MIDI note. Index 0 = C5, 5 = C6. */
export function scaleMidi(index: number): number {
  const i = Math.trunc(Number.isFinite(index) ? index : 0);
  const octave = Math.floor(i / PENTATONIC.length);
  const degree = ((i % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  return SCALE_ROOT_MIDI + 12 * octave + PENTATONIC[degree]!;
}

export function isInScale(midi: number): boolean {
  const pc = (((Math.round(midi) - SCALE_ROOT_MIDI) % 12) + 12) % 12;
  return (PENTATONIC as readonly number[]).includes(pc);
}

/** A small stable hash (FNV-1a) so the same star always has the same voice. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The note for a line that joins into star `starId`: always in the scale, within the two octaves. */
export function chimeIndexForStar(starId: string): number {
  return hashString(starId) % SCALE_SPAN;
}

/**
 * The note for the n-th line of a shape (0-based): walks up the scale a step at a time, so drawing a whole shape sounds like a small rising run,
 * and the five shapes start from different places so they do not all sound alike. `[A]`
 */
export function chimeIndexForLine(shapeId: string, line: number): number {
  const start = hashString(shapeId) % PENTATONIC.length;
  const n = Math.max(0, Math.trunc(Number.isFinite(line) ? line : 0));
  return (start + n) % SCALE_SPAN;
}

export interface NoteEvent {
  /** seconds from the start of the phrase */
  at: number;
  midi: number;
  /** seconds the note is allowed to ring */
  dur: number;
  /** 0..1, before the master */
  gain: number;
}

/** The short phrase when a constellation is finished: a slow rising arpeggio of the scale ending on the top note. `[A]` */
export function completionPhrase(): NoteEvent[] {
  const degrees = [0, 2, 4, 5, 7];
  return degrees.map((d, i) => ({ at: i * 0.17, midi: scaleMidi(d), dur: i === degrees.length - 1 ? 2.4 : 1.1, gain: i === degrees.length - 1 ? 0.5 : 0.36 }));
}

// ---- the music box: "Happy Birthday to You" (the tune is public domain) ----------------------------------------------------------------------

export interface MelodyNote {
  midi: number;
  /** length in quarter-note beats */
  beats: number;
}

// G4 A4 B4 C5 D5 E5 F5 G5
const G4 = 67, A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79;

/** Four lines of six beats (two bars of 3/4), in C major, starting on the first "Hap-". The words are not here; the tune is. */
export const BIRTHDAY_MELODY: readonly MelodyNote[] = [
  // line 1: Hap-py birth-day to you
  { midi: G4, beats: 0.75 }, { midi: G4, beats: 0.25 }, { midi: A4, beats: 1 }, { midi: G4, beats: 1 }, { midi: C5, beats: 1 }, { midi: B4, beats: 2 },
  // line 2: Hap-py birth-day to you
  { midi: G4, beats: 0.75 }, { midi: G4, beats: 0.25 }, { midi: A4, beats: 1 }, { midi: G4, beats: 1 }, { midi: D5, beats: 1 }, { midi: C5, beats: 2 },
  // line 3: Hap-py birth-day dear (name)
  { midi: G4, beats: 0.75 }, { midi: G4, beats: 0.25 }, { midi: G5, beats: 1 }, { midi: E5, beats: 1 }, { midi: C5, beats: 1 }, { midi: B4, beats: 1 }, { midi: A4, beats: 1 },
  // line 4: Hap-py birth-day to you
  { midi: F5, beats: 0.75 }, { midi: F5, beats: 0.25 }, { midi: E5, beats: 1 }, { midi: C5, beats: 1 }, { midi: D5, beats: 1 }, { midi: C5, beats: 2 },
];

export const MELODY_BEATS = BIRTHDAY_MELODY.reduce((s, n) => s + n.beats, 0);
/** `[A]` slow and sleepy, quarter notes at 72 per minute */
export const MUSIC_BOX_BPM = 72;

/** The melody laid out in seconds. Each note rings a little past its length and overlaps the next ones (a music box tine does), capped at 2.2 s. */
export function melodyEvents(bpm = MUSIC_BOX_BPM, melody: readonly MelodyNote[] = BIRTHDAY_MELODY): NoteEvent[] {
  const spb = 60 / Math.max(20, Math.min(240, Number.isFinite(bpm) ? bpm : MUSIC_BOX_BPM));
  const out: NoteEvent[] = [];
  let t = 0;
  for (const n of melody) {
    out.push({ at: t, midi: n.midi, dur: Math.min(2.2, n.beats * spb * 1.6 + 0.5), gain: n.beats >= 2 ? 0.5 : 0.42 });
    t += n.beats * spb;
  }
  return out;
}

export function melodySeconds(bpm = MUSIC_BOX_BPM): number {
  const ev = melodyEvents(bpm);
  const last = ev[ev.length - 1];
  return last ? last.at + last.dur : 0;
}

// ---- scheduling ahead -------------------------------------------------------------------------------------------------------------------------

export interface Timed {
  at: number;
}

/**
 * Look-ahead scheduling: the page cannot be trusted to wake up on time (a busy frame, a background tab), so notes are handed to the audio clock a little early.
 * `pump(now)` returns every event whose time is inside [now, now + lookahead), each exactly once and in order. An event already in the past is returned too,
 * once, flagged late (the caller plays it at "now" or drops it, see `LATE_DROP_S`).
 */
export class LookaheadQueue<T extends Timed> {
  private pending: T[] = [];
  constructor(readonly lookahead = 0.25) {}
  push(events: readonly T[]): void {
    this.pending.push(...events);
    this.pending.sort((a, b) => a.at - b.at);
  }
  clear(): void {
    this.pending = [];
  }
  get size(): number {
    return this.pending.length;
  }
  pump(now: number): { event: T; late: boolean }[] {
    const out: { event: T; late: boolean }[] = [];
    if (!Number.isFinite(now)) return out;
    while (this.pending.length > 0 && this.pending[0]!.at < now + this.lookahead) {
      const e = this.pending.shift()!;
      out.push({ event: e, late: e.at < now });
    }
    return out;
  }
}

/** A note later than this when it is finally handed over is dropped, not blurted out (a phone that slept through half a tune should not play it all at once). */
export const LATE_DROP_S = 0.4;

/** Shift a phrase (times from 0) to start at `start` on the audio clock. */
export function placePhrase(events: readonly NoteEvent[], start: number): NoteEvent[] {
  return events.map((e) => ({ ...e, at: e.at + start }));
}

// ---- the mix ----------------------------------------------------------------------------------------------------------------------------------

/** `[A]` she starts quiet: the master is at 0.2 of full (was 0.3; the first real render peaked at -7 dBFS, too loud for "quiet") and the limiter sits above it. The viewer's own volume is the real loudness. */
export const MASTER_DEFAULT = 0.2;
export const MASTER_MAX = 0.6;

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return MASTER_DEFAULT;
  return Math.min(MASTER_MAX, Math.max(0, v));
}

/** Limiter settings for a DynamicsCompressorNode used as a brick-ish wall. `[A]` */
export const LIMITER = { threshold: -14, knee: 0, ratio: 20, attack: 0.003, release: 0.25 } as const;

export type DuckReason = 'wish' | 'letter' | 'finale' | 'hush';
/** How far the beds and effects drop under each reason (0..1 of normal). `[A]` */
export const DUCK_LEVEL: Record<DuckReason, number> = { wish: 0.45, letter: 0.3, finale: 1, hush: 0.35 };

/** The one level for the beds: the lowest of the reasons that are on (they do not stack into silence). */
export function duckTarget(on: Iterable<DuckReason>): number {
  let level = 1;
  for (const r of on) level = Math.min(level, DUCK_LEVEL[r] ?? 1);
  return level;
}

/** One-pole smoothing toward a target; frame-rate independent; never overshoots; bad input is ignored. */
export function smoothToward(current: number, target: number, dt: number, tau: number): number {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target) || !Number.isFinite(dt) || dt <= 0) return current;
  if (!(tau > 0)) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Time constants (seconds) for setTargetAtTime: ducking goes down fast and comes back slowly. `[A]` */
export const DUCK_ATTACK_S = 0.25;
export const DUCK_RELEASE_S = 1.2;
export const MUTE_FADE_S = 0.08;

// ---- the beds ---------------------------------------------------------------------------------------------------------------------------------

export type Mood = 'cool' | 'warm';

/** Pad chords (MIDI), two soft sines each. Cool = open fifth over D (the meadow), warm = a rounder C (the nook). `[A]` */
export const PAD_CHORDS: Record<Mood, readonly number[]> = {
  cool: [50, 57, 62],
  warm: [48, 55, 64],
};

/** Which mood an act wants. Act 1 is the nook (warm); the meadow and sky are cool. */
export function moodForAct(act: number): Mood {
  return act === 1 ? 'warm' : 'cool';
}

/** Wind: noise through a low band, its loudness and pitch breathing slowly. Returns the filter centre (Hz) and gain at time t. `[A]` */
export function windAt(t: number): { freq: number; gain: number } {
  const x = Number.isFinite(t) ? t : 0;
  const slow = Math.sin(x * 2 * Math.PI * 0.07) * 0.5 + 0.5; // about 14 s a swell
  const slower = Math.sin(x * 2 * Math.PI * 0.023 + 1.3) * 0.5 + 0.5; // about 43 s
  return { freq: 260 + 340 * slow, gain: 0.05 + 0.07 * (0.6 * slow + 0.4 * slower) };
}

// ---- details ----------------------------------------------------------------------------------------------------------------------------------

/** A small deterministic generator (mulberry32) for the footsteps, so a test can replay them. */
export function makeRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

export interface Footstep {
  /** band-pass centre of the crunch (Hz) */
  freq: number;
  /** seconds */
  dur: number;
  gain: number;
  /** stereo position -1..1 */
  pan: number;
}

/** One soft step in snow: a short filtered noise burst. No two the same. `[A]` */
export function footstep(rng: () => number): Footstep {
  const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
  return { freq: 700 + 900 * r1, dur: 0.1 + 0.08 * r2, gain: 0.12 + 0.06 * r3, pan: (r4 - 0.5) * 0.4 };
}

/** Phase 25: one candle going out: a short, soft breath of noise (lower and longer than a step). `[A]` */
export function candlePuff(rng: () => number): Footstep {
  const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
  return { freq: 380 + 420 * r1, dur: 0.2 + 0.12 * r2, gain: 0.1 + 0.05 * r3, pan: (r4 - 0.5) * 0.6 };
}

// ---- Phase 26: the release (a hush, then a swell as the lanterns let go) ----------------------------------------------------------------------

/**
 * The hush before the lanterns lasts this long. `fx/lanternMath.ts` owns the real number (`RELEASE.hushS`); audio may not import fx, so a test pins the two together. `[A]`
 */
export const RELEASE_HUSH_S = 1.4;

/**
 * The swell when the lanterns let go: a soft pad that rises, holds and fades, the cool chord an octave up (so it opens above the beds, not on them), plus one high chime at the top.
 * It is NOT a new melody: only chord notes of the beds and one note of the star scale. `[A]`
 */
export const SWELL = { riseS: 2.4, holdS: 1.2, fallS: 4.4, peak: 0.09, shimmerGain: 0.3, chimeAt: 1.9, chimeIndex: 7, chimeGain: 0.2 } as const;

export interface SwellPartial {
  midi: number;
  /** relative loudness of this partial (0..1) */
  gain: number;
  /** seconds after the start that this partial begins (they come in one by one, low to high, like a breath opening) */
  at: number;
}

/** The partials of the swell: the cool pad chord an octave up, then a fifth above the top as a faint shimmer. Every note is a chord note of the beds. */
export function swellPartials(): SwellPartial[] {
  const chord = PAD_CHORDS.cool.map((m) => m + 12);
  const out: SwellPartial[] = chord.map((midi, i) => ({ midi, gain: 1 - i * 0.12, at: i * 0.35 }));
  out.push({ midi: chord[chord.length - 1]! + 7, gain: SWELL.shimmerGain, at: 1.1 });
  return out;
}

export const swellSeconds = (): number => SWELL.riseS + SWELL.holdS + SWELL.fallS;

/** The swell's loudness at `t` seconds after it starts (0..SWELL.peak): a smooth rise, a hold, a long fall. Pure, so it is tested and the voice follows its breakpoints. */
export function swellLevel(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  const ease = (k: number): number => k * k * (3 - 2 * k);
  if (t < SWELL.riseS) return SWELL.peak * ease(t / SWELL.riseS);
  if (t < SWELL.riseS + SWELL.holdS) return SWELL.peak;
  const k = (t - SWELL.riseS - SWELL.holdS) / SWELL.fallS;
  return k >= 1 ? 0 : SWELL.peak * (1 - ease(k));
}

/** The purr: a low oscillator whose loudness is cut by a slow pulse (about 25 per second, as a cat's is). `[A]` */
export const PURR = { baseHz: 52, pulseHz: 25, gain: 0.07, fadeIn: 1.2, fadeOut: 1.6 } as const;

/** A music-box tine: a pure tone plus a quiet inharmonic partial that dies faster. Ratios and levels `[A]`. */
export const TINE = { partial: 2.76, partialGain: 0.22, attack: 0.004 } as const;

/** A star chime: a sine with a faint octave above it, rung and let go. `[A]` */
export const CHIME = { octaveGain: 0.18, attack: 0.006 } as const;

// ---- the unlock rules (iOS) ------------------------------------------------------------------------------------------------------------------

export type AudioState = 'locked' | 'running' | 'suspended' | 'unsupported';
export type AudioEvent = 'gesture' | 'ctx-running' | 'ctx-suspended' | 'hidden' | 'visible' | 'no-api';

/**
 * Before her first touch there is silence and no context. A touch builds and resumes it. A browser (or a phone call) may suspend it later; coming back to
 * the page tries again, and any later touch tries again. A browser with no Web Audio stays `unsupported` for good and everything is a quiet no-op.
 */
export function nextAudioState(s: AudioState, e: AudioEvent): AudioState {
  if (e === 'no-api') return 'unsupported';
  if (s === 'unsupported') return 'unsupported';
  switch (e) {
    case 'gesture':
      return s === 'locked' ? 'locked' : s; // the engine builds the context on a gesture; the state changes when the context reports back
    case 'ctx-running':
      return 'running';
    case 'ctx-suspended':
      return s === 'locked' ? 'locked' : 'suspended';
    case 'hidden':
      return s === 'running' ? 'suspended' : s;
    case 'visible':
      return s;
  }
}

/** Whether, on this event, the engine should call `ctx.resume()`. */
export function shouldResume(s: AudioState, e: AudioEvent): boolean {
  if (s === 'unsupported') return false;
  return e === 'gesture' || (e === 'visible' && s === 'suspended');
}

// ---- the mute switch --------------------------------------------------------------------------------------------------------------------------

export const MUTE_KEY = 'winterlight.muted';

/** Saved value to boolean. Anything unexpected means "not muted" (the card starts quiet anyway). */
export function parseMuted(raw: string | null | undefined): boolean {
  return raw === '1';
}
export function serializeMuted(muted: boolean): string {
  return muted ? '1' : '0';
}
