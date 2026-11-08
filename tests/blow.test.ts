import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyseFrame, BlowDetector, BLOW_DEFAULTS, type BlowFeatures } from '../src/audio/blow';
import { makeRng } from '../src/audio/audioMath';

// Phase 25: the blow detector on SYNTHETIC buffers (breath vs speech vs silence and the other usual suspects). The real microphone is an owner-device gap.
const FS = 16000;
const N = 1024; // one frame, 64 ms
const FRAME_S = N / FS;

type Gen = (i: number, rng: () => number) => number;

/** run a generator for `seconds`, through the real feature pass and the detector; returns every reading */
function run(gen: Gen, seconds: number, opts: { room?: number; seed?: number; amp?: number } = {}) {
  const det = new BlowDetector();
  const rng = makeRng(opts.seed ?? 5);
  const out: ReturnType<BlowDetector['push']>[] = [];
  const feats: BlowFeatures[] = [];
  const frames = Math.ceil(seconds / FRAME_S);
  // half a second of quiet room first, as the page does
  const quiet = Math.ceil(0.5 / FRAME_S);
  let n = 0;
  for (let f = 0; f < frames + quiet; f++) {
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++, n++) {
      const room = (opts.room ?? 0.003) * (rng() * 2 - 1);
      buf[i] = room + (f >= quiet ? gen(n - quiet * N, rng) * (opts.amp ?? 1) : 0);
    }
    const ft = analyseFrame(buf, FS);
    feats.push(ft);
    out.push(det.push(ft, FRAME_S));
  }
  return { out: out.slice(quiet), feats: feats.slice(quiet), all: out };
}

/** breath: noise squeezed low (a few one-pole passes at ~450 Hz) with a little hiss, rising and falling like a puff */
function breath(level = 0.2, hiss = 0.12): Gen {
  let a = 0, b = 0, c = 0;
  const k = 1 - Math.exp((-2 * Math.PI * 450) / FS);
  return (i, rng) => {
    const w = rng() * 2 - 1;
    a += k * (w - a); b += k * (a - b); c += k * (b - c);
    const t = i / FS;
    const env = Math.min(1, t / 0.08);
    return level * env * (c * 5.5 + hiss * w);
  };
}
/** voiced speech: a 120 Hz buzz with vowel-ish partials and a 4 Hz syllable rhythm */
function speech(f0 = 120, level = 0.2): Gen {
  return (i) => {
    const t = i / FS;
    let s = 0;
    for (let h = 1; h <= 14; h++) s += Math.sin(2 * Math.PI * f0 * h * t) * (h * f0 > 600 && h * f0 < 1200 ? 1 : 1 / h);
    return level * 0.35 * s * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t));
  };
}
const whistle = (hz = 900, level = 0.2): Gen => (i) => level * Math.sin((2 * Math.PI * hz * i) / FS);
const hum = (hz = 60, level = 0.2): Gen => (i) => level * Math.sin((2 * Math.PI * hz * i) / FS);
/** an "s": high-passed hiss */
function hiss(level = 0.2): Gen {
  let prev = 0;
  return (_i, rng) => {
    const w = rng() * 2 - 1;
    const o = w - prev;
    prev = w;
    return level * o * 0.7;
  };
}
/** a clap: one loud broadband burst of 30 ms, then room */
const clap: Gen = (i, rng) => (i < 0.03 * FS ? (rng() * 2 - 1) * 0.9 * Math.exp(-i / (0.01 * FS)) : 0);

const blown = (r: { out: { blowing: boolean }[] }) => r.out.some((x) => x.blowing);

describe('analyseFrame', () => {
  it('reads silence, empty, NaN and a bad sample rate as nothing, never throws', () => {
    expect(analyseFrame(new Float32Array(N), FS).rms).toBe(0);
    expect(analyseFrame([], FS).rms).toBe(0);
    const bad = new Float32Array(N).fill(0.1);
    bad[10] = NaN;
    expect(analyseFrame(bad, FS)).toEqual({ rms: 0, low: 0, zcrHz: 0, pitched: 0 });
    expect(analyseFrame(new Float32Array(N).fill(0.3), 0).rms).toBe(0);
    expect(analyseFrame(new Float32Array(N).fill(0.3), FS).rms).toBe(0); // a flat line has no signal once the average is gone
  });
  it('breath is noisy, low and not pitched; speech and a whistle are pitched', () => {
    const b = run(breath(), 1).feats.slice(4);
    const s = run(speech(), 1).feats.slice(4);
    const w = run(whistle(), 1).feats.slice(4);
    const avg = (f: BlowFeatures[], k: keyof BlowFeatures) => f.reduce((x, y) => x + y[k], 0) / f.length;
    expect(avg(b, 'pitched')).toBeLessThan(0.4);
    expect(avg(b, 'low')).toBeGreaterThan(0.5);
    expect(avg(s, 'pitched')).toBeGreaterThan(0.6);
    expect(avg(w, 'pitched')).toBeGreaterThan(0.6);
  });
  it('a hiss is not low', () => {
    const h = run(hiss(), 1).feats.slice(4);
    expect(h.reduce((x, y) => x + y.low, 0) / h.length).toBeLessThan(0.3);
  });
  it('is deterministic', () => {
    expect(run(breath(), 1, { seed: 3 }).feats).toEqual(run(breath(), 1, { seed: 3 }).feats);
  });
});

