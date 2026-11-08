import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CakeMachine, CAKE_TIMING, CANDLES, parseBlowScript, scriptedBlow, type CakeEvent } from '../src/acts/cakeMath';
import { CAKE_TEXT } from '../src/acts/cakeText';
import { buildCake, cakeCamera, cakeStats, CAKE_CANDLES, FLAME_ANCHORS, CAKE_TOP_Y } from '../src/world/cakeMath';
import { triCount, vertCount, type MeshData } from '../src/world/cabinMath';
import { createMic, MIC_CONSTRAINTS, type MicEnv } from '../src/audio/mic';
import { candlePuff, DUCK_LEVEL, duckTarget, makeRng } from '../src/audio/audioMath';

// Phase 25 (session 2): the candle machine, the cake's geometry, the microphone wrapper (with a FAKE getUserMedia) and the puff and hush. The real microphone is an owner-device gap.

const run = (m: CakeMachine, seconds: number, dt = 1 / 60): void => {
  for (let t = 0; t < seconds; t += dt) m.update(dt);
};
const toReady = (m: CakeMachine): void => {
  m.begin();
  run(m, CAKE_TIMING.appear + CAKE_TIMING.wish + 0.2);
};

describe('CakeMachine: the order of things', () => {
  it('starts hidden and does nothing until begin()', () => {
    const m = new CakeMachine();
    expect(m.phase).toBe('hidden');
    run(m, 5);
    expect(m.phase).toBe('hidden');
    expect(m.tap(0)).toBe(false);
  });
  it('goes appearing -> wish -> ready on its own times', () => {
    const m = new CakeMachine();
    m.begin();
    expect(m.phase).toBe('appearing');
    run(m, CAKE_TIMING.appear + 0.1);
    expect(m.phase).toBe('wish');
    run(m, CAKE_TIMING.wish + 0.1);
    expect(m.phase).toBe('ready');
  });
  it('the microphone is wanted only in `ready`', () => {
    const m = new CakeMachine();
    expect(m.micWanted).toBe(false);
    m.begin();
    expect(m.micWanted).toBe(false);
    run(m, CAKE_TIMING.appear + 1);
    expect(m.micWanted).toBe(false);
    run(m, CAKE_TIMING.wish);
    expect(m.micWanted).toBe(true);
    for (let i = 0; i < CANDLES; i++) m.tap(null);
    expect(m.micWanted).toBe(false);
  });
  it('a tap before the wish has run 1 s is ignored; after that it ends the beat and puts a flame out', () => {
    const m = new CakeMachine();
    m.begin();
    run(m, CAKE_TIMING.appear + 0.3);
    expect(m.tap(null)).toBe(false);
    expect(m.litCount).toBe(CANDLES);
    run(m, CAKE_TIMING.tapAfter);
    expect(m.tap(null)).toBe(true);
    expect(m.phase).toBe('ready');
    expect(m.litCount).toBe(CANDLES - 1);
  });
  it('taps put candles out one at a time, a tap on a named candle works, a tap on an out candle does not', () => {
    const m = new CakeMachine();
    toReady(m);
    expect(m.tap(3)).toBe(true);
    expect(m.tap(3)).toBe(false);
    expect(m.tap(null)).toBe(true); // the first still lit = 0
    expect(m.candleViews[0]!.state).not.toBe('lit');
    expect(m.candleViews[1]!.state).toBe('lit');
    expect(m.litCount).toBe(CANDLES - 2);
  });
  it('the last flame out ends in `out`, then `done` once after the hold', () => {
    const events: CakeEvent[] = [];
    const m = new CakeMachine({ onEvent: (e) => events.push(e) });
    toReady(m);
    for (let i = 0; i < CANDLES; i++) m.tap(null);
    expect(m.phase).toBe('out');
    run(m, CAKE_TIMING.holdAfter + 1);
    expect(m.phase).toBe('done');
    run(m, 20);
    expect(events.filter((e) => e.type === 'done').length).toBe(1);
    expect(events.filter((e) => e.type === 'out').length).toBe(1);
    expect(events.filter((e) => e.type === 'candle').length).toBe(CANDLES);
  });
  it('begin() twice does not restart it', () => {
    const m = new CakeMachine();
    m.begin();
    run(m, 1);
    m.begin();
    expect(m.log.filter((e) => e.type === 'begin').length).toBe(1);
  });
});

