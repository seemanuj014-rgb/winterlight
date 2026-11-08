import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  BIRTHDAY_MELODY, DUCK_LEVEL, LATE_DROP_S, LIMITER, LookaheadQueue, MASTER_DEFAULT, MASTER_MAX, MELODY_BEATS, MUSIC_BOX_BPM, MUTE_KEY, PAD_CHORDS, PENTATONIC, PURR,
  SCALE_ROOT_MIDI, SCALE_SPAN, chimeIndexForLine, chimeIndexForStar, clampVolume, completionPhrase, duckTarget, footstep, hashString, isInScale, makeRng, melodyEvents,
  melodySeconds, midiToHz, moodForAct, nextAudioState, parseMuted, placePhrase, scaleMidi, serializeMuted, shouldResume, smoothToward, windAt,
  type AudioEvent, type AudioState, type DuckReason,
} from '../src/audio/audioMath';
import { createAudioEngine } from '../src/audio/engine';
import { buildGraph } from '../src/audio/graph';
import { createMuteButton, MUTE_LABELS } from '../src/audio/muteButton';
import { RENDER_NAMES, peakOf, planFor, renderSound, toDb, toPcm16, wavBytes, type RenderName } from '../src/audio/render';
import { createBus, type WinterEvents } from '../src/state/events';

// Phase 23: the sound maths, the unlock rules, the engine (against a fake AudioContext, so no speaker is needed) and the offline render plans.
// What this cannot show: how any of it SOUNDS. That is the WAV render (tools/render_music_box.py) and, for the real thing, her phone.

const approx = (a: number, b: number, d = 6): void => expect(a).toBeCloseTo(b, d);

// ---- notes: one scale -----------------------------------------------------------------------------------------------------------------------

describe('notes and the one scale', () => {
  it('midiToHz: A4 is 440, an octave doubles, middle C is 261.63', () => {
    approx(midiToHz(69), 440);
    approx(midiToHz(81), 880);
    approx(midiToHz(57), 220);
    approx(midiToHz(60), 261.6256, 3);
  });

  it('the scale is C major pentatonic from C5 over two octaves', () => {
    expect(PENTATONIC).toEqual([0, 2, 4, 7, 9]);
    expect(SCALE_ROOT_MIDI).toBe(72);
    expect(SCALE_SPAN).toBe(10);
    expect([...Array(10).keys()].map(scaleMidi)).toEqual([72, 74, 76, 79, 81, 84, 86, 88, 91, 93]);
  });

  it('scaleMidi wraps over octaves and survives bad input', () => {
    expect(scaleMidi(10)).toBe(96);
    expect(scaleMidi(-1)).toBe(69); // A4: one degree under C5
    expect(scaleMidi(-5)).toBe(60);
    expect(scaleMidi(NaN)).toBe(72);
    expect(scaleMidi(Infinity)).toBe(72);
    expect(scaleMidi(2.9)).toBe(76); // truncated
  });

  it('isInScale: every scale note is in it, a note between is not, at any octave', () => {
    for (let i = -20; i < 40; i++) expect(isInScale(scaleMidi(i))).toBe(true);
    for (const m of [73, 75, 77, 78, 80, 82, 83]) expect(isInScale(m)).toBe(false);
    expect(isInScale(60)).toBe(true);
  });

  it('hashString is stable and spreads', () => {
    expect(hashString('rose')).toBe(hashString('rose'));
    expect(hashString('rose')).not.toBe(hashString('bumblebee'));
    expect(hashString('')).toBe(0x811c9dc5);
  });

  it('a star always has the same note, and it is always in the scale and in range', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const idx = chimeIndexForStar(`star-${i}`);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(SCALE_SPAN);
      expect(isInScale(scaleMidi(idx))).toBe(true);
      expect(chimeIndexForStar(`star-${i}`)).toBe(idx);
      seen.add(idx);
    }
    expect(seen.size).toBe(SCALE_SPAN); // all ten notes are used
  });

  it('the note for a line walks up the scale a step at a time, in the scale, for every shape and any line number', () => {
    const shapes = ['strawberry', 'bumblebee', 'rose', 'kaaju-katli', 'cutie-patootie'];
    for (const id of shapes) {
      for (let n = 0; n < 200; n++) {
        const idx = chimeIndexForLine(id, n);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(SCALE_SPAN);
        expect(isInScale(scaleMidi(idx))).toBe(true);
      }
      // a rising run of five (until it wraps past the top)
      const start = chimeIndexForLine(id, 0);
      for (let n = 1; n < 5; n++) expect(chimeIndexForLine(id, n)).toBe((start + n) % SCALE_SPAN);
    }
    // not all five start on the same note
    expect(new Set(shapes.map((s) => chimeIndexForLine(s, 0))).size).toBeGreaterThan(1);
  });

  it('bad line numbers do not throw or leave the scale', () => {
    for (const bad of [NaN, -3, Infinity, 1e12]) {
      const idx = chimeIndexForLine('rose', bad);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(SCALE_SPAN);
    }
  });

  it('the finished phrase: five notes, rising, all in the scale, the last one rings longest and loudest', () => {
    const p = completionPhrase();
    expect(p).toHaveLength(5);
    for (let i = 0; i < p.length; i++) {
      expect(isInScale(p[i]!.midi)).toBe(true);
      if (i > 0) {
        expect(p[i]!.midi).toBeGreaterThan(p[i - 1]!.midi);
        expect(p[i]!.at).toBeGreaterThan(p[i - 1]!.at);
      }
      expect(p[i]!.gain).toBeLessThanOrEqual(1);
    }
    const last = p[4]!;
    expect(last.dur).toBe(Math.max(...p.map((e) => e.dur)));
    expect(last.gain).toBe(Math.max(...p.map((e) => e.gain)));
    expect(p[0]!.at).toBe(0);
  });
});

// ---- the music box --------------------------------------------------------------------------------------------------------------------------

describe('the music-box melody (Happy Birthday to You)', () => {
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];

  it('is four lines of six beats: 25 notes (6 + 6 + 7 + 6), 24 beats', () => {
    expect(BIRTHDAY_MELODY).toHaveLength(25);
    expect(MELODY_BEATS).toBe(24);
    // the cumulative beat count lands exactly on a note boundary at the end of every line
    let t = 0;
    const boundaries: number[] = [];
    const perLine: number[] = [];
    let count = 0;
    for (const n of BIRTHDAY_MELODY) {
      t += n.beats;
      count++;
      if (Math.abs(t % 6) < 1e-9) {
        boundaries.push(t);
        perLine.push(count);
        count = 0;
      }
    }
    expect(boundaries).toEqual([6, 12, 18, 24]);
    expect(perLine).toEqual([6, 6, 7, 6]);
  });

  it('starts on G4 and ends on C5 (the home note), every note is in C major', () => {
    expect(BIRTHDAY_MELODY[0]!.midi).toBe(67);
    expect(BIRTHDAY_MELODY[BIRTHDAY_MELODY.length - 1]!.midi).toBe(72);
    for (const n of BIRTHDAY_MELODY) expect(MAJOR).toContain(((n.midi - 60) % 12 + 12) % 12);
  });

  it('is the known tune: the pitches of the four lines, as a sequence of semitones from C', () => {
    const names = BIRTHDAY_MELODY.map((n) => n.midi - 60);
    expect(names).toEqual([
      7, 7, 9, 7, 12, 11, //  Happy birthday to you
      7, 7, 9, 7, 14, 12, //  Happy birthday to you
      7, 7, 19, 16, 12, 11, 9, //  Happy birthday dear (name)
      17, 17, 16, 12, 14, 12, //  Happy birthday to you
    ]);
  });

  it('every note is in a sensible music-box range (G4 to G5)', () => {
    for (const n of BIRTHDAY_MELODY) {
      expect(n.midi).toBeGreaterThanOrEqual(67);
      expect(n.midi).toBeLessThanOrEqual(79);
      expect(n.beats).toBeGreaterThan(0);
    }
  });

  it('melodyEvents: in order from 0, spaced by the beat lengths at the tempo, and 20 seconds long at 72 bpm', () => {
    const ev = melodyEvents(72);
    expect(ev).toHaveLength(25);
    expect(ev[0]!.at).toBe(0);
    const spb = 60 / 72;
    for (let i = 1; i < ev.length; i++) {
      expect(ev[i]!.at).toBeGreaterThan(ev[i - 1]!.at);
      approx(ev[i]!.at - ev[i - 1]!.at, BIRTHDAY_MELODY[i - 1]!.beats * spb, 9);
    }
    approx(ev[24]!.at, (MELODY_BEATS - BIRTHDAY_MELODY[24]!.beats) * spb, 9);
    expect(MUSIC_BOX_BPM).toBe(72);
    // 24 beats = 20 s, plus the last tine's ring
    const total = melodySeconds();
    expect(total).toBeGreaterThan(20);
    expect(total).toBeLessThan(23);
  });

  it('each tine rings at least its own length and never more than 2.2 s, and is not louder than 1', () => {
    const spb = 60 / MUSIC_BOX_BPM;
    for (let i = 0; i < 25; i++) {
      const e = melodyEvents()[i]!;
      expect(e.dur).toBeLessThanOrEqual(2.2);
      expect(e.dur).toBeGreaterThanOrEqual(BIRTHDAY_MELODY[i]!.beats * spb);
      expect(e.gain).toBeGreaterThan(0);
      expect(e.gain).toBeLessThanOrEqual(1);
    }
  });

  it('a silly tempo is clamped, not trusted', () => {
    expect(melodyEvents(100000)[24]!.at).toBeCloseTo(melodyEvents(240)[24]!.at, 9);
    expect(melodyEvents(0.001)[24]!.at).toBeCloseTo(melodyEvents(20)[24]!.at, 9);
    expect(melodyEvents(NaN)[24]!.at).toBeCloseTo(melodyEvents(MUSIC_BOX_BPM)[24]!.at, 9);
  });

  it('placePhrase shifts every time and keeps everything else', () => {
    const p = placePhrase(completionPhrase(), 2.5);
    const q = completionPhrase();
    for (let i = 0; i < p.length; i++) {
      approx(p[i]!.at, q[i]!.at + 2.5, 9);
      expect(p[i]!.midi).toBe(q[i]!.midi);
    }
    expect(q[0]!.at).toBe(0); // the original was not touched
  });
});

