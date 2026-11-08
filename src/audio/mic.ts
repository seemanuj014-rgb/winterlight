// Phase 25: the microphone, only for blowing out the candles. Not pure (it touches the browser), but it holds no logic of its own: it reads a stretch of sound every
// ~50 ms, hands it to `analyseFrame` + `BlowDetector` (blow.ts, tested on synthetic buffers) and reports the reading.
//
// Rules from AUDIO_SPEC / the phase: ask for the microphone ONLY when the candle moment begins (the caller decides when), never show any UI of our own, resolve quietly when
// it is denied, missing or throws (the tap fallback always works), keep no recording (the samples are measured and dropped; nothing is stored or sent), stop every track
// and close the context on `stop()`, when the tab is hidden, and when the stream ends by itself.
//
// Everything the browser provides comes in through `MicEnv`, so tests can pass a fake `getUserMedia` (tests/cake.test.ts). The default env is the real browser.

import { analyseFrame, BlowDetector, type BlowReading } from './blow';

export type MicResult = 'granted' | 'denied' | 'unsupported';

/** The slice of the browser this file uses. The default is the real one; tests pass fakes. */
export interface MicEnv {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createContext?: () => AudioContext;
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  /** seconds, monotonic */
  now: () => number;
  /** call `fn` when the page is hidden; returns the way to stop listening */
  onHidden: (fn: () => void) => () => void;
}

export interface MicOptions {
  /** called about every 50 ms while listening */
  onReading: (r: BlowReading) => void;
  env?: Partial<MicEnv>;
  /** how often to read, ms */
  everyMs?: number;
}

export interface Mic {
  /** Ask for the microphone and start listening. Never throws and never shows UI. Asking twice is fine. */
  request(): Promise<MicResult>;
  /** Stop every track and close the context. Safe to call any time, any number of times. */
  stop(): void;
  readonly listening: boolean;
  /** what the last `request()` said, or null before one */
  readonly result: MicResult | null;
}

/** What a breath measurement is asked of the browser: no processing that would flatten a breath into silence. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};

const FFT_SIZE = 2048;

function browserEnv(): MicEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const md = nav?.mediaDevices;
  const Ctor: (typeof AudioContext) | undefined =
    typeof window !== 'undefined'
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  return {
    getUserMedia: md && typeof md.getUserMedia === 'function' ? (c) => md.getUserMedia(c) : undefined,
    createContext: Ctor ? () => new Ctor() : undefined,
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id),
    now: () => performance.now() / 1000,
    onHidden: (fn) => {
      if (typeof document === 'undefined') return () => {};
      const h = (): void => {
        if (document.hidden) fn();
      };
      document.addEventListener('visibilitychange', h);
      return () => document.removeEventListener('visibilitychange', h);
    },
  };
}

export function createMic(opts: MicOptions): Mic {
  const env: MicEnv = { ...browserEnv(), ...opts.env };
  const everyMs = Math.max(20, opts.everyMs ?? 50);
  const detector = new BlowDetector();

  let result: MicResult | null = null;
  let pending: Promise<MicResult> | null = null;
  let listening = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let timer: number | undefined;
  let offHidden: (() => void) | null = null;
  // bumped by stop(): a request that finishes after a stop() must not start listening
  let epoch = 0;

  function stop(): void {
    epoch++;
    pending = null;
    if (timer !== undefined) {
      try {
        env.clearInterval(timer);
      } catch {
        /* nothing to do */
      }
      timer = undefined;
    }
    if (offHidden) {
      offHidden();
      offHidden = null;
    }
    if (stream) {
      try {
        for (const t of stream.getTracks()) {
          try {
            t.onended = null;
            t.stop();
          } catch {
            /* a track that will not stop is already gone */
          }
        }
      } catch {
        /* ignore */
      }
      stream = null;
    }
    if (ctx) {
      try {
        void ctx.close()?.catch?.(() => {});
      } catch {
        /* ignore */
      }
      ctx = null;
    }
    listening = false;
  }

  async function start(myEpoch: number): Promise<MicResult> {
    if (!env.getUserMedia || !env.createContext) return 'unsupported';
    let s: MediaStream;
    try {
      s = await env.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      return 'denied'; // refused, no device, or any failure: all the same to the card (it shows nothing)
    }
    if (myEpoch !== epoch) {
      // stopped while the prompt was open: let go at once
      try {
        for (const t of s.getTracks()) t.stop();
      } catch {
        /* ignore */
      }
      return 'denied';
    }
    let c: AudioContext;
    let analyser: AnalyserNode;
    try {
      c = env.createContext!();
      const source = c.createMediaStreamSource(s);
      analyser = c.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser); // not connected to the speakers: the microphone is never played back
      void c.resume?.()?.catch?.(() => {});
    } catch {
      try {
        for (const t of s.getTracks()) t.stop();
      } catch {
        /* ignore */
      }
      return 'unsupported';
    }
    stream = s;
    ctx = c;
    detector.reset();
    const buf = new Float32Array(analyser.fftSize);
    let last = env.now();
    for (const t of s.getTracks()) t.onended = () => stop();
    offHidden = env.onHidden(() => stop());
    timer = env.setInterval(() => {
      const t = env.now();
      const dt = Math.max(0, Math.min(0.25, t - last));
      last = t;
      try {
        analyser.getFloatTimeDomainData(buf);
        const reading = detector.push(analyseFrame(buf, c.sampleRate), dt);
        opts.onReading(reading);
      } catch {
        /* one bad frame never stops the card */
      }
    }, everyMs);
    listening = true;
    return 'granted';
  }

  return {
    request() {
      if (listening) return Promise.resolve('granted');
      if (pending) return pending;
      const myEpoch = epoch;
      const p = start(myEpoch).then((r) => {
        if (myEpoch === epoch) {
          result = r;
          pending = null;
        }
        return r;
      });
      pending = p;
      return p;
    },
    stop,
    get listening() {
      return listening;
    },
    get result() {
      return result;
    },
  };
}
