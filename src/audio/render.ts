import {
  MASTER_DEFAULT, MUSIC_BOX_BPM, RELEASE_HUSH_S, candlePuff, chimeIndexForLine, completionPhrase, duckTarget, footstep, makeRng, melodyEvents, placePhrase, scaleMidi, swellSeconds,
  DUCK_ATTACK_S, DUCK_RELEASE_S, type Mood, type NoteEvent,
} from './audioMath';
import { buildGraph } from './graph';
import { playPuff, playStep, playSwell, ringChime, ringTine } from './voices';

// Phase 23: an OFFLINE render of the sounds, through exactly the graph and the voices the page uses (graph.ts, voices.ts), so the owner can listen to the music box,
// the chimes, the steps, the purr and the beds as WAV files without a phone. `tools/render_music_box.py` drives this in headless Chromium.
// What this proves: the notes are the right notes, nothing clips, the sounds are not broken. What it does NOT prove: how they sound on her phone speaker.

export const RENDER_RATE = 24000;

export type RenderName = 'music_box' | 'completion' | 'chimes' | 'steps' | 'puff' | 'release' | 'purr' | 'beds' | 'demo';
export const RENDER_NAMES: readonly RenderName[] = ['music_box', 'completion', 'chimes', 'steps', 'puff', 'release', 'purr', 'beds', 'demo'];

/** The shape ids of content/names.json (the chime for a line depends on the shape it belongs to). */
const SHAPE_IDS = ['strawberry', 'bumblebee', 'rose', 'kaaju-katli', 'cutie-patootie'] as const;

// ---- the plan: what happens when, as plain data (no Web Audio, so it can be tested) --------------------------------------------------------

export type Item =
  | { kind: 'tine'; ev: NoteEvent }
  | { kind: 'chime'; ev: NoteEvent }
  | { kind: 'step'; at: number; seed: number }
  | { kind: 'puff'; at: number; seed: number }
  | { kind: 'swell'; at: number }
  | { kind: 'purr'; on: boolean; at: number }
  | { kind: 'beds'; at: number }
  | { kind: 'mood'; mood: Mood; at: number }
  | { kind: 'duck'; level: number; at: number };

export interface Plan {
  name: RenderName;
  seconds: number;
  items: Item[];
}

const TAIL = 0.6;

function chimeRun(shape: string, lines: number, start: number, gap: number): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < lines; i++) out.push({ kind: 'chime', ev: { at: start + i * gap, midi: scaleMidi(chimeIndexForLine(shape, i)), dur: 1.6, gain: 0.4 } });
  return out;
}
function steps(count: number, start: number, gap: number, seed = 2026): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < count; i++) out.push({ kind: 'step', at: start + i * gap, seed: seed + i });
  return out;
}
/** Phase 25: the five candles going out, as the machine times a steady breath (the first after 0.35 s of effort, each next 0.3 s later), one puff each. */
function puffs(start: number, seed = 2025): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < 5; i++) out.push({ kind: 'puff', at: start + (i === 0 ? 0 : 0.35 + (i - 1) * 0.3 + 0.3), seed: seed + i });
  return out;
}
function endOf(items: readonly Item[]): number {
  let end = 0;
  for (const it of items) {
    if (it.kind === 'tine' || it.kind === 'chime') end = Math.max(end, it.ev.at + it.ev.dur);
    else if (it.kind === 'step') end = Math.max(end, it.at + 0.3);
    else if (it.kind === 'puff') end = Math.max(end, it.at + 0.4);
    else if (it.kind === 'swell') end = Math.max(end, it.at + swellSeconds());
    else end = Math.max(end, it.at);
  }
  return end;
}