// ---- scheduling ahead -----------------------------------------------------------------------------------------------------------------------

describe('LookaheadQueue', () => {
  const ev = (...ats: number[]) => ats.map((at, i) => ({ at, id: i }));

  it('hands over each event exactly once, in time order', () => {
    const q = new LookaheadQueue(0.25);
    q.push(ev(0.1, 0.5, 1.0));
    expect(q.pump(0).map((x) => x.event.at)).toEqual([0.1]);
    expect(q.pump(0).map((x) => x.event.at)).toEqual([]); // not again
    expect(q.pump(0.3).map((x) => x.event.at)).toEqual([0.5]);
    expect(q.pump(0.8).map((x) => x.event.at)).toEqual([1.0]);
    expect(q.pump(5)).toEqual([]);
    expect(q.size).toBe(0);
  });

  it('the look-ahead edge is exclusive: an event at now + lookahead waits for the next pump', () => {
    const q = new LookaheadQueue(0.25);
    q.push(ev(1.25));
    expect(q.pump(1)).toEqual([]);
    expect(q.pump(1.0001).map((x) => x.event.at)).toEqual([1.25]);
  });

  it('sorts what it is given, even pushed out of order or in two batches', () => {
    const q = new LookaheadQueue(10);
    q.push(ev(3, 1));
    q.push(ev(2, 0.5));
    expect(q.pump(0).map((x) => x.event.at)).toEqual([0.5, 1, 2, 3]);
  });

  it('an event already in the past is returned once and flagged late; the others are not', () => {
    const q = new LookaheadQueue(0.25);
    q.push(ev(1, 2, 2.1, 9));
    const out = q.pump(2.05);
    expect(out.map((x) => [x.event.at, x.late])).toEqual([[1, true], [2, true], [2.1, false]]);
    expect(q.pump(2.05)).toEqual([]);
    expect(q.size).toBe(1);
  });

  it('clear drops everything pending', () => {
    const q = new LookaheadQueue();
    q.push(ev(1, 2, 3));
    q.clear();
    expect(q.size).toBe(0);
    expect(q.pump(100)).toEqual([]);
  });

  it('a bad clock gives nothing and loses nothing', () => {
    const q = new LookaheadQueue();
    q.push(ev(0.1));
    expect(q.pump(NaN)).toEqual([]);
    expect(q.pump(Infinity)).toEqual([]);
    expect(q.size).toBe(1);
    expect(q.pump(0)).toHaveLength(1);
  });

  it('a whole tune pumped at 10 Hz plays every note once, none twice', () => {
    const q = new LookaheadQueue<{ at: number }>(0.25);
    const events = melodyEvents();
    q.push(events);
    let played = 0;
    for (let now = 0; now < 30; now += 0.1) played += q.pump(now).length;
    expect(played).toBe(25);
    expect(q.size).toBe(0);
  });

  it('a sleepy phone: notes more than LATE_DROP_S late are the caller\'s to drop', () => {
    expect(LATE_DROP_S).toBeGreaterThan(0);
    expect(LATE_DROP_S).toBeLessThan(1);
    const q = new LookaheadQueue<{ at: number }>();
    q.push(melodyEvents());
    const out = q.pump(10); // the page woke up at 10 s
    const playable = out.filter((x) => !x.late || 10 - x.event.at <= LATE_DROP_S);
    expect(out.length).toBeGreaterThan(playable.length);
    expect(playable.length).toBeGreaterThan(0);
  });
});

// ---- the mix --------------------------------------------------------------------------------------------------------------------------------

describe('the mix numbers', () => {
  it('starts quiet and can never be loud', () => {
    expect(MASTER_DEFAULT).toBeLessThan(MASTER_MAX);
    expect(MASTER_MAX).toBeLessThanOrEqual(0.6);
    expect(MASTER_DEFAULT).toBeLessThanOrEqual(0.35);
  });

  it('clampVolume: inside 0..max, NaN falls back to the quiet default', () => {
    expect(clampVolume(0.2)).toBe(0.2);
    expect(clampVolume(-4)).toBe(0);
    expect(clampVolume(99)).toBe(MASTER_MAX);
    expect(clampVolume(NaN)).toBe(MASTER_DEFAULT);
    expect(clampVolume(Infinity)).toBe(MASTER_DEFAULT);
  });

  it('the limiter settings are legal for a DynamicsCompressorNode', () => {
    expect(LIMITER.threshold).toBeLessThan(0);
    expect(LIMITER.threshold).toBeGreaterThanOrEqual(-100);
    expect(LIMITER.knee).toBeGreaterThanOrEqual(0);
    expect(LIMITER.ratio).toBeGreaterThanOrEqual(1);
    expect(LIMITER.ratio).toBeLessThanOrEqual(20);
    expect(LIMITER.attack).toBeGreaterThanOrEqual(0);
    expect(LIMITER.attack).toBeLessThanOrEqual(1);
    expect(LIMITER.release).toBeGreaterThanOrEqual(0);
    expect(LIMITER.release).toBeLessThanOrEqual(1);
  });

  it('duckTarget: nothing on = full; the lowest reason wins; reasons never stack to silence', () => {
    expect(duckTarget([])).toBe(1);
    expect(duckTarget(['wish'])).toBe(DUCK_LEVEL.wish);
    expect(duckTarget(['letter'])).toBe(DUCK_LEVEL.letter);
    expect(duckTarget(['finale'])).toBe(1);
    expect(duckTarget(['wish', 'letter'])).toBe(Math.min(DUCK_LEVEL.wish, DUCK_LEVEL.letter));
    expect(duckTarget(new Set<DuckReason>(['wish', 'letter', 'finale']))).toBe(DUCK_LEVEL.letter);
    for (const r of Object.keys(DUCK_LEVEL) as DuckReason[]) {
      expect(DUCK_LEVEL[r]).toBeGreaterThan(0);
      expect(DUCK_LEVEL[r]).toBeLessThanOrEqual(1);
    }
    // the letter ducks more than a wish card
    expect(DUCK_LEVEL.letter).toBeLessThan(DUCK_LEVEL.wish);
  });

  it('smoothToward: moves toward the target, never overshoots, is frame-rate independent', () => {
    let v = 1;
    for (let i = 0; i < 100; i++) {
      const next = smoothToward(v, 0.3, 0.016, 0.25);
      expect(next).toBeLessThanOrEqual(v);
      expect(next).toBeGreaterThanOrEqual(0.3);
      v = next;
    }
    approx(v, 0.3, 2);
    // one second in one step = one second in ten steps
    let a = 1;
    for (let i = 0; i < 10; i++) a = smoothToward(a, 0, 0.1, 0.5);
    approx(a, smoothToward(1, 0, 1, 0.5), 9);
    // and upward
    expect(smoothToward(0, 1, 0.5, 0.5)).toBeLessThan(1);
    expect(smoothToward(0, 1, 0.5, 0.5)).toBeGreaterThan(0);
  });

  it('smoothToward ignores bad input', () => {
    expect(smoothToward(0.5, 1, 0, 1)).toBe(0.5);
    expect(smoothToward(0.5, 1, -1, 1)).toBe(0.5);
    expect(smoothToward(0.5, NaN, 1, 1)).toBe(0.5);
    expect(smoothToward(0.5, 1, NaN, 1)).toBe(0.5);
    expect(smoothToward(NaN, 0.7, 1, 1)).toBe(0.7);
    expect(smoothToward(NaN, NaN, 1, 1)).toBe(0);
    expect(smoothToward(0.5, 0.9, 1, 0)).toBe(0.9); // no time constant = jump
  });
});

