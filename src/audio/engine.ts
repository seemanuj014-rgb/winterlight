import type { Bus } from '../state/events';
import type { WinterEvents } from '../state/events';
import {
  DUCK_ATTACK_S, DUCK_RELEASE_S, LATE_DROP_S, MASTER_DEFAULT, MUSIC_BOX_BPM, MUTE_FADE_S, MUTE_KEY,
  LookaheadQueue, candlePuff, chimeIndexForLine, clampVolume, completionPhrase, duckTarget, footstep, makeRng, melodyEvents, moodForAct,
  nextAudioState, parseMuted, placePhrase, scaleMidi, serializeMuted, shouldResume,
  type AudioEvent, type AudioState, type DuckReason, type Mood, type NoteEvent,
} from './audioMath';
import { buildGraph } from './graph';
import { createMusic, musicTarget, type Music } from './music';
import { playPuff, playStep, playSwell, ringChime, ringTine, type Beds, type Loop } from './voices';

// Phase 23: the rules for when the Web Audio graph (built in graph.ts) may make a sound.
//
// Silence and NO AudioContext until the viewer's first touch or key press (iOS and every other browser insist). A touch builds the graph and calls resume()
// inside that touch. Coming back to the page after it was hidden tries again. The mute switch is remembered and starts at "not muted, but quiet".
// Everything is a quiet no-op where Web Audio does not exist, and nothing here ever throws into the card.

export interface AudioEngine {
  readonly state: AudioState;
  readonly muted: boolean;
  readonly volume: number;
  /** try to start (call from inside a touch or key press); the engine also does this itself on the first gesture */
  unlock(): void;
  setMuted(on: boolean): void;
  toggleMuted(): boolean;
  setVolume(v: number): void;
  setMood(m: Mood): void;
  /** a beds-and-effects duck while a card or the letter is open */
  duck(reason: DuckReason, on: boolean): void;
  chime(index: number): void;
  completion(): void;
  footstep(): void;
  /** Phase 25: one candle goes out */
  puff(): void;
  /** Phase 26: the swell as the lanterns let go */
  swell(): void;
  purr(on: boolean): void;
  /** the music-box "Happy Birthday" (finale). Returns the length in seconds, or 0 if nothing could play. */
  birthday(): number;
  /** connect to the card's events (any number of buses: the scene modules each own one) */
  listen(bus: Bus<WinterEvents>): () => void;
  /** called when the state or mute changes (the mute button follows it) */
  onChange(fn: () => void): () => void;
  dispose(): void;
}