export function planFor(name: RenderName): Plan {
  let items: Item[] = [];
  let floor = 0;
  switch (name) {
    case 'music_box':
      items = placePhrase(melodyEvents(MUSIC_BOX_BPM), 0.3).map((ev) => ({ kind: 'tine' as const, ev }));
      break;
    case 'completion':
      items = placePhrase(completionPhrase(), 0.3).map((ev) => ({ kind: 'chime' as const, ev }));
      break;
    case 'chimes':
      // five shapes, five lines each: a rising run per shape, the way the sky will sound
      SHAPE_IDS.forEach((id, k) => items.push(...chimeRun(id, 5, 0.3 + k * 3.2, 0.42)));
      break;
    case 'steps':
      items = steps(8, 0.3, 0.46);
      break;
    case 'puff':
      // the cake moment as it sounds: the cool bed, the hush under the wish, then five puffs (the hush lifts when the last candle is out)
      items = [
        { kind: 'beds', at: 0 },
        { kind: 'duck', level: duckTarget(['hush']), at: 0.5 },
        ...puffs(3),
        { kind: 'duck', level: duckTarget([]), at: 5.6 },
      ];
      floor = 8;
      break;
    case 'release':
      // the beat after the candles as it sounds: the cool bed, the hush as the release starts, quiet for the hush time, then the hush lifts and the swell opens above the bed
      items = [
        { kind: 'beds', at: 0 },
        { kind: 'duck', level: duckTarget(['hush']), at: 1 },
        { kind: 'duck', level: duckTarget([]), at: 1 + RELEASE_HUSH_S },
        { kind: 'swell', at: 1 + RELEASE_HUSH_S },
      ];
      floor = 12;
      break;
    case 'purr':
      items = [{ kind: 'purr', on: true, at: 0.3 }, { kind: 'purr', on: false, at: 6 }];
      floor = 8;
      break;
    case 'beds':
      // sixteen seconds: the cool meadow bed, then it turns warm (the nook) at eight
      items = [{ kind: 'beds', at: 0 }, { kind: 'mood', mood: 'warm', at: 8 }];
      floor = 16;
      break;
    case 'demo': {
      // everything once, in the order a visit goes, with the beds under it and the duck and the mood changes: the loudest honest case
      items = [
        { kind: 'beds', at: 0 },
        ...chimeRun('strawberry', 5, 4, 0.42),
        ...placePhrase(completionPhrase(), 6.6).map((ev) => ({ kind: 'chime' as const, ev })),
        { kind: 'duck', level: duckTarget(['wish']), at: 7 },
        { kind: 'duck', level: duckTarget([]), at: 11 },
        ...steps(6, 12.5, 0.46),
        { kind: 'mood', mood: 'warm', at: 16 },
        { kind: 'purr', on: true, at: 17 },
        { kind: 'purr', on: false, at: 23 },
        { kind: 'mood', mood: 'cool', at: 25 },
        { kind: 'duck', level: duckTarget(['letter']), at: 27 },
        { kind: 'duck', level: duckTarget([]), at: 31 },
        ...placePhrase(melodyEvents(MUSIC_BOX_BPM), 33).map((ev) => ({ kind: 'tine' as const, ev })),
      ];
      break;
    }
  }
  const seconds = Math.max(floor, Math.ceil((endOf(items) + TAIL) * 10) / 10);
  return { name, seconds, items };
}

// ---- turning samples into a file ----------------------------------------------------------------------------------------------------------

/** Largest absolute sample (linear). */
export function peakOf(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > p) p = a;
  }
  return p;
}

export function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

/** 16-bit signed samples; anything outside -1..1 is clamped (a clipped file is reported by the peak, never hidden). */
export function toPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, Number.isFinite(samples[i]!) ? samples[i]! : 0));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}

/** A complete mono 16-bit PCM WAV file. */
export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  const pcm = toPcm16(samples);
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i]!, true);
  return new Uint8Array(buf);
}

// ---- the render itself --------------------------------------------------------------------------------------------------------------------

export interface Rendered {
  name: RenderName;
  sampleRate: number;
  seconds: number;
  /** the master level used (the card's own default unless asked otherwise) */
  gain: number;
  samples: Float32Array;
  peak: number;
  peakDb: number;
}

export interface RenderOptions {
  /** the master level (default: the card's own default, so the file is as loud as the card at its default) */
  gain?: number;
  sampleRate?: number;
  /** tests and odd browsers can bring their own offline context */
  makeContext?: (length: number, sampleRate: number) => OfflineAudioContext;
}

export async function renderSound(name: RenderName, o: RenderOptions = {}): Promise<Rendered> {
  const rate = o.sampleRate ?? RENDER_RATE;
  const gain = o.gain ?? MASTER_DEFAULT;
  const plan = planFor(name);
  const length = Math.ceil(plan.seconds * rate);
  const ctx = o.makeContext ? o.makeContext(length, rate) : new OfflineAudioContext(1, length, rate);
  const g = buildGraph(ctx, { gain });
  const wantsBeds = plan.items.some((i) => i.kind === 'beds');
  for (const it of plan.items) {
    switch (it.kind) {
      case 'tine':
        ringTine(ctx, g.sfx, it.ev);
        break;
      case 'chime':
        ringChime(ctx, g.sfx, it.ev);
        break;
      case 'step':
        playStep(ctx, g.sfx, g.white, it.at, footstep(makeRng(it.seed)));
        break;
      case 'puff':
        playPuff(ctx, g.sfx, g.white, it.at, candlePuff(makeRng(it.seed)));
        break;
      case 'swell':
        playSwell(ctx, g.sfx, it.at);
        break;
      case 'purr':
        if (it.on) g.purr.start(it.at);
        else g.purr.stop(it.at);
        break;
      case 'beds':
        g.beds.setMood('cool', it.at);
        g.beds.start(it.at, 3);
        break;
      case 'mood':
        g.beds.setMood(it.mood, it.at);
        break;
      case 'duck': {
        const down = it.level < 1;
        g.duck.gain.setTargetAtTime(it.level, it.at, down ? DUCK_ATTACK_S : DUCK_RELEASE_S);
        break;
      }
    }
  }
  if (wantsBeds) {
    // in the page a timer lets the wind breathe a few times a second; offline the same calls are laid out ahead
    for (let t = 0; t < plan.seconds; t += 0.7) g.beds.breathe(t);
  }
  const buf = await ctx.startRendering();
  const samples = buf.getChannelData(0).slice();
  const peak = peakOf(samples);
  return { name, sampleRate: rate, seconds: plan.seconds, gain, samples, peak, peakDb: toDb(peak) };
}