describe('the beds', () => {
  it('Act 1 (the nook) is warm; everything else is cool', () => {
    expect(moodForAct(1)).toBe('warm');
    for (const a of [0, 2, 3, 4, 99, -1, NaN]) expect(moodForAct(a)).toBe('cool');
  });

  it('the pad chords are real, low notes: three each, the warm one rounder (a C), the cool one an open fifth over D', () => {
    expect(PAD_CHORDS.cool).toEqual([50, 57, 62]);
    expect(PAD_CHORDS.warm).toEqual([48, 55, 64]);
    for (const c of [PAD_CHORDS.cool, PAD_CHORDS.warm]) for (const m of c) expect(midiToHz(m)).toBeLessThan(400);
  });

  it('the wind breathes inside its range, slowly, and survives bad time', () => {
    let fMin = Infinity, fMax = -Infinity, gMin = Infinity, gMax = -Infinity;
    for (let t = 0; t < 200; t += 0.25) {
      const w = windAt(t);
      fMin = Math.min(fMin, w.freq);
      fMax = Math.max(fMax, w.freq);
      gMin = Math.min(gMin, w.gain);
      gMax = Math.max(gMax, w.gain);
    }
    expect(fMin).toBeGreaterThanOrEqual(260);
    expect(fMax).toBeLessThanOrEqual(600);
    expect(gMin).toBeGreaterThanOrEqual(0.05);
    expect(gMax).toBeLessThanOrEqual(0.12);
    expect(fMax - fMin).toBeGreaterThan(100); // it does move
    expect(windAt(NaN)).toEqual(windAt(0));
    expect(windAt(Infinity)).toEqual(windAt(0));
    // a swell takes seconds, not a flutter: neighbouring quarter-seconds are close
    expect(Math.abs(windAt(10).freq - windAt(10.25).freq)).toBeLessThan(40);
  });
});