export interface AudioOptions {
  /** reduced motion also means calmer sound: no wind swells' extra, the beds start quieter. Currently only the beds' level follows it. */
  reducedMotion?: boolean;
  /** tests give a fake context; the page lets it default */
  contextFactory?: () => AudioContext | null;
  /** the looping background music (a path under the site). Left out = no music. */
  musicUrl?: string;
  /** tests give a fake store */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

type Win = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

function defaultContext(): AudioContext | null {
  const w = globalThis as unknown as Win;
  const C = w.AudioContext ?? w.webkitAudioContext;
  if (!C) return null;
  try {
    return new C({ latencyHint: 'playback' });
  } catch {
    return null;
  }
}

export function createAudioEngine(o: AudioOptions = {}): AudioEngine {
  const storage = o.storage === undefined ? safeLocalStorage() : o.storage;
  let muted = false;
  try {
    muted = parseMuted(storage?.getItem(MUTE_KEY));
  } catch {
    muted = false;
  }
  let volume = MASTER_DEFAULT;
  let state: AudioState = 'locked';
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let duckGain: GainNode | null = null;
  let sfx: GainNode | null = null;
  let beds: Beds | null = null;
  let purrLoop: Loop | null = null;
  let music: Music | null = null;
  let white: AudioBuffer | null = null;
  let breatheTimer: number | undefined;
  let melodyTimer: number | undefined;
  const queue = new LookaheadQueue<NoteEvent>();
  const ducks = new Set<DuckReason>();
  const rng = makeRng(2026);
  let mood: Mood = 'cool';
  let purring = false;
  let lineCounter = 0;
  const listeners = new Set<() => void>();
  const offs: (() => void)[] = [];
  const changed = (): void => {
    for (const f of [...listeners]) {
      try {
        f();
      } catch {
        /* a listener must not stop the audio */
      }
    }
  };

  const feed = (e: AudioEvent): void => {
    const was = state;
    state = nextAudioState(state, e);
    if (state !== was) changed();
  };

  function build(): boolean {
    if (ctx) return true;
    let c: AudioContext | null = null;
    try {
      c = (o.contextFactory ?? defaultContext)();
    } catch {
      c = null; // a browser that refuses to make one: same as no Web Audio
    }
    if (!c) {
      feed('no-api');
      return false;
    }
    let g: ReturnType<typeof buildGraph>;
    try {
      g = buildGraph(c, { gain: muted ? 0 : volume, reducedMotion: o.reducedMotion });
    } catch {
      // a browser with a half-working Web Audio: stay quiet for good, never throw into the card
      try {
        void c.close();
      } catch {
        /* ignore */
      }
      feed('no-api');
      return false;
    }
    ctx = c;
    master = g.master;
    duckGain = g.duck;
    sfx = g.sfx;
    beds = g.beds;
    purrLoop = g.purr;
    white = g.white;
    if (o.musicUrl) music = createMusic(c, g.master, o.musicUrl);
    c.addEventListener?.('statechange', onCtxState);
    return true;
  }

  const onCtxState = (): void => {
    if (!ctx) return;
    if (ctx.state === 'running') {
      feed('ctx-running');
      startBeds();
      music?.start();
    } else if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') feed('ctx-suspended');
  };

  function startBeds(): void {
    if (!ctx || !beds) return;
    const t = ctx.currentTime;
    beds.setMood(mood, t);
    beds.start(t, 3);
    beds.breathe(t);
    if (breatheTimer === undefined) {
      breatheTimer = window.setInterval(() => {
        if (ctx && ctx.state === 'running') beds?.breathe(ctx.currentTime);
      }, 700);
    }
    if (purring) purrLoop?.start(t);
  }

  function resume(): void {
    if (!ctx) return;
    try {
      const p = ctx.resume();
      if (p && typeof p.then === 'function') p.then(onCtxState, () => feed('ctx-suspended'));
      else onCtxState();
    } catch {
      feed('ctx-suspended');
    }
  }

  function unlock(): void {
    if (state === 'unsupported') return;
    if (!build()) return;
    if (shouldResume(state, 'gesture')) resume();
    music?.start(); // inside the touch, which iOS insists on
    // iOS wants a sound started inside the gesture; one silent sample does it
    try {
      if (ctx) {
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      }
    } catch {
      /* not needed on most browsers */
    }
  }

  // the first gesture, anywhere, unlocks (capture phase, so nothing in the card can swallow it); later gestures re-try if the browser suspended us
  const gestureEvents = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
  const onGesture = (): void => {
    if (state === 'locked' || state === 'suspended') unlock();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      feed('hidden');
      music?.pause();
      // a hidden tab should not keep playing a tune to nobody
      try {
        void ctx?.suspend();
      } catch {
        /* ignore */
      }
    } else if (shouldResume(state, 'visible')) {
      resume();
      music?.resume();
    }
  };
  if (typeof window !== 'undefined') {
    for (const ev of gestureEvents) window.addEventListener(ev, onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
  }

  function now(): number {
    return ctx ? ctx.currentTime : 0;
  }
  function live(): boolean {
    return !!ctx && state === 'running' && !!sfx;
  }

  function applyMaster(): void {
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(muted ? 0 : volume, now(), MUTE_FADE_S);
  }
  function applyDuck(): void {
    if (!ctx || !duckGain) return;
    music?.setDuck(musicTarget(ducks));
    const target = duckTarget(ducks);
    duckGain.gain.setTargetAtTime(target, now(), target < duckGain.gain.value ? DUCK_ATTACK_S : DUCK_RELEASE_S);
  }

  function playNotes(events: NoteEvent[], voice: typeof ringChime): void {
    if (!live() || !ctx || !sfx) return;
    const t0 = now() + 0.03;
    for (const e of placePhrase(events, t0)) voice(ctx, sfx, e);
  }

  const api: AudioEngine = {
    get state() {
      return state;
    },
    get muted() {
      return muted;
    },
    get volume() {
      return volume;
    },
    unlock,
    setMuted(on) {
      if (on === muted) return;
      muted = on;
      try {
        storage?.setItem(MUTE_KEY, serializeMuted(on));
      } catch {
        /* private mode: the choice lasts this visit only */
      }
      applyMaster();
      if (on) {
        // stop a tune that is still being fed to the clock
        queue.clear();
        if (melodyTimer !== undefined) {
          window.clearInterval(melodyTimer);
          melodyTimer = undefined;
        }
      }
      changed();
    },
    toggleMuted() {
      api.setMuted(!muted);
      return muted;
    },
    setVolume(v) {
      volume = clampVolume(v);
      applyMaster();
    },
    setMood(m) {
      mood = m;
      if (ctx && beds && state === 'running') beds.setMood(m, now());
    },
    duck(reason, on) {
      if (on) ducks.add(reason);
      else ducks.delete(reason);
      applyDuck();
    },
    chime(index) {
      playNotes([{ at: 0, midi: scaleMidi(index), dur: 1.6, gain: 0.4 }], ringChime);
    },
    completion() {
      playNotes(completionPhrase(), ringChime);
    },
    footstep() {
      if (!live() || !ctx || !sfx || !white) return;
      playStep(ctx, sfx, white, now() + 0.01, footstep(rng));
    },
    puff() {
      if (!live() || !ctx || !sfx || !white) return;
      playPuff(ctx, sfx, white, now() + 0.01, candlePuff(rng));
    },
    swell() {
      if (!live() || !ctx || !sfx) return;
      playSwell(ctx, sfx, now() + 0.02);
    },
    purr(on) {
      purring = on;
      if (!ctx || !purrLoop || state !== 'running') return;
      if (on) purrLoop.start(now());
      else purrLoop.stop(now());
    },
    birthday() {
      if (!live() || !ctx || !sfx || muted) return 0;
      const events = placePhrase(melodyEvents(MUSIC_BOX_BPM), now() + 0.2);
      queue.clear();
      queue.push(events);
      const last = events[events.length - 1]!;
      const pump = (): void => {
        if (!ctx || !sfx) return;
        for (const { event, late } of queue.pump(ctx.currentTime)) {
          if (late && ctx.currentTime - event.at > LATE_DROP_S) continue; // the phone slept through it: skip, do not blurt
          ringTine(ctx, sfx, { ...event, at: Math.max(event.at, ctx.currentTime) });
        }
        if (queue.size === 0 && melodyTimer !== undefined) {
          window.clearInterval(melodyTimer);
          melodyTimer = undefined;
        }
      };
      if (melodyTimer !== undefined) window.clearInterval(melodyTimer);
      melodyTimer = window.setInterval(pump, 100);
      pump();
      return last.at + last.dur - now();
    },
    listen(bus) {
      const subs = [
        bus.on('constellation:done', () => api.completion()),
        bus.on('star:connect', (e) => api.chime(chimeIndexForLine(e.shape, e.line ?? lineCounter++))),
        bus.on('wish:show', () => api.duck('wish', true)),
        bus.on('wish:hide', () => api.duck('wish', false)),
        bus.on('letter:open', () => api.duck('letter', true)),
        bus.on('letter:close', () => api.duck('letter', false)),
        bus.on('act:enter', (e) => api.setMood(moodForAct(e.act))),
        bus.on('footstep', () => api.footstep()),
        bus.on('candle:out', () => api.puff()),
        bus.on('cake:wish', (e) => api.duck('hush', e.on)),
        // Phase 26: the quiet beat after the candles (the beds hush), then the swell as the lanterns let go (the hush lifts, slowly, under it)
        bus.on('release:start', () => api.duck('hush', true)),
        bus.on('release:burst', () => {
          api.duck('hush', false);
          api.swell();
        }),
        // Phase 28: the finale's swell (the aurora) is where the music box plays. The tune is the existing `birthday()`; it replaces a tune still ringing (a replay) and does nothing while muted.
        bus.on('finale:swell', () => void api.birthday()),
        // the music box has the finale to itself; the background music is back when she is in stay a while
        bus.on('finale:start', () => api.duck('finale', true)),
        bus.on('stay:enter', () => api.duck('finale', false)),
        bus.on('pet:purr', (e) => api.purr(e.on)),
      ];
      const off = (): void => subs.forEach((s) => s());
      offs.push(off);
      return off;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      offs.forEach((f) => f());
      offs.length = 0;
      if (typeof window !== 'undefined') {
        for (const ev of gestureEvents) window.removeEventListener(ev, onGesture, { capture: true });
        document.removeEventListener('visibilitychange', onVisibility);
        if (breatheTimer !== undefined) window.clearInterval(breatheTimer);
        if (melodyTimer !== undefined) window.clearInterval(melodyTimer);
      }
      breatheTimer = melodyTimer = undefined;
      listeners.clear();
      try {
        void ctx?.close();
      } catch {
        /* ignore */
      }
      music?.dispose();
      music = null;
      ctx = null;
    },
  };
  return api;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