describe('CakeMachine: the breath', () => {
  it('a steady breath puts the candles out ONE BY ONE, in order, never all at once', () => {
    const m = new CakeMachine();
    toReady(m);
    m.setBlow(true, 0.8);
    const outAt: number[] = [];
    let last = m.outCount;
    for (let t = 0; t < 12 && m.litCount > 0; t += 1 / 60) {
      m.update(1 / 60);
      if (m.outCount !== last) {
        // never two in one frame
        expect(m.outCount - last).toBe(1);
        last = m.outCount;
        outAt.push(m.time);
      }
    }
    expect(outAt.length).toBe(CANDLES);
    for (let i = 1; i < outAt.length; i++) expect(outAt[i]! - outAt[i - 1]!).toBeGreaterThan(0.15);
    const order = m.log.filter((e) => e.type === 'candle').map((e) => e.candle);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(m.log.filter((e) => e.type === 'candle').every((e) => e.by === 'blow')).toBe(true);
  });
  it('a breath that is too short puts nothing out, and the effort drains', () => {
    const m = new CakeMachine();
    toReady(m);
    m.setBlow(true, 0.8);
    run(m, 0.2);
    m.setBlow(false, 0);
    run(m, 3);
    expect(m.outCount).toBe(0);
    m.setBlow(true, 0.8);
    run(m, 0.2);
    expect(m.outCount).toBe(0); // the first 0.2 s is gone: it does not add up to 0.35
  });
  it('a breath during the wish beat does nothing', () => {
    const m = new CakeMachine();
    m.begin();
    run(m, CAKE_TIMING.appear + 0.5);
    m.setBlow(true, 1);
    run(m, 1.5);
    expect(m.phase).toBe('wish');
    expect(m.outCount).toBe(0);
  });
  it('breath and taps mix', () => {
    const m = new CakeMachine();
    toReady(m);
    m.tap(null);
    m.setBlow(true, 0.7);
    run(m, 10);
    m.setBlow(false, 0);
    expect(m.litCount).toBe(0);
    const by = new Set(m.log.filter((e) => e.type === 'candle').map((e) => e.by));
    expect(by.has('tap')).toBe(true);
    expect(by.has('blow')).toBe(true);
  });
  it('a harder breath is quicker than a soft one', () => {
    const time = (s: number): number => {
      const m = new CakeMachine();
      toReady(m);
      const t0 = m.time;
      m.setBlow(true, s);
      while (m.litCount > 0 && m.time - t0 < 30) m.update(1 / 60);
      return m.time - t0;
    };
    expect(time(1)).toBeLessThan(time(0.1));
  });
});