describe('footsteps and the purr', () => {
  it('makeRng: the same seed gives the same numbers, in 0..1, and different seeds differ', () => {
    const a = makeRng(2026), b = makeRng(2026), c = makeRng(7);
    const sa = [...Array(50)].map(() => a());
    const sb = [...Array(50)].map(() => b());
    const sc = [...Array(50)].map(() => c());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const x of sa) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(makeRng(0)()).toBeGreaterThanOrEqual(0); // seed 0 works
  });

  it('a step stays in its soft ranges and no two in a row are the same', () => {
    const r = makeRng(2026);
    let prev = '';
    for (let i = 0; i < 200; i++) {
      const s = footstep(r);
      expect(s.freq).toBeGreaterThanOrEqual(700);
      expect(s.freq).toBeLessThanOrEqual(1600);
      expect(s.dur).toBeGreaterThanOrEqual(0.1);
      expect(s.dur).toBeLessThanOrEqual(0.18);
      expect(s.gain).toBeGreaterThanOrEqual(0.12);
      expect(s.gain).toBeLessThanOrEqual(0.18);
      expect(Math.abs(s.pan)).toBeLessThanOrEqual(0.2);
      const key = JSON.stringify(s);
      expect(key).not.toBe(prev);
      prev = key;
    }
  });

  it('footsteps replay from a seed', () => {
    const run = (seed: number) => {
      const r = makeRng(seed);
      return [...Array(20)].map(() => footstep(r));
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('the purr is low and pulses at a cat\'s rate, and is quiet', () => {
    expect(PURR.baseHz).toBeLessThan(100);
    expect(PURR.pulseHz).toBeGreaterThanOrEqual(20);
    expect(PURR.pulseHz).toBeLessThanOrEqual(30);
    expect(PURR.gain).toBeLessThan(0.15);
    expect(PURR.fadeIn).toBeGreaterThan(0);
    expect(PURR.fadeOut).toBeGreaterThan(0);
  });
});

// ---- the unlock rules -----------------------------------------------------------------------------------------------------------------------

describe('the unlock state machine', () => {
  const STATES: AudioState[] = ['locked', 'running', 'suspended', 'unsupported'];
  const EVENTS: AudioEvent[] = ['gesture', 'ctx-running', 'ctx-suspended', 'hidden', 'visible', 'no-api'];

  // the whole table, written out by hand: row = state, column = event in the order above
  const EXPECT: Record<AudioState, AudioState[]> = {
    //            gesture       ctx-running  ctx-suspended hidden        visible      no-api
    locked: ['locked', 'running', 'locked', 'locked', 'locked', 'unsupported'],
    running: ['running', 'running', 'suspended', 'suspended', 'running', 'unsupported'],
    suspended: ['suspended', 'running', 'suspended', 'suspended', 'suspended', 'unsupported'],
    unsupported: ['unsupported', 'unsupported', 'unsupported', 'unsupported', 'unsupported', 'unsupported'],
  };

  it('every one of the 24 state / event pairs gives the expected state', () => {
    for (const s of STATES) EVENTS.forEach((e, i) => expect(`${s} + ${e} = ${nextAudioState(s, e)}`).toBe(`${s} + ${e} = ${EXPECT[s][i]}`));
  });

  it('always gives a valid state; "unsupported" is final; "no-api" ends in it from anywhere', () => {
    for (const s of STATES) for (const e of EVENTS) expect(STATES).toContain(nextAudioState(s, e));
    for (const e of EVENTS) expect(nextAudioState('unsupported', e)).toBe('unsupported');
    for (const s of STATES) expect(nextAudioState(s, 'no-api')).toBe('unsupported');
  });

  it('a state that never had a gesture stays silent: nothing but the context reporting back unlocks it', () => {
    for (const e of EVENTS.filter((x) => x !== 'ctx-running' && x !== 'no-api')) expect(nextAudioState('locked', e)).toBe('locked');
  });

  it('any random walk over the events ends in a valid state', () => {
    const r = makeRng(99);
    let s: AudioState = 'locked';
    for (let i = 0; i < 2000; i++) {
      s = nextAudioState(s, EVENTS[Math.floor(r() * EVENTS.length)]!);
      expect(STATES).toContain(s);
    }
  });

  it('shouldResume: on a gesture (unless unsupported), and on coming back only if it was suspended', () => {
    for (const s of ['locked', 'running', 'suspended'] as AudioState[]) {
      expect(shouldResume(s, 'gesture')).toBe(true);
      expect(shouldResume(s, 'visible')).toBe(s === 'suspended');
      for (const e of ['ctx-running', 'ctx-suspended', 'hidden', 'no-api'] as AudioEvent[]) expect(shouldResume(s, e)).toBe(false);
    }
    for (const e of EVENTS) expect(shouldResume('unsupported', e)).toBe(false);
  });
});

describe('the mute switch value', () => {
  it('only "1" means muted; anything odd means not muted', () => {
    expect(parseMuted('1')).toBe(true);
    for (const x of ['0', '', 'true', 'yes', ' 1', '11', null, undefined]) expect(parseMuted(x as string | null | undefined)).toBe(false);
  });
  it('round-trips', () => {
    expect(parseMuted(serializeMuted(true))).toBe(true);
    expect(parseMuted(serializeMuted(false))).toBe(false);
    expect(MUTE_KEY).toBe('winterlight.muted');
  });
});

// ---- purity and boundaries ------------------------------------------------------------------------------------------------------------------

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
function readTs(dir: string, base = dir, acc: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTs(p, base, acc);
    else if (p.endsWith('.ts')) acc[relative(base, p).split(sep).join('/')] = readFileSync(p, 'utf8');
  }
  return acc;
}

describe('purity', () => {
  it('audioMath.ts has no Web Audio, no DOM, no clock, no Math.random and no imports', () => {
    const src = stripComments(readFileSync('src/audio/audioMath.ts', 'utf8'));
    for (const bad of ['AudioContext', 'BaseAudioContext', 'AudioNode', 'document', 'window', 'navigator', 'localStorage', 'Date.now', 'new Date', 'performance', 'Math.random', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'import ', 'three'])
      expect(src.includes(bad) ? bad : '').toBe('');
  });

  it('voices.ts and graph.ts and render.ts never read a clock or Math.random (the caller gives the time, the noise is seeded)', () => {
    for (const f of ['voices', 'graph', 'render']) {
      const src = stripComments(readFileSync(`src/audio/${f}.ts`, 'utf8'));
      for (const bad of ['Date.now', 'new Date', 'performance.now', 'Math.random', 'setTimeout', 'setInterval', 'document', 'window.', 'localStorage'])
        expect(src.includes(bad) ? `${f}: ${bad}` : '').toBe('');
    }
  });

  it('the audio folder imports only itself and state/events, and never three', () => {
    for (const [file, text] of Object.entries(readTs('src/audio'))) {
      for (const m of stripComments(text).matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        const ok = spec.startsWith('./') || spec === '../state/events';
        expect(ok ? '' : `${file} imports ${spec}`).toBe('');
      }
    }
  });

  it('nothing outside audio/ imports it except main.ts, audioView.ts and acts/', () => {
    for (const [file, text] of Object.entries(readTs('src'))) {
      if (file.startsWith('audio/')) continue;
      const hits = [...stripComments(text).matchAll(/from\s*['"]([^'"]*\/audio(?:\/[^'"]*)?)['"]/g)];
      if (hits.length === 0) continue;
      expect(['main.ts', 'audioView.ts'].includes(file) || file.startsWith('acts/') ? '' : `${file} imports audio`).toBe('');
    }
  });

  it('there are no audio files in the project (all sound is synthesised)', () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        if (n === 'node_modules' || n === 'dist' || n === '.git') return [];
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const shipped = [...walk('src'), ...walk('public'), ...walk('content')];
    for (const f of shipped) expect(/\.(mp3|ogg|wav|m4a|aac|flac|webm)$/i.test(f) ? f : '').toBe('');
  });
});

// ---- a fake Web Audio, enough to run the real engine and voices ----------------------------------------------------------------------------------

type Call = [string, ...number[]];
class FakeParam {
  value = 0;
  calls: Call[] = [];
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(['set', v, t]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(['linear', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.calls.push(['target', v, t, tc]);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(['cancel', t]);
    return this;
  }
  last(kind: string): Call | undefined {
    return [...this.calls].reverse().find((c) => c[0] === kind);
  }
}
class FakeNode {
  out: FakeNode[] = [];
  started: number[] = [];
  stopped: number[] = [];
  type = '';
  buffer: unknown = null;
  loop = false;
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  Q = new FakeParam();
  pan = new FakeParam();
  playbackRate = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  constructor(readonly kind: string) {}
  connect(n: FakeNode) {
    this.out.push(n);
    return n;
  }
  start(t = 0) {
    this.started.push(t);
  }
  stop(t = 0) {
    this.stopped.push(t);
  }
}
class FakeContext {
  state: string = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeNode('destination');
  nodes: FakeNode[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closed = false;
  private handlers = new Map<string, Set<() => void>>();
  /** what resume() does: the browser's answer to a gesture. Tests flip it to simulate iOS refusing. */
  allowResume = true;
  addEventListener(t: string, f: () => void) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set());
    this.handlers.get(t)!.add(f);
  }
  private emit(t: string) {
    for (const f of [...(this.handlers.get(t) ?? [])]) f();
  }
  setState(s: string) {
    this.state = s;
    this.emit('statechange');
  }
  resume() {
    this.resumeCalls++;
    if (this.allowResume) this.setState('running');
    return Promise.resolve();
  }
  suspend() {
    this.suspendCalls++;
    this.setState('suspended');
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }
  private make(kind: string): FakeNode {
    const n = new FakeNode(kind);
    this.nodes.push(n);
    return n;
  }
  createGain() { return this.make('gain'); }
  createOscillator() { return this.make('osc'); }
  createBiquadFilter() { return this.make('biquad'); }
  createDynamicsCompressor() { return this.make('compressor'); }
  createBufferSource() { return this.make('source'); }
  createStereoPanner() { return this.make('panner'); }
  createBuffer(_ch: number, len: number, rate: number) {
    return { length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) };
  }
  of(kind: string): FakeNode[] {
    return this.nodes.filter((n) => n.kind === kind);
  }
  /** how many nodes of a kind have been started */
  startedCount(kind: string): number {
    return this.of(kind).filter((n) => n.started.length > 0).length;
  }
  // an offline context
  async startRendering() {
    const len = this.length;
    const data = new Float32Array(len);
    data[10] = 0.25;
    data[11] = -0.5;
    return { getChannelData: () => data };
  }
  length = 0;
}

// a fake window and document so the engine's gesture, visibility and timer handling can be driven
interface Intervals {
  id: number;
  fn: () => void;
}
function installDom() {
  const win = new Map<string, Set<(e?: unknown) => void>>();
  const doc = new Map<string, Set<(e?: unknown) => void>>();
  let nextId = 1;
  const intervals: Intervals[] = [];
  const add = (m: Map<string, Set<(e?: unknown) => void>>) => (t: string, f: (e?: unknown) => void) => {
    if (!m.has(t)) m.set(t, new Set());
    m.get(t)!.add(f);
  };
  const remove = (m: Map<string, Set<(e?: unknown) => void>>) => (t: string, f: (e?: unknown) => void) => void m.get(t)?.delete(f);
  const fakeWindow = {
    addEventListener: add(win),
    removeEventListener: remove(win),
    setInterval: (fn: () => void) => {
      const id = nextId++;
      intervals.push({ id, fn });
      return id;
    },
    clearInterval: (id: number) => {
      const i = intervals.findIndex((x) => x.id === id);
      if (i >= 0) intervals.splice(i, 1);
    },
  };
  const fakeDoc = { visibilityState: 'visible', addEventListener: add(doc), removeEventListener: remove(doc) };
  const g = globalThis as unknown as Record<string, unknown>;
  const before = { window: g.window, document: g.document };
  g.window = fakeWindow;
  g.document = fakeDoc;
  return {
    doc: fakeDoc,
    fire: (t: string) => [...(win.get(t) ?? [])].forEach((f) => f({ type: t })),
    fireDoc: (t: string) => [...(doc.get(t) ?? [])].forEach((f) => f({ type: t })),
    listenerCount: () => [...win.values(), ...doc.values()].reduce((s, x) => s + x.size, 0),
    intervals,
    /** run every timer once (the engine's are 100 ms and 700 ms; tests do not care which) */
    tick: () => [...intervals].forEach((x) => x.fn()),
    restore: () => {
      g.window = before.window;
      g.document = before.document;
    },
  };
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  const calls: string[] = [];
  return {
    data,
    calls,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => {
      calls.push(`${k}=${v}`);
      data[k] = v;
    },
  };
}

describe('the engine against a fake AudioContext', () => {
  let dom: ReturnType<typeof installDom>;
  let contexts: FakeContext[];
  const factory = () => {
    const c = new FakeContext();
    contexts.push(c);
    return c as unknown as AudioContext;
  };
  beforeEach(() => {
    dom = installDom();
    contexts = [];
  });
  afterEach(() => {
    dom.restore();
  });
  const ctx = () => contexts[0]!;

  async function unlocked(opts: Parameters<typeof createAudioEngine>[0] = {}) {
    const engine = createAudioEngine({ contextFactory: factory, storage: memoryStorage(), ...opts });
    dom.fire('pointerdown');
    await settle();
    return engine;
  }

  it('is silent and has NO context until the first gesture', () => {
    const e = createAudioEngine({ contextFactory: factory, storage: memoryStorage() });
    expect(contexts).toHaveLength(0);
    expect(e.state).toBe('locked');
    // every sound is a quiet no-op before that
    e.chime(3);
    e.completion();
    e.footstep();
    e.purr(true);
    e.setMood('warm');
    e.duck('wish', true);
    expect(e.birthday()).toBe(0);
    expect(contexts).toHaveLength(0);
  });

  it('the first pointer, touch or key builds one context and resumes it inside the gesture', async () => {
    for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) {
      dom.restore();
      dom = installDom();
      contexts = [];
      const e = createAudioEngine({ contextFactory: factory, storage: memoryStorage() });
      dom.fire(type);
      expect(contexts).toHaveLength(1);
      expect(ctx().resumeCalls).toBe(1); // called synchronously, inside the gesture
      await settle();
      expect(e.state).toBe('running');
      e.dispose();
    }
  });

  it('a pointermove or a scroll is not a gesture', () => {
    createAudioEngine({ contextFactory: factory, storage: memoryStorage() });
    dom.fire('pointermove');
    dom.fire('scroll');
    dom.fire('wheel');
    expect(contexts).toHaveLength(0);
  });

  it('only ever one context, however many gestures', async () => {
    await unlocked();
    for (let i = 0; i < 20; i++) {
      dom.fire('pointerdown');
      dom.fire('keydown');
      dom.fire('click');
    }
    await settle();
    expect(contexts).toHaveLength(1);
    expect(ctx().resumeCalls).toBe(1); // once running, later taps do not poke it again
  });

  it('plays one silent sample inside the first gesture (what iOS wants)', async () => {
    await unlocked();
    const silent = ctx().of('source').filter((n) => n.started.length > 0 && (n.buffer as { length: number }).length === 1);
    expect(silent.length).toBeGreaterThanOrEqual(1);
  });

  it('the graph: voices and beds -> duck -> master (0.3, quiet) -> limiter -> speakers', async () => {
    await unlocked();
    const c = ctx();
    const [limiter] = c.of('compressor');
    expect(limiter!.threshold.value).toBe(LIMITER.threshold);
    expect(limiter!.ratio.value).toBe(LIMITER.ratio);
    expect(limiter!.attack.value).toBe(LIMITER.attack);
    expect(limiter!.out).toEqual([c.destination]);
    const gains = c.of('gain');
    const master = gains.find((g) => g.out[0] === limiter)!;
    expect(master.gain.value).toBe(MASTER_DEFAULT);
    const duck = gains.find((g) => g.out[0] === master)!;
    expect(duck.gain.value).toBe(1);
    const feeds = gains.filter((g) => g.out[0] === duck);
    expect(feeds).toHaveLength(2); // sfx and beds both go through the duck
  });

  it('the graph builder is the same for the live page and the offline render, and reduced motion calms the beds', () => {
    const live = new FakeContext();
    const a = buildGraph(live as unknown as BaseAudioContext, { gain: 0.3 });
    expect(a.master.gain.value).toBe(0.3);
    expect(a.bedGain.gain.value).toBe(1);
    const b = buildGraph(new FakeContext() as unknown as BaseAudioContext, { gain: 0, reducedMotion: true });
    expect(b.master.gain.value).toBe(0);
    expect(b.bedGain.gain.value).toBe(0.6);
  });

  it('the beds start with the context: wind, hush and six pad voices, breathing on a timer', async () => {
    await unlocked();
    const c = ctx();
    expect(c.of('source').filter((n) => n.loop && n.started.length > 0)).toHaveLength(2); // wind + hush
    expect(c.of('osc').filter((n) => n.started.length > 0)).toHaveLength(6); // two moods x three voices
    expect(dom.intervals.length).toBeGreaterThanOrEqual(1);
    const before = c.of('biquad').reduce((s, n) => s + n.frequency.calls.filter((x) => x[0] === 'target').length, 0);
    dom.tick();
    const after = c.of('biquad').reduce((s, n) => s + n.frequency.calls.filter((x) => x[0] === 'target').length, 0);
    expect(after).toBeGreaterThan(before);
  });

  it('chime, finished phrase, footstep and purr each make a sound once running', async () => {
    const e = await unlocked();
    const c = ctx();
    const osc0 = c.startedCount('osc');
    e.chime(4);
    expect(c.startedCount('osc')).toBe(osc0 + 2); // a note and its octave
    const o1 = c.startedCount('osc');
    e.completion();
    expect(c.startedCount('osc')).toBe(o1 + 10); // five notes
    const src0 = c.startedCount('source');
    e.footstep();
    expect(c.startedCount('source')).toBe(src0 + 1);
    const o2 = c.startedCount('osc');
    e.purr(true);
    expect(c.startedCount('osc')).toBe(o2 + 2); // the oscillator and its pulse
    e.purr(true);
    expect(c.startedCount('osc')).toBe(o2 + 2); // never twice
  });

  it('the chime plays the note it was asked for', async () => {
    const e = await unlocked();
    const c = ctx();
    const before = c.of('osc').length;
    e.chime(0); // C5
    const added = c.of('osc').slice(before);
    approx(added[0]!.frequency.calls[0]![1] as number, midiToHz(72), 6);
    approx(added[1]!.frequency.calls[0]![1] as number, midiToHz(72) * 2, 6);
  });

  it('purr fades in and out and the loop can restart', async () => {
    const e = await unlocked();
    const c = ctx();
    e.purr(true);
    const out = c.of('gain').find((g) => g.gain.calls.some((x) => x[0] === 'linear' && x[1] === PURR.gain))!;
    expect(out).toBeTruthy();
    e.purr(false);
    expect(out.gain.last('linear')![1]).toBe(0);
    e.purr(true);
    expect(out.gain.last('linear')![1]).toBe(PURR.gain);
  });

  it('a purr asked for before the sound is unlocked starts as soon as it is', async () => {
    const e = createAudioEngine({ contextFactory: factory, storage: memoryStorage() });
    e.purr(true);
    dom.fire('pointerdown');
    await settle();
    const out = ctx().of('gain').find((g) => g.gain.calls.some((x) => x[0] === 'linear' && x[1] === PURR.gain));
    expect(out).toBeTruthy();
  });

  // ---- mute ----

  it('mute ramps the master to 0 quickly, is remembered, and un-mute brings it back', async () => {
    const store = memoryStorage();
    const e = await unlocked({ storage: store });
    const master = ctx().of('gain').find((g) => g.out[0] === ctx().of('compressor')[0])!;
    let changes = 0;
    e.onChange(() => changes++);
    e.setMuted(true);
    expect(e.muted).toBe(true);
    expect(master.gain.last('target')!.slice(1, 2)).toEqual([0]);
    expect(master.gain.last('target')![3]).toBeLessThan(0.2); // a short fade, not a click and not a slow one
    expect(store.calls).toContain(`${MUTE_KEY}=1`);
    expect(changes).toBe(1);
    e.setMuted(true); // no change, no noise
    expect(changes).toBe(1);
    expect(e.toggleMuted()).toBe(false);
    expect(master.gain.last('target')![1]).toBe(MASTER_DEFAULT);
    expect(store.calls).toContain(`${MUTE_KEY}=0`);
  });

  it('a muted visit comes back muted: the saved choice is read, and the master starts at 0', async () => {
    const e = await unlocked({ storage: memoryStorage({ [MUTE_KEY]: '1' }) });
    expect(e.muted).toBe(true);
    const master = ctx().of('gain').find((g) => g.out[0] === ctx().of('compressor')[0])!;
    expect(master.gain.value).toBe(0);
  });

  it('a storage that throws (private mode) is survived: reading, writing, or none at all', async () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const e = await unlocked({ storage: bad });
    expect(e.muted).toBe(false);
    expect(() => e.setMuted(true)).not.toThrow();
    expect(e.muted).toBe(true); // this visit only
    const e2 = createAudioEngine({ contextFactory: factory, storage: null });
    expect(() => e2.setMuted(true)).not.toThrow();
    expect(e2.muted).toBe(true);
  });

  it('muting during the music box stops feeding it', async () => {
    const e = await unlocked();
    const c = ctx();
    expect(e.birthday()).toBeGreaterThan(19);
    const before = c.startedCount('osc');
    e.setMuted(true);
    for (let i = 0; i < 400; i++) {
      c.currentTime += 0.1;
      dom.tick();
    }
    expect(c.startedCount('osc')).toBe(before); // nothing more was handed to the clock
    expect(e.birthday()).toBe(0); // and it will not start while muted
  });

  it('volume is clamped to the hard maximum', async () => {
    const e = await unlocked();
    const master = ctx().of('gain').find((g) => g.out[0] === ctx().of('compressor')[0])!;
    e.setVolume(10);
    expect(e.volume).toBe(MASTER_MAX);
    expect(master.gain.last('target')![1]).toBe(MASTER_MAX);
    e.setVolume(NaN);
    expect(e.volume).toBe(MASTER_DEFAULT);
    e.setVolume(-1);
    expect(e.volume).toBe(0);
  });

  // ---- no Web Audio ----

  it('no Web Audio at all: a quiet no-op for good, nothing thrown', () => {
    const e = createAudioEngine({ contextFactory: () => null, storage: memoryStorage() });
    let changes = 0;
    e.onChange(() => changes++);
    dom.fire('pointerdown');
    expect(e.state).toBe('unsupported');
    expect(changes).toBe(1);
    dom.fire('pointerdown');
    expect(() => {
      e.chime(1);
      e.completion();
      e.footstep();
      e.purr(true);
      e.setMood('warm');
      e.duck('letter', true);
      e.unlock();
    }).not.toThrow();
    expect(e.birthday()).toBe(0);
    expect(e.state).toBe('unsupported');
    expect(changes).toBe(1);
    // the mute switch still works as a remembered preference
    e.setMuted(true);
    expect(e.muted).toBe(true);
  });

  it('a context factory that throws, or a context that cannot build the graph, does not throw into the page', () => {
    const e = createAudioEngine({
      contextFactory: () => {
        throw new Error('NotSupportedError');
      },
      storage: memoryStorage(),
    });
    expect(() => dom.fire('pointerdown')).not.toThrow();
    expect(e.state).toBe('unsupported');
    dom.restore();
    dom = installDom();
    const broken = createAudioEngine({
      contextFactory: () => {
        const c = new FakeContext();
        c.createDynamicsCompressor = () => {
          throw new Error('no compressor');
        };
        return c as unknown as AudioContext;
      },
      storage: memoryStorage(),
    });
    expect(() => dom.fire('pointerdown')).not.toThrow();
    expect(broken.state).toBe('unsupported');
  });

  // ---- hidden / visible / suspended ----

  it('a hidden page suspends the context; coming back resumes it', async () => {
    const e = await unlocked();
    const c = ctx();
    expect(e.state).toBe('running');
    dom.doc.visibilityState = 'hidden';
    dom.fireDoc('visibilitychange');
    await settle();
    expect(c.suspendCalls).toBe(1);
    expect(e.state).toBe('suspended');
    const resumes = c.resumeCalls;
    dom.doc.visibilityState = 'visible';
    dom.fireDoc('visibilitychange');
    await settle();
    expect(c.resumeCalls).toBe(resumes + 1);
    expect(e.state).toBe('running');
  });

  it('coming back to a page that was never suspended does not poke the context', async () => {
    await unlocked();
    const c = ctx();
    const r = c.resumeCalls;
    dom.fireDoc('visibilitychange'); // visible
    expect(c.resumeCalls).toBe(r);
  });

  it('hidden before any tap changes nothing (still locked, still no context)', () => {
    const e = createAudioEngine({ contextFactory: factory, storage: memoryStorage() });
    dom.doc.visibilityState = 'hidden';
    dom.fireDoc('visibilitychange');
    expect(e.state).toBe('locked');
    expect(contexts).toHaveLength(0);
  });

  it('a phone call (the context becomes "interrupted" or "suspended" by itself): the next tap tries again', async () => {
    const e = await unlocked();
    const c = ctx();
    c.setState('interrupted'); // iOS
    expect(e.state).toBe('suspended');
    const r = c.resumeCalls;
    dom.fire('touchend');
    await settle();
    expect(c.resumeCalls).toBe(r + 1);
    expect(e.state).toBe('running');
    c.setState('suspended'); // the browser pauses it itself
    expect(e.state).toBe('suspended');
    dom.fire('pointerdown');
    await settle();
    expect(e.state).toBe('running');
  });

  it('if the browser refuses the first resume (iOS without a real gesture) the engine stays locked and a later tap tries again', async () => {
    const f = () => {
      const c = new FakeContext();
      c.allowResume = false;
      contexts.push(c);
      return c as unknown as AudioContext;
    };
    const e2 = createAudioEngine({ contextFactory: f, storage: memoryStorage() });
    dom.fire('pointerdown');
    await settle();
    expect(e2.state).toBe('locked');
    e2.chime(2); // still silent: nothing started
    expect(contexts[0]!.startedCount('osc')).toBe(0);
    contexts[0]!.allowResume = true;
    dom.fire('pointerdown');
    await settle();
    expect(contexts).toHaveLength(1); // the same context
    expect(contexts[0]!.resumeCalls).toBe(2);
    expect(e2.state).toBe('running');
  });

  // ---- ducking ----

  it('the wish card and the letter duck the sound; they come back; they do not stack to silence', async () => {
    const e = await unlocked();
    const duck = ctx().of('gain').find((g) => g.out[0] === ctx().of('gain').find((m) => m.out[0] === ctx().of('compressor')[0]))!;
    e.duck('wish', true);
    expect(duck.gain.last('target')![1]).toBe(DUCK_LEVEL.wish);
    e.duck('letter', true);
    expect(duck.gain.last('target')![1]).toBe(DUCK_LEVEL.letter);
    e.duck('wish', false);
    expect(duck.gain.last('target')![1]).toBe(DUCK_LEVEL.letter); // the letter is still open
    e.duck('letter', false);
    expect(duck.gain.last('target')![1]).toBe(1);
  });

  it('ducking goes down fast and comes back slowly', async () => {
    const e = await unlocked();
    const duck = ctx().of('gain').find((g) => g.out[0] === ctx().of('gain').find((m) => m.out[0] === ctx().of('compressor')[0]))!;
    e.duck('wish', true);
    const down = duck.gain.last('target')![3]!;
    duck.gain.value = DUCK_LEVEL.wish; // as the audio clock would have left it
    e.duck('wish', false);
    const up = duck.gain.last('target')![3]!;
    expect(down).toBeLessThan(up);
  });

  // ---- the event bus ----

  it('listen maps every event the card sends to its sound', async () => {
    const e = await unlocked();
    const c = ctx();
    const bus = createBus<WinterEvents>();
    e.listen(bus);
    const duck = c.of('gain').find((g) => g.out[0] === c.of('gain').find((m) => m.out[0] === c.of('compressor')[0]))!;
    const osc = () => c.startedCount('osc');

    let n = osc();
    bus.emit('star:connect', { shape: 'strawberry', line: 0 });
    expect(osc()).toBe(n + 2);
    n = osc();
    bus.emit('star:connect', { shape: 'strawberry' }); // no line number: the engine counts for itself
    expect(osc()).toBe(n + 2);

    n = osc();
    bus.emit('constellation:done', { id: 'strawberry' });
    expect(osc()).toBe(n + 10);

    bus.emit('wish:show', { id: 'strawberry' });
    expect(duck.gain.last('target')![1]).toBe(DUCK_LEVEL.wish);
    bus.emit('wish:hide');
    expect(duck.gain.last('target')![1]).toBe(1);

    bus.emit('letter:open');
    expect(duck.gain.last('target')![1]).toBe(DUCK_LEVEL.letter);
    bus.emit('letter:read');
    expect(duck.gain.last('target')![1]).toBe(DUCK_LEVEL.letter); // still reading: the quiet stays
    bus.emit('letter:close');
    expect(duck.gain.last('target')![1]).toBe(1);

    const s = c.startedCount('source');
    bus.emit('footstep');
    expect(c.startedCount('source')).toBe(s + 1);

    bus.emit('pet:purr', { on: true });
    const purr = c.of('gain').find((g) => g.gain.calls.some((x) => x[0] === 'linear' && x[1] === PURR.gain))!;
    expect(purr.gain.last('linear')![1]).toBe(PURR.gain);
    bus.emit('pet:purr', { on: false });
    expect(purr.gain.last('linear')![1]).toBe(0);
  });

  it('a line\'s chime is the note chimeIndexForLine says', async () => {
    const e = await unlocked();
    const c = ctx();
    const bus = createBus<WinterEvents>();
    e.listen(bus);
    for (const line of [0, 1, 2, 3]) {
      const before = c.of('osc').length;
      bus.emit('star:connect', { shape: 'rose', line });
      const first = c.of('osc')[before]!;
      approx(first.frequency.calls[0]![1] as number, midiToHz(scaleMidi(chimeIndexForLine('rose', line))), 6);
    }
  });

  it('the mood of the beds follows the act: warm in the nook (act 1), cool after', async () => {
    const e = await unlocked();
    const c = ctx();
    const bus = createBus<WinterEvents>();
    e.listen(bus);
    const moodGains = c.of('gain').filter((g) => g.gain.calls.some((x) => x[0] === 'target' && x[3] === 2.5));
    // the beds were started in 'cool': cool first, warm second in creation order
    expect(moodGains).toHaveLength(2);
    const [cool, warm] = moodGains as [FakeNode, FakeNode];
    bus.emit('act:enter', { act: 1 });
    expect(warm.gain.last('target')![1]).toBe(1);
    expect(cool.gain.last('target')![1]).toBe(0);
    bus.emit('act:enter', { act: 2 });
    expect(warm.gain.last('target')![1]).toBe(0);
    expect(cool.gain.last('target')![1]).toBe(1);
  });

  it('a mood chosen before unlock is the one the beds start in', async () => {
    const e = createAudioEngine({ contextFactory: factory, storage: memoryStorage() });
    e.setMood('warm');
    dom.fire('pointerdown');
    await settle();
    const moodGains = ctx().of('gain').filter((g) => g.gain.calls.some((x) => x[0] === 'target' && x[3] === 2.5));
    const [cool, warm] = moodGains as [FakeNode, FakeNode];
    expect(warm.gain.last('target')![1]).toBe(1);
    expect(cool.gain.last('target')![1]).toBe(0);
  });

  it('Phase 28: the finale\'s swell plays the music-box tune, once per swell, and nothing else in the finale does', async () => {
    const e = await unlocked();
    const c = ctx();
    const bus = createBus<WinterEvents>(() => undefined);
    e.listen(bus);
    const base = c.of('osc').length;
    for (const name of ['finale:start', 'finale:join', 'finale:pullback', 'finale:done'] as const) bus.emit(name);
    for (let i = 0; i < 50; i++) {
      c.currentTime += 0.1;
      dom.tick();
    }
    expect(c.of('osc').length).toBe(base); // only the swell is the tune's cue
    bus.emit('finale:swell');
    for (let i = 0; i < 400; i++) {
      c.currentTime += 0.1;
      dom.tick();
    }
    expect(c.of('osc').length - base).toBe(50); // 25 notes x (tone + partial)
    bus.emit('finale:swell'); // a replay of the finale restarts the tune and does not double it
    bus.emit('finale:swell');
    for (let i = 0; i < 400; i++) {
      c.currentTime += 0.1;
      dom.tick();
    }
    expect(c.of('osc').length - base).toBe(50 + 2 + 50); // the first tine of the restarted call went out at once (as in the test above); then only the second tune plays, whole
  });

  it('listen returns an unsubscribe, works on several buses, and a bad event does not stop the rest', async () => {
    const e = await unlocked();
    const c = ctx();
    const a = createBus<WinterEvents>(() => undefined);
    const b = createBus<WinterEvents>(() => undefined);
    const offA = e.listen(a);
    e.listen(b);
    const n = c.startedCount('osc');
    a.emit('star:connect', { shape: 'rose', line: 0 });
    b.emit('star:connect', { shape: 'rose', line: 1 });
    expect(c.startedCount('osc')).toBe(n + 4);
    offA();
    a.emit('star:connect', { shape: 'rose', line: 2 });
    expect(c.startedCount('osc')).toBe(n + 4);
    b.emit('star:connect', { shape: 'rose', line: 3 });
    expect(c.startedCount('osc')).toBe(n + 6);
    expect(a.listenerCount('star:connect')).toBe(0);
  });

  it('events before unlock are quiet no-ops (and do not unlock by themselves)', () => {
    const e = createAudioEngine({ contextFactory: factory, storage: memoryStorage() });
    const bus = createBus<WinterEvents>();
    e.listen(bus);
    bus.emit('constellation:done', { id: 'rose' });
    bus.emit('footstep');
    bus.emit('star:connect', { shape: 'rose', line: 0 });
    expect(contexts).toHaveLength(0);
  });

  // ---- the music box through the engine ----

  it('birthday: every one of the 25 notes is handed to the clock exactly once, in order, and the timer stops by itself', async () => {
    const e = await unlocked();
    const c = ctx();
    const base = c.of('osc').length;
    const len = e.birthday();
    expect(len).toBeGreaterThan(20);
    expect(len).toBeLessThan(25);
    for (let i = 0; i < 400; i++) {
      c.currentTime += 0.1;
      dom.tick();
    }
    const tines = c.of('osc').slice(base);
    expect(tines).toHaveLength(50); // 25 notes x (tone + partial)
    expect(tines.every((n) => n.started.length === 1)).toBe(true);
    // the tones (every second oscillator) are the tune's notes, in order
    const hz = tines.filter((_, i) => i % 2 === 0).map((n) => n.frequency.calls[0]![1] as number);
    BIRTHDAY_MELODY.forEach((n, i) => approx(hz[i]!, midiToHz(n.midi), 6));
    // start times never go backwards
    const starts = tines.filter((_, i) => i % 2 === 0).map((n) => n.started[0]!);
    for (let i = 1; i < starts.length; i++) expect(starts[i]!).toBeGreaterThan(starts[i - 1]!);
    // only the beds' breathing timer is left
    expect(dom.intervals).toHaveLength(1);
  });

  it('birthday: a phone that slept through part of the tune drops the late notes instead of blurting them', async () => {
    const e = await unlocked();
    const c = ctx();
    const base = c.of('osc').length;
    e.birthday();
    c.currentTime = 10; // the page woke up ten seconds in
    dom.tick();
    for (let i = 0; i < 400; i++) {
      c.currentTime += 0.1;
      dom.tick();
    }
    const played = c.of('osc').slice(base).length / 2;
    const start = 0.2;
    const events = melodyEvents();
    const expected = 1 + events.filter((x) => x.at + start >= 10 - LATE_DROP_S).length; // the first note, then only what was not too late
    expect(played).toBe(expected);
    expect(played).toBeLessThan(25);
    // nothing is scheduled in the past
    for (const n of c.of('osc').slice(base + 2)) expect(n.started[0]!).toBeGreaterThanOrEqual(10 - 1e-9); // (the first note went out before the page slept)
  });

  it('birthday called again restarts the tune instead of doubling it', async () => {
    const e = await unlocked();
    const c = ctx();
    const base = c.of('osc').length;
    e.birthday();
    e.birthday();
    for (let i = 0; i < 400; i++) {
      c.currentTime += 0.1;
      dom.tick();
    }
    // the first tine of each call was handed over at once; after that only the second tune plays
    expect(c.of('osc').slice(base).length).toBeLessThanOrEqual(52);
  });

  // ---- dispose ----

  it('dispose removes every listener and timer and closes the context; later taps do nothing', async () => {
    const e = await unlocked();
    expect(dom.listenerCount()).toBeGreaterThan(0);
    e.dispose();
    expect(dom.listenerCount()).toBe(0);
    expect(dom.intervals).toHaveLength(0);
    expect(ctx().closed).toBe(true);
    dom.fire('pointerdown');
    expect(contexts).toHaveLength(1);
  });
});