describe('BlowDetector on synthetic sound', () => {
  it('a steady breath blows, and strength is up while it lasts', () => {
    const r = run(breath(0.25), 1.2);
    expect(blown(r)).toBe(true);
    expect(Math.max(...r.out.map((x) => x.strength))).toBeGreaterThan(0.3);
  });
  it('a harder breath reads stronger than a soft one', () => {
    const soft = Math.max(...run(breath(0.1), 1.2).out.map((x) => x.strength));
    const hard = Math.max(...run(breath(0.4), 1.2).out.map((x) => x.strength));
    expect(hard).toBeGreaterThan(soft);
  });
  it('silence never blows', () => {
    expect(blown(run(() => 0, 3))).toBe(false);
  });
  it('speech never blows, at several pitches and loudnesses', () => {
    for (const f0 of [90, 120, 180, 260]) for (const level of [0.1, 0.3, 0.6]) expect(blown(run(speech(f0, level), 3))).toBe(false);
  });
  it('a whistle, a hum and an "s" never blow', () => {
    expect(blown(run(whistle(), 3))).toBe(false);
    expect(blown(run(whistle(400, 0.5), 3))).toBe(false);
    expect(blown(run(hum(60), 3))).toBe(false);
    expect(blown(run(hum(120, 0.5), 3))).toBe(false);
    expect(blown(run(hiss(0.5), 3))).toBe(false);
  });
  it('a clap (one loud frame) never blows', () => {
    const det = new BlowDetector();
    const rng = makeRng(1);
    let any = false;
    for (let f = 0; f < 40; f++) {
      const buf = new Float32Array(N);
      for (let i = 0; i < N; i++) buf[i] = 0.003 * (rng() * 2 - 1) + (f === 20 ? clap(i, rng) : 0);
      any = det.push(analyseFrame(buf, FS), FRAME_S).blowing || any;
    }
    expect(any).toBe(false);
  });
  it('a short puff under the needed length does not count; a long one does', () => {
    const short = run((i, rng) => (i < 0.2 * FS ? breath(0.3)(i, rng) : 0), 1.5);
    expect(blown(short)).toBe(false);
    expect(blown(run(breath(0.3), 1.5))).toBe(true);
  });
  it('a breath in a noisy room still counts, the room alone does not', () => {
    expect(blown(run(() => 0, 3, { room: 0.015 }))).toBe(false);
    expect(blown(run(breath(0.5), 1.5, { room: 0.015 }))).toBe(true);
  });
  it('speech then a breath: only the breath blows', () => {
    const b = breath(0.3);
    const r = run((i, rng) => (i < 1.5 * FS ? speech(130, 0.3)(i, rng) : b(i - 1.5 * FS, rng)), 3.2);
    const firstBlow = r.out.findIndex((x) => x.blowing);
    expect(firstBlow).toBeGreaterThan(Math.floor((1.5 / FRAME_S) | 0) - 1);
  });
  it('effort drains once the breath stops, strength eases to 0', () => {
    const b = breath(0.3);
    const r = run((i, rng) => (i < 1 * FS ? b(i, rng) : 0), 3);
    expect(r.out[r.out.length - 1]!.effort).toBe(0);
    expect(r.out[r.out.length - 1]!.strength).toBeLessThan(0.02);
  });
  it('says nothing while it is listening to the room', () => {
    const det = new BlowDetector();
    const r = det.push({ rms: 0.5, low: 1, zcrHz: 600, pitched: 0 }, 0.05);
    expect(r.calibrating).toBe(true);
    expect(r.blowing).toBe(false);
  });
  it('bad frame times and bad features cannot break it', () => {
    const det = new BlowDetector();
    for (const dt of [NaN, -1, 0, Infinity, 1e9]) {
      const r = det.push({ rms: NaN, low: NaN, zcrHz: NaN, pitched: NaN }, dt);
      expect(Number.isFinite(r.strength)).toBe(true);
      expect(Number.isFinite(r.effort)).toBe(true);
    }
  });
  it('the needed length is a third of a second or more', () => {
    expect(BLOW_DEFAULTS.needS).toBeGreaterThanOrEqual(0.3);
  });
});

describe('purity', () => {
  it('blow.ts has no DOM, no Web Audio, no clock, no random', () => {
    const src = readFileSync('src/audio/blow.ts', 'utf8').replace(/\/\/.*$/gm, '');
    for (const bad of ['window', 'document', 'AudioContext', 'Date.now', 'performance.now', 'Math.random', "from 'three'"]) expect(src.includes(bad)).toBe(false);
  });
});