describe('CakeMachine: hint, line, views, reduced motion, bad input', () => {
  it('the hint shows after the beat if nothing was done, and is 0 after the first candle', () => {
    const m = new CakeMachine();
    toReady(m);
    expect(m.hint).toBe(0);
    run(m, CAKE_TIMING.hintAfter + 1.5);
    expect(m.hint).toBeGreaterThan(0.9);
    m.tap(null);
    expect(m.hint).toBe(0);
  });
  it('every view is finite and in range through a whole run', () => {
    const m = new CakeMachine();
    m.begin();
    for (let t = 0; t < 30; t += 1 / 60) {
      if (t > 8) m.setBlow(true, 0.6);
      m.update(1 / 60);
      for (const v of m.candleViews) {
        expect(Number.isFinite(v.flame)).toBe(true);
        expect(Number.isFinite(v.bend)).toBe(true);
        expect(v.flame).toBeGreaterThanOrEqual(0);
        expect(v.flame).toBeLessThanOrEqual(1);
      }
      for (const x of [m.appear, m.light, m.line, m.hint]) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });
  it('reduced motion: a candle takes longer to die and the flames bend less', () => {
    const dying = (reduced: boolean): number => {
      const m = new CakeMachine({ reducedMotion: reduced });
      toReady(m);
      m.tap(0);
      let t = 0;
      while (m.candleViews[0]!.state === 'dying' && t < 5) {
        m.update(1 / 60);
        t += 1 / 60;
      }
      return t;
    };
    expect(dying(true)).toBeGreaterThan(dying(false) * 1.5);
    const bend = (reduced: boolean): number => {
      const m = new CakeMachine({ reducedMotion: reduced });
      toReady(m);
      m.setBlow(true, 0.15);
      run(m, 0.3);
      return Math.abs(m.candleViews[4]!.bend);
    };
    expect(bend(true)).toBeLessThanOrEqual(bend(false));
  });
  it('a storm of bad frame times and wild input never breaks it', () => {
    const m = new CakeMachine();
    m.begin();
    const rng = makeRng(77);
    const odd = [NaN, -1, 0, Infinity, 1e9, 0.0001, 0.3, 5];
    for (let i = 0; i < 4000; i++) {
      m.update(odd[Math.floor(rng() * odd.length)]!);
      m.setBlow(rng() > 0.5, rng() * 3 - 1);
      if (rng() > 0.95) m.tap(rng() > 0.5 ? Math.floor(rng() * 9) - 2 : null);
    }
    expect(Number.isFinite(m.time)).toBe(true);
    expect(m.log.length).toBeLessThanOrEqual(400);
    expect(m.litCount + m.outCount).toBe(CANDLES);
  });
  it('a listener that throws does not stop the act', () => {
    const m = new CakeMachine({
      onEvent: () => {
        throw new Error('listener');
      },
    });
    expect(() => {
      toReady(m);
      m.tap(null);
    }).not.toThrow();
  });
  it('the scripted breath for the test view', () => {
    expect(parseBlowScript('2-3.5,6-7')).toEqual([[2, 3.5], [6, 7]]);
    expect(parseBlowScript('x,5-1,')).toEqual([]);
    expect(parseBlowScript(null)).toEqual([]);
    const s = parseBlowScript('2-3');
    expect(scriptedBlow(s, 1.9)).toBe(false);
    expect(scriptedBlow(s, 2.5)).toBe(true);
    expect(scriptedBlow(s, 3)).toBe(false);
  });
});

// ---- geometry ------------------------------------------------------------------------------------------------------------------------------
function wrongWay(m: MeshData): number {
  let bad = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.idx[t]!, m.idx[t + 1]!, m.idx[t + 2]!];
    const P = (i: number): number[] => [m.pos[i * 3]!, m.pos[i * 3 + 1]!, m.pos[i * 3 + 2]!];
    const [pa, pb, pc] = [P(a), P(b), P(c)] as [number[], number[], number[]];
    const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
    const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
    const g = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const len = Math.hypot(g[0]!, g[1]!, g[2]!);
    if (len < 1e-12) continue;
    const n = [0, 1, 2].map((k) => (m.nrm[a * 3 + k]! + m.nrm[b * 3 + k]! + m.nrm[c * 3 + k]!) / 3);
    if ((g[0]! * n[0]! + g[1]! * n[1]! + g[2]! * n[2]!) / len < 0) bad++;
  }
  return bad;
}