// ---- the mute button --------------------------------------------------------------------------------------------------------------------------

describe('the mute button', () => {
  interface El {
    tag: string;
    style: { cssText: string };
    innerHTML: string;
    attrs: Record<string, string>;
    handlers: Record<string, (() => void)[]>;
    parent: unknown;
    type?: string;
    className?: string;
    setAttribute(k: string, v: string): void;
    addEventListener(t: string, f: () => void): void;
    appendChild(c: unknown): void;
    prepend(c: unknown): void;
    remove(): void;
    click(): void;
  }
  let g: Record<string, unknown>;
  let before: unknown;
  // Phase 24: the sound button is prepended (first in the tab order), so the fake page has prepend too
  const parent = { children: [] as unknown[], appendChild(c: unknown) { this.children.push(c); (c as El).parent = this; }, prepend(c: unknown) { this.children.unshift(c); (c as El).parent = this; } };
  beforeEach(() => {
    g = globalThis as unknown as Record<string, unknown>;
    before = g.document;
    parent.children = [];
    g.document = {
      body: parent,
      createElement: (tag: string): El => {
        const el: El = {
          tag, style: { cssText: '' }, innerHTML: '', attrs: {}, handlers: {}, parent: null,
          setAttribute(k, v) { this.attrs[k] = v; },
          addEventListener(t, f) { (this.handlers[t] ??= []).push(f); },
          appendChild() { /* unused */ },
          prepend() { /* unused */ },
          remove() { const p = this.parent as typeof parent | null; if (p) p.children = p.children.filter((x) => x !== this); this.parent = null; },
          click() { (this.handlers.click ?? []).forEach((f) => f()); },
        };
        return el;
      },
    };
  });
  afterEach(() => {
    g.document = before;
  });

  const fakeEngine = () => {
    const log: string[] = [];
    let muted = false;
    const subs = new Set<() => void>();
    return {
      log,
      get muted() { return muted; },
      unlock: () => log.push('unlock'),
      toggleMuted: () => { muted = !muted; log.push(`toggle:${muted}`); subs.forEach((f) => f()); return muted; },
      onChange: (f: () => void) => { subs.add(f); return () => subs.delete(f); },
    };
  };

  it('is a real, labelled, 44 px button on screen from the start, with a picture and no emoji', () => {
    const eng = fakeEngine();
    const b = createMuteButton(eng as never);
    const el = b.element as unknown as El;
    expect(el.tag).toBe('button');
    expect(el.type).toBe('button');
    expect(parent.children).toContain(el);
    // Phase 24: the look moved from an inline style to `.mute-button` in src/ui/theme.css (fixed, 44 x 44, never display:none)
    expect(el.className).toBe('mute-button');
    expect(el.style.cssText).toBe('');
    const css = readFileSync('src/ui/theme.css', 'utf8');
    const rule = /\.mute-button \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('width: 44px; height: 44px');
    expect(rule).not.toContain('display: none');
    expect(el.attrs['aria-label']).toBe(MUTE_LABELS.on);
    expect(el.attrs['aria-pressed']).toBe('false');
    expect(el.innerHTML).toContain('<svg');
    expect(/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(el.innerHTML)).toBe(false);
  });

  it('a tap unlocks the sound and flips mute; the label, the pressed state and the picture follow', () => {
    const eng = fakeEngine();
    const el = createMuteButton(eng as never).element as unknown as El;
    const on = el.innerHTML;
    el.click();
    expect(eng.log).toEqual(['unlock', 'toggle:true']);
    expect(el.attrs['aria-label']).toBe(MUTE_LABELS.off);
    expect(el.attrs['aria-pressed']).toBe('true');
    expect(el.innerHTML).not.toBe(on);
    el.click();
    expect(el.attrs['aria-label']).toBe(MUTE_LABELS.on);
    expect(el.attrs['aria-pressed']).toBe('false');
    expect(el.innerHTML).toBe(on);
  });

  it('follows a change made elsewhere, and dispose takes it off the page', () => {
    const eng = fakeEngine();
    const b = createMuteButton(eng as never);
    const el = b.element as unknown as El;
    eng.toggleMuted();
    expect(el.attrs['aria-pressed']).toBe('true');
    b.dispose();
    expect(parent.children).not.toContain(el);
    eng.toggleMuted();
    expect(el.attrs['aria-pressed']).toBe('true'); // no longer listening
  });
});

// ---- the offline render ------------------------------------------------------------------------------------------------------------------

describe('the offline render plans', () => {
  it('every named render has a plan with a length and items inside it', () => {
    expect(RENDER_NAMES).toEqual(['music_box', 'completion', 'chimes', 'steps', 'puff', 'release', 'purr', 'beds', 'demo']);
    for (const name of RENDER_NAMES) {
      const p = planFor(name);
      expect(p.name).toBe(name);
      expect(p.seconds).toBeGreaterThan(1);
      expect(p.seconds).toBeLessThan(60);
      expect(p.items.length).toBeGreaterThan(0);
      for (const it of p.items) {
        const at = 'ev' in it ? it.ev.at : it.at;
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThan(p.seconds);
        if ('ev' in it) expect(it.ev.at + it.ev.dur).toBeLessThanOrEqual(p.seconds + 1e-9); // nothing is cut off
      }
    }
  });

  it('the music box render plays the whole tune: 25 notes, the right pitches, in order', () => {
    const tines = planFor('music_box').items.filter((i) => i.kind === 'tine') as { kind: 'tine'; ev: { at: number; midi: number } }[];
    expect(tines).toHaveLength(25);
    expect(tines.map((t) => t.ev.midi)).toEqual(BIRTHDAY_MELODY.map((n) => n.midi));
    for (let i = 1; i < tines.length; i++) expect(tines[i]!.ev.at).toBeGreaterThan(tines[i - 1]!.ev.at);
  });

  it('the chime render is five shapes x five lines, every note in the one scale', () => {
    const ch = planFor('chimes').items.filter((i) => i.kind === 'chime') as { kind: 'chime'; ev: { midi: number } }[];
    expect(ch).toHaveLength(25);
    for (const c of ch) expect(isInScale(c.ev.midi)).toBe(true);
  });

  it('the completion render is the finished phrase', () => {
    const ch = planFor('completion').items.filter((i) => i.kind === 'chime') as { kind: 'chime'; ev: { midi: number } }[];
    expect(ch.map((c) => c.ev.midi)).toEqual(completionPhrase().map((e) => e.midi));
  });

  it('the steps are eight, each with its own seed, so no two are the same', () => {
    const st = planFor('steps').items.filter((i) => i.kind === 'step') as { kind: 'step'; seed: number }[];
    expect(st).toHaveLength(8);
    expect(new Set(st.map((s) => s.seed)).size).toBe(8);
  });

  it('the purr starts and then stops; the beds start first and turn warm; the demo has the beds first and every duck comes back up', () => {
    const purr = planFor('purr').items.filter((i) => i.kind === 'purr') as { on: boolean; at: number }[];
    expect(purr.map((p) => p.on)).toEqual([true, false]);
    expect(purr[1]!.at).toBeGreaterThan(purr[0]!.at);
    const beds = planFor('beds').items;
    expect(beds[0]!.kind).toBe('beds');
    expect(beds.some((i) => i.kind === 'mood' && i.mood === 'warm')).toBe(true);
    const demo = planFor('demo').items;
    expect(demo[0]!.kind).toBe('beds');
    const ducks = demo.filter((i) => i.kind === 'duck') as { level: number; at: number }[];
    expect(ducks.length % 2).toBe(0);
    expect(ducks[ducks.length - 1]!.level).toBe(1);
    expect(demo.filter((i) => i.kind === 'tine')).toHaveLength(25);
  });
});