describe('the cake mesh', () => {
  const cake = buildCake();
  it('arrays line up, indices in range, everything finite, normals unit, colours 0..1', () => {
    expect(cake.nrm.length).toBe(cake.pos.length);
    expect(cake.idx.length % 3).toBe(0);
    const nv = vertCount(cake);
    expect(cake.col.length === nv * 3 || cake.col.length === nv * 4).toBe(true);
    for (const i of cake.idx) {
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(nv);
    }
    for (const arr of [cake.pos, cake.nrm, cake.col]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
    for (let i = 0; i < cake.nrm.length; i += 3) expect(Math.abs(Math.hypot(cake.nrm[i]!, cake.nrm[i + 1]!, cake.nrm[i + 2]!) - 1)).toBeLessThan(1e-3);
    for (const v of cake.col) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('0 wrong-way triangles (the lit, inked body)', () => {
    expect(wrongWay(cake)).toBe(0);
  });
  it('there are five candles and five flame anchors, each above its candle and on the cake', () => {
    expect(CAKE_CANDLES.length).toBe(5);
    expect(FLAME_ANCHORS.length).toBe(5);
    FLAME_ANCHORS.forEach((a, i) => {
      expect(a[0]).toBeCloseTo(CAKE_CANDLES[i]!.x, 9);
      expect(a[1]).toBeGreaterThan(CAKE_TOP_Y);
      expect(Math.hypot(a[0], a[2])).toBeLessThan(0.11); // inside the top layer's radius
    });
    const xs = CAKE_CANDLES.map((c) => c.x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs); // left to right, so "one by one" reads as a sweep
  });
  it('claims 3 draw calls (body + ink hull, flames and wisps) and a small triangle count', () => {
    const s = cakeStats(cake);
    expect(s.drawCalls).toBe(3);
    expect(s.triangles).toBe(triCount(cake) * 2);
    expect(s.triangles).toBeLessThan(6000);
  });
});

describe('cakeCamera frames the cake on every screen', () => {
  for (const aspect of [0.46, 0.56, 0.75, 1.0, 1.78]) {
    it(`aspect ${aspect}: the cake (0.6 m wide, table 0.6 m) is inside the view and the eye is not too close`, () => {
      const c = cakeCamera(aspect);
      const dist = Math.hypot(c.eye[0] - c.look[0], c.eye[1] - c.look[1], c.eye[2] - c.look[2]);
      const halfV = Math.tan((c.fovDeg * Math.PI) / 360);
      const halfH = halfV * Math.min(aspect, 4);
      expect(dist * halfH).toBeGreaterThan(0.3); // the table's half width fits across
      expect(dist * halfV).toBeGreaterThan(0.25);
      expect(dist).toBeGreaterThan(1.2);
      for (const v of [...c.eye, ...c.look, c.fovDeg]) expect(Number.isFinite(v)).toBe(true);
    });
  }
  it('bad aspect falls back, never NaN', () => {
    for (const a of [NaN, 0, -2, Infinity]) {
      const c = cakeCamera(a);
      for (const v of [...c.eye, ...c.look]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---- the words and purity --------------------------------------------------------------------------------------------------------------------
describe('words and purity', () => {
  const read = (p: string): string => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  it('the two plain sentences are exactly the ones flagged for the owner, and nothing else is said', () => {
    expect(Object.keys(CAKE_TEXT).sort()).toEqual(['hint', 'line']);
    expect(CAKE_TEXT.line).toBe('Make a wish.');
    expect(CAKE_TEXT.hint).toBe('Blow on your phone, or tap the candles.');
    expect(JSON.stringify(CAKE_TEXT)).not.toMatch(/birthday|happy|love|heart|dhana|kiwii/i);
  });
  it('no romance or flower words anywhere in the cake sources', () => {
    for (const f of ['world/cakeMath.ts', 'world/cake.ts', 'world/cakeShaders.ts', 'acts/cakeMath.ts', 'acts/cakeText.ts']) {
      const code = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/heart|rose|bouquet|candlelit|couple/i);
    }
  });
  it('the pure files import no three, no DOM, no clock, no random', () => {
    for (const f of ['world/cakeMath.ts', 'acts/cakeMath.ts', 'audio/blow.ts']) {
      const code = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/from 'three'|document\.|window\.|Date\.now|performance\.now|Math\.random|requestAnimationFrame/);
    }
  });
  it('mic.ts imports only blow.ts, and keeps no recording', () => {
    const code = read('audio/mic.ts').replace(/\/\/.*$/gm, '');
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['./blow']);
    expect(code).not.toMatch(/MediaRecorder|createMediaStreamDestination|fetch\(|sendBeacon|localStorage/);
    expect(code).not.toMatch(/connect\(\s*c(tx)?\.destination/); // never played back through the speakers
  });
});

// ---- the microphone, with a fake browser -----------------------------------------------------------------------------------------------------
interface FakeTrack { stopped: boolean; onended: (() => void) | null; stop(): void }
function fakeBrowser(opts: { gum?: 'ok' | 'deny' | 'throw-sync' | 'none'; ctxFails?: boolean; frame?: (i: number) => Float32Array } = {}) {
  const tracks: FakeTrack[] = [];
  const state = { closed: 0, gumCalls: 0, lastConstraints: undefined as MediaStreamConstraints | undefined, intervals: new Map<number, () => void>(), nextId: 1, hidden: [] as (() => void)[], t: 0, connectedToDestination: false };
  const env: Partial<MicEnv> = {
    createContext: () => {
      if (opts.ctxFails) throw new Error('no audio');
      const analyser = {
        fftSize: 0,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(b: Float32Array) {
          const f = opts.frame ? opts.frame(Math.round(state.t * 20)) : new Float32Array(b.length);
          b.set(f.subarray(0, b.length));
        },
        connect() {
          state.connectedToDestination = true;
        },
      };
      return {
        sampleRate: 16000,
        destination: {},
        createMediaStreamSource: () => ({ connect: () => {} }),
        createAnalyser: () => analyser,
        resume: () => Promise.resolve(),
        close: () => {
          state.closed++;
          return Promise.resolve();
        },
      } as unknown as AudioContext;
    },
    setInterval: (fn) => {
      const id = state.nextId++;
      state.intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => void state.intervals.delete(id),
    now: () => state.t,
    onHidden: (fn) => {
      state.hidden.push(fn);
      return () => void state.hidden.splice(state.hidden.indexOf(fn), 1);
    },
  };
  if (opts.gum !== 'none') {
    env.getUserMedia = (c) => {
      state.gumCalls++;
      state.lastConstraints = c;
      if (opts.gum === 'throw-sync') throw new Error('sync boom');
      if (opts.gum === 'deny') return Promise.reject(new DOMException('no', 'NotAllowedError'));
      const track: FakeTrack = { stopped: false, onended: null, stop() { this.stopped = true; } };
      tracks.push(track);
      return Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream);
    };
  } else {
    env.getUserMedia = undefined;
  }
  const tick = (n: number, dt = 0.05): void => {
    for (let i = 0; i < n; i++) {
      state.t += dt;
      for (const fn of [...state.intervals.values()]) fn();
    }
  };
  return { env, tracks, state, tick };
}

/** noise squeezed low (three one-pole passes at about 450 Hz) with a little hiss: what a breath looks like to the detector (same recipe as tests/blow.test.ts) */
function breathFrame(seed: number): Float32Array {
  const rng = makeRng(seed);
  const f = new Float32Array(2048);
  const a = 1 - Math.exp((-2 * Math.PI * 450) / 16000);
  let p1 = 0, p2 = 0, p3 = 0;
  for (let i = 0; i < f.length; i++) {
    p1 += a * ((rng() * 2 - 1) - p1);
    p2 += a * (p1 - p2);
    p3 += a * (p2 - p3);
    f[i] = p3 * 3.2 + (rng() * 2 - 1) * 0.02;
  }
  return f;
}

describe('createMic with a fake browser', () => {
  it('asks with no processing, resolves granted, listens, and never plays the microphone back', async () => {
    const fb = fakeBrowser();
    const mic = createMic({ onReading: () => {}, env: fb.env });
    expect(mic.result).toBe(null);
    expect(await mic.request()).toBe('granted');
    expect(mic.listening).toBe(true);
    expect(mic.result).toBe('granted');
    expect(fb.state.lastConstraints).toEqual(MIC_CONSTRAINTS);
    expect(JSON.stringify(fb.state.lastConstraints)).toContain('"echoCancellation":false');
    expect(fb.state.connectedToDestination).toBe(false);
  });
  it('asking twice asks the browser once', async () => {
    const fb = fakeBrowser();
    const mic = createMic({ onReading: () => {}, env: fb.env });
    const [a, b] = await Promise.all([mic.request(), mic.request()]);
    expect([a, b]).toEqual(['granted', 'granted']);
    expect(await mic.request()).toBe('granted');
    expect(fb.state.gumCalls).toBe(1);
  });
  it('denied resolves quietly and nothing listens', async () => {
    const fb = fakeBrowser({ gum: 'deny' });
    const mic = createMic({ onReading: () => {}, env: fb.env });
    expect(await mic.request()).toBe('denied');
    expect(mic.listening).toBe(false);
    expect(fb.state.intervals.size).toBe(0);
  });
  it('getUserMedia that throws at once resolves quietly too', async () => {
    const fb = fakeBrowser({ gum: 'throw-sync' });
    const mic = createMic({ onReading: () => {}, env: fb.env });
    expect(await mic.request()).toBe('denied');
  });
  it('no getUserMedia at all is "unsupported", and no AudioContext is "unsupported" with the stream let go', async () => {
    const none = fakeBrowser({ gum: 'none' });
    expect(await createMic({ onReading: () => {}, env: none.env }).request()).toBe('unsupported');
    const bad = fakeBrowser({ ctxFails: true });
    expect(await createMic({ onReading: () => {}, env: bad.env }).request()).toBe('unsupported');
    expect(bad.tracks.every((t) => t.stopped)).toBe(true);
  });
  it('stop() stops every track, clears the timer, closes the context, and is safe to repeat', async () => {
    const fb = fakeBrowser();
    const mic = createMic({ onReading: () => {}, env: fb.env });
    await mic.request();
    mic.stop();
    mic.stop();
    expect(fb.tracks.every((t) => t.stopped)).toBe(true);
    expect(fb.state.intervals.size).toBe(0);
    expect(fb.state.closed).toBe(1);
    expect(fb.state.hidden.length).toBe(0);
    expect(mic.listening).toBe(false);
  });
  it('a stop() while the permission prompt is open lets the stream go the moment it arrives', async () => {
    const fb = fakeBrowser();
    const mic = createMic({ onReading: () => {}, env: fb.env });
    const p = mic.request();
    mic.stop();
    await p;
    expect(mic.listening).toBe(false);
    expect(fb.tracks.every((t) => t.stopped)).toBe(true);
    expect(fb.state.intervals.size).toBe(0);
  });
  it('the page going hidden, or the stream ending by itself, stops it', async () => {
    const a = fakeBrowser();
    const m1 = createMic({ onReading: () => {}, env: a.env });
    await m1.request();
    a.state.hidden[0]!();
    expect(m1.listening).toBe(false);
    expect(a.tracks[0]!.stopped).toBe(true);
    const b = fakeBrowser();
    const m2 = createMic({ onReading: () => {}, env: b.env });
    await m2.request();
    b.tracks[0]!.onended?.();
    expect(m2.listening).toBe(false);
  });
  it('can be asked again after a stop', async () => {
    const fb = fakeBrowser();
    const mic = createMic({ onReading: () => {}, env: fb.env });
    await mic.request();
    mic.stop();
    expect(await mic.request()).toBe('granted');
    expect(fb.state.gumCalls).toBe(2);
  });
  it('silence reads as not blowing; a steady breath reads as blowing after calibration; a throwing listener does not stop the reading', async () => {
    const silent = fakeBrowser();
    const seenS: boolean[] = [];
    const m1 = createMic({ onReading: (r) => seenS.push(r.blowing), env: silent.env });
    await m1.request();
    silent.tick(60);
    expect(seenS.length).toBe(60);
    expect(seenS.some(Boolean)).toBe(false);

    const breath = fakeBrowser({ frame: (i) => (i < 12 ? new Float32Array(2048) : breathFrame(i)) }); // 0.6 s of quiet room, then a breath
    const seenB: boolean[] = [];
    let thrown = 0;
    const m2 = createMic({
      onReading: (r) => {
        seenB.push(r.blowing);
        thrown++;
        if (thrown === 3) throw new Error('listener');
      },
      env: breath.env,
    });
    await m2.request();
    breath.tick(60);
    expect(seenB.length).toBe(60);
    expect(seenB.slice(0, 8).some(Boolean)).toBe(false);
    expect(seenB.slice(30).some(Boolean)).toBe(true);
  });
});

// ---- the puff and the hush -------------------------------------------------------------------------------------------------------------------
describe('the candle puff and the hush', () => {
  it('a puff is soft, short, deterministic, and never two the same', () => {
    const a = candlePuff(makeRng(3));
    expect(candlePuff(makeRng(3))).toEqual(a);
    const seen = new Set<number>();
    const rng = makeRng(9);
    for (let i = 0; i < 40; i++) {
      const p = candlePuff(rng);
      seen.add(p.freq);
      expect(p.dur).toBeGreaterThan(0.15);
      expect(p.dur).toBeLessThan(0.4);
      expect(p.gain).toBeGreaterThan(0);
      expect(p.gain).toBeLessThan(0.2);
      expect(Math.abs(p.pan)).toBeLessThanOrEqual(0.3);
    }
    expect(seen.size).toBeGreaterThan(30);
  });
  it('hush ducks the beds a little, less than a letter, and is part of duckTarget', () => {
    expect(DUCK_LEVEL.hush).toBeGreaterThan(DUCK_LEVEL.letter);
    expect(DUCK_LEVEL.hush).toBeLessThan(1);
    expect(duckTarget(['hush'])).toBe(DUCK_LEVEL.hush);
    expect(duckTarget(['hush', 'letter'])).toBe(DUCK_LEVEL.letter);
  });
  it('the engine listens to candle:out and cake:wish, and the bus has both events', () => {
    const src = readFileSync(new URL('../src/audio/engine.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/bus\.on\('candle:out'/);
    expect(src).toMatch(/bus\.on\('cake:wish'/);
    const ev = readFileSync(new URL('../src/state/events.ts', import.meta.url), 'utf8');
    expect(ev).toMatch(/'candle:out'/);
    expect(ev).toMatch(/'cake:wish'/);
  });
});

// ---- Phase 25, session 5: the draw calls from the REAL scene graph, the microphone's one door, and the puff in the offline render --------------

describe('the real cake scene graph (three, no GPU)', () => {
  it('draws with 3 calls: the visible meshes and points of the root, picker stand-ins not counted', async () => {
    const { createCake } = await import('../src/world/cake');
    const cake = createCake({ reducedMotion: false, pixelRatio: 1 });
    let drawn = 0;
    let proxies = 0;
    cake.root.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; isPoints?: boolean; visible: boolean; material?: { visible?: boolean } | { visible?: boolean }[] };
      if (!(m.isMesh || m.isPoints) || !m.visible) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((x) => x && x.visible === false)) proxies++;
      else drawn += mats.length > 1 ? mats.length : 1;
    });
    expect(drawn).toBe(cake.stats().drawCalls);
    expect(drawn).toBe(3);
    expect(proxies).toBe(CAKE_CANDLES.length + 1); // five candles and the cake body
    expect(cake.proxies.candles).toHaveLength(5);
    cake.dispose();
  });
});

describe('act4_cake.ts and the microphone', () => {
  const src = readFileSync(new URL('../src/acts/act4_cake.ts', import.meta.url), 'utf8');
  it('only asks for the microphone behind machine.micWanted, once, and never in start()', () => {
    const asks = src.match(/\.request\(\)/g) ?? [];
    expect(asks).toHaveLength(1);
    const at = src.indexOf('.request()');
    const before = src.slice(Math.max(0, at - 400), at);
    expect(before).toMatch(/machine\.micWanted && !asked/);
    const start = src.slice(src.indexOf('start() {'), src.indexOf('step(dt, scripted)'));
    expect(start).not.toMatch(/request|mic/);
  });
  it('stops the microphone when the moment ends and on dispose, and records and sends nothing', () => {
    expect(src).toMatch(/!machine\.micWanted && mic\.listening/);
    expect(src).toMatch(/mic\?\.stop\(\)/);
    expect(src).not.toMatch(/MediaRecorder|fetch\(|sendBeacon|XMLHttpRequest|localStorage|sessionStorage/);
  });
  it('a stale reading is not a breath (the tab slept, the microphone stalled)', () => {
    expect(src).toMatch(/READING_FRESH_S = 0\.4/);
    expect(src).toMatch(/clock - lastReading\.at <= READING_FRESH_S/);
  });
});

describe('the puff in the offline render', () => {
  it('five puffs, in order, each with its own seed, the hush on before the first and lifted after the last', async () => {
    const { planFor } = await import('../src/audio/render');
    const plan = planFor('puff');
    const p = plan.items.filter((i) => i.kind === 'puff') as { kind: 'puff'; at: number; seed: number }[];
    expect(p).toHaveLength(5);
    for (let i = 1; i < p.length; i++) expect(p[i]!.at).toBeGreaterThan(p[i - 1]!.at);
    expect(new Set(p.map((x) => x.seed)).size).toBe(5);
    const ducks = plan.items.filter((i) => i.kind === 'duck') as { kind: 'duck'; level: number; at: number }[];
    expect(ducks).toHaveLength(2);
    expect(ducks[0]!.level).toBe(DUCK_LEVEL.hush);
    expect(ducks[0]!.at).toBeLessThan(p[0]!.at);
    expect(ducks[1]!.level).toBe(1);
    expect(ducks[1]!.at).toBeGreaterThan(p[4]!.at);
    expect(plan.seconds).toBeGreaterThan(p[4]!.at + 0.4);
  });
});