describe('turning samples into a WAV', () => {
  it('toDb and peakOf', () => {
    approx(toDb(1), 0, 9);
    approx(toDb(0.5), -6.0206, 3);
    expect(toDb(0)).toBe(-Infinity);
    expect(peakOf(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7, 6);
    expect(peakOf(new Float32Array(0))).toBe(0);
  });

  it('toPcm16 maps -1..1 to the full 16-bit range, clamps, and turns NaN and Infinity into silence', () => {
    const p = toPcm16(new Float32Array([0, 1, -1, 0.5, 2, -2, NaN, Infinity]));
    expect([...p]).toEqual([0, 32767, -32768, 16384, 32767, -32768, 0, 0]);
  });

  it('wavBytes is a complete 16-bit mono PCM file with the right header', () => {
    const n = 100;
    const bytes = wavBytes(new Float32Array(n).fill(0.25), 24000);
    expect(bytes.length).toBe(44 + n * 2);
    const text = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    expect(text(12, 16)).toBe('fmt ');
    expect(text(36, 40)).toBe('data');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(v.getUint32(4, true)).toBe(36 + n * 2);
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(28, true)).toBe(48000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(n * 2);
    expect(v.getInt16(44, true)).toBe(Math.round(0.25 * 32767));
  });

  it('renderSound runs the real voices through the shared graph at the card\'s own level, and reports the peak it measured', async () => {
    const made: FakeContext[] = [];
    const makeContext = (length: number, rate: number) => {
      const c = new FakeContext();
      c.length = length;
      c.sampleRate = rate;
      made.push(c);
      return c as unknown as OfflineAudioContext;
    };
    const r = await renderSound('music_box', { makeContext });
    const c = made[0]!;
    expect(r.sampleRate).toBe(24000);
    expect(r.samples).toHaveLength(Math.ceil(planFor('music_box').seconds * 24000));
    expect(r.gain).toBe(MASTER_DEFAULT);
    expect(c.of('gain').some((g) => g.gain.value === MASTER_DEFAULT)).toBe(true);
    expect(c.of('compressor')).toHaveLength(1);
    expect(c.startedCount('osc')).toBe(50); // 25 tines x 2
    approx(r.peak, 0.5, 6); // what the fake handed back
    approx(r.peakDb, -6.0206, 3);
    // the level can be raised for the worst case
    const loud = await renderSound('demo', { makeContext, gain: MASTER_MAX });
    expect(loud.gain).toBe(MASTER_MAX);
    const master = made[1]!.of('gain').find((x) => x.out[0] === made[1]!.of('compressor')[0])!;
    expect(master.gain.value).toBe(MASTER_MAX);
    // the demo wakes the beds and the breathing is laid out ahead
    expect(made[1]!.startedCount('osc')).toBeGreaterThan(50);
  });

  it('every render name can be rendered through the fake without throwing', async () => {
    for (const name of RENDER_NAMES as readonly RenderName[]) {
      const r = await renderSound(name, {
        makeContext: (length, rate) => {
          const c = new FakeContext();
          c.length = length;
          c.sampleRate = rate;
          return c as unknown as OfflineAudioContext;
        },
      });
      expect(r.samples.length).toBeGreaterThan(24000);
    }
  });
});
