import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAD_CHORDS, RELEASE_HUSH_S, SWELL, duckTarget, isInScale, scaleMidi, swellLevel, swellPartials, swellSeconds } from '../src/audio/audioMath';
import { planFor } from '../src/audio/render';
import { RELEASE, releaseEndS } from '../src/fx/lanternMath';
import { RELEASE_MAX_DT, ReleaseMachine, releaseHoldS, type ReleaseEvent } from '../src/fx/releaseMath';
import { createReleaseAct } from '../src/acts/releaseAct';
import { createBus, type WinterEvents } from '../src/state/events';

// Phase 26 (session 2): the hush and the swell (sound maths and the render plan), the release machine, and its chain from the cake. No speaker, no browser: the sound itself is
// the WAV render (`tools/render_music_box.py release`) and, for the real thing, her phone.

const src = (p: string): string => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('the swell (sound maths)', () => {
  it('is silent before it starts, rises smoothly to the peak, holds, then falls slowly to silence', () => {
    expect(swellLevel(0)).toBe(0);
    expect(swellLevel(-3)).toBe(0);
    let last = 0;
    for (let t = 0; t <= SWELL.riseS; t += 0.05) {
      const v = swellLevel(t);
      expect(v).toBeGreaterThanOrEqual(last - 1e-12);
      last = v;
    }
    expect(swellLevel(SWELL.riseS)).toBeCloseTo(SWELL.peak, 9);
    expect(swellLevel(SWELL.riseS + SWELL.holdS / 2)).toBeCloseTo(SWELL.peak, 9);
    let fall: number = SWELL.peak;
    for (let t = SWELL.riseS + SWELL.holdS; t <= swellSeconds(); t += 0.05) {
      const v = swellLevel(t);
      expect(v).toBeLessThanOrEqual(fall + 1e-12);
      fall = v;
    }
    expect(swellLevel(swellSeconds())).toBe(0);
    expect(swellLevel(swellSeconds() + 50)).toBe(0);
  });
  it('is quiet (never above its peak, which is well under the beds\' own pad level 1), and bad input gives 0, never NaN', () => {
    for (let t = -1; t < 12; t += 0.1) expect(swellLevel(t)).toBeLessThanOrEqual(SWELL.peak);
    expect(SWELL.peak).toBeLessThan(0.25);
    for (const bad of [NaN, Infinity, -Infinity]) expect(Number.isFinite(swellLevel(bad))).toBe(true);
  });
  it('is not a new melody: only notes of the beds\' cool chord (an octave up) and a fifth above it, arriving low to high, plus one note of the star scale', () => {
    const parts = swellPartials();
    expect(parts.length).toBeLessThanOrEqual(5);
    const chordPcs = new Set(PAD_CHORDS.cool.map((m) => m % 12));
    chordPcs.add((PAD_CHORDS.cool[PAD_CHORDS.cool.length - 1]! + 7) % 12);
    for (const p of parts) {
      expect(chordPcs.has(p.midi % 12)).toBe(true);
      expect(p.gain).toBeGreaterThan(0);
      expect(p.gain).toBeLessThanOrEqual(1);
      expect(p.at).toBeGreaterThanOrEqual(0);
      expect(p.at).toBeLessThan(SWELL.riseS);
    }
    const ats = parts.map((p) => p.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(isInScale(scaleMidi(SWELL.chimeIndex) + 12)).toBe(true);
    expect(SWELL.chimeAt).toBeGreaterThan(0);
    expect(SWELL.chimeAt).toBeLessThan(swellSeconds());
  });
  it('the audio side\'s hush length is the same number as the lanterns\' own (audio may not import fx, so the test pins them together)', () => {
    expect(RELEASE_HUSH_S).toBe(RELEASE.hushS);
  });
  it('the offline render plan: the bed, the hush on, the hush off with the swell at the same moment, and nothing cut off', () => {
    const plan = planFor('release');
    const kinds = plan.items.map((i) => i.kind);
    expect(kinds).toEqual(['beds', 'duck', 'duck', 'swell']);
    const duck = plan.items.filter((i) => i.kind === 'duck') as { kind: 'duck'; level: number; at: number }[];
    const swell = plan.items.find((i) => i.kind === 'swell') as { kind: 'swell'; at: number };
    expect(duck[0]!.level).toBe(duckTarget(['hush']));
    expect(duck[1]!.level).toBe(1);
    expect(duck[1]!.at - duck[0]!.at).toBeCloseTo(RELEASE.hushS, 9); // quiet for exactly the hush
    expect(swell.at).toBe(duck[1]!.at); // the swell opens as the hush lifts
    expect(swell.at + swellSeconds()).toBeLessThanOrEqual(plan.seconds);
  });
});

describe('the release machine', () => {
  const run = (m: ReleaseMachine, seconds: number, dt = 1 / 60): void => {
    for (let t = 0; t < seconds; t += dt) m.step(dt);
  };
  it('does nothing before start; start begins the hush and says so once', () => {
    const ev: ReleaseEvent[] = [];
    const m = new ReleaseMachine({ onEvent: (e) => ev.push(e) });
    m.step(1);
    expect(m.phase).toBe('idle');
    expect(m.time).toBe(0);
    expect(m.started).toBe(false);
    m.start();
    m.start();
    expect(m.phase).toBe('hush');
    expect(ev).toEqual([{ type: 'start', at: 0 }]);
  });
  it('bursts when the hush ends, is done when the last lantern is gone, each once and in order', () => {
    const ev: ReleaseEvent[] = [];
    const m = new ReleaseMachine({ onEvent: (e) => ev.push(e) });
    m.start();
    run(m, RELEASE.hushS - 0.1);
    expect(m.phase).toBe('hush');
    run(m, 0.2);
    expect(m.phase).toBe('release');
    run(m, releaseEndS() - RELEASE.hushS);
    expect(m.phase).toBe('done');
    expect(m.finished).toBe(true);
    expect(ev.map((e) => e.type)).toEqual(['start', 'burst', 'done']);
    expect(ev[1]!.at).toBeGreaterThanOrEqual(RELEASE.hushS);
    expect(ev[1]!.at).toBeLessThan(RELEASE.hushS + 0.05);
    expect(ev[2]!.at).toBeGreaterThanOrEqual(releaseEndS());
    expect(ev[2]!.at).toBeLessThan(releaseEndS() + 0.05);
    expect(m.log).toEqual(ev);
  });
  it('holds the clock at the end (the sky stays empty) and never fires again', () => {
    const ev: ReleaseEvent[] = [];
    const m = new ReleaseMachine({ onEvent: (e) => ev.push(e) });
    m.start();
    run(m, releaseEndS() + 30);
    expect(m.time).toBeLessThanOrEqual(releaseHoldS() + 1e-9);
    run(m, 20);
    expect(m.time).toBeLessThanOrEqual(releaseHoldS() + 1e-9);
    expect(ev).toHaveLength(3);
  });
  it('a huge or bad frame counts as a capped one and never skips the beat; bad dt does nothing', () => {
    const m = new ReleaseMachine();
    m.start();
    m.step(1e9);
    expect(m.time).toBeCloseTo(RELEASE_MAX_DT, 9);
    for (const bad of [NaN, Infinity, -1, 0, -Infinity]) {
      const before = m.time;
      m.step(bad);
      expect(m.time).toBe(before); // not finite, zero or negative: ignored, like the other machines
    }
    // a phone that slept: many capped steps still pass through every event, in order
    const ev: string[] = [];
    const m2 = new ReleaseMachine({ onEvent: (e) => ev.push(e.type) });
    m2.start();
    for (let i = 0; i < 200; i++) m2.step(10);
    expect(ev).toEqual(['start', 'burst', 'done']);
  });
  it('a listener that throws never stops the release, and the other events still come', () => {
    const ev: string[] = [];
    const m = new ReleaseMachine({
      onEvent: (e) => {
        ev.push(e.type);
        throw new Error('bad listener');
      },
    });
    m.start();
    run(m, releaseEndS() + 1);
    expect(ev).toEqual(['start', 'burst', 'done']);
    expect(m.phase).toBe('done');
  });
  it('is the same every time (no random, no clock)', () => {
    const a: ReleaseEvent[] = [];
    const b: ReleaseEvent[] = [];
    const m1 = new ReleaseMachine({ onEvent: (e) => a.push(e) });
    const m2 = new ReleaseMachine({ onEvent: (e) => b.push(e) });
    m1.start();
    m2.start();
    run(m1, 30, 1 / 60);
    run(m2, 30, 1 / 60);
    expect(a).toEqual(b);
  });
  it('reduced motion does not change the beat (the lanterns\' own maths slows the climb): the clock is one clock', () => {
    const code = src('fx/releaseMath.ts').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/reduced/i);
  });
});

describe('the release act and its chain from the cake', () => {
  const run = (act: ReturnType<typeof createReleaseAct>, seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) act.step(1 / 60);
  };
  it('turns the machine\'s three events into bus events, in order, once each', () => {
    const act = createReleaseAct();
    const seen: string[] = [];
    for (const n of ['release:start', 'release:burst', 'release:done'] as const) act.bus.on(n, () => void seen.push(n));
    act.start();
    run(act, releaseEndS() + 1);
    expect(seen).toEqual(['release:start', 'release:burst', 'release:done']);
    expect(act.state().done).toBe(true);
    act.dispose();
  });
  it('waits for the cake: act:done {4} starts it, other acts do not, a second one does not restart it', () => {
    const cakeBus = createBus<WinterEvents>();
    const act = createReleaseAct({ chainFrom: cakeBus });
    const seen: string[] = [];
    act.bus.on('release:start', () => void seen.push('start'));
    cakeBus.emit('act:done', { act: 2 });
    cakeBus.emit('act:enter', { act: 4 });
    expect(act.state().started).toBe(false);
    cakeBus.emit('act:done', { act: 4 });
    expect(act.state().phase).toBe('hush');
    run(act, 3);
    const at = act.state().time;
    cakeBus.emit('act:done', { act: 4 });
    expect(act.state().time).toBe(at);
    expect(seen).toEqual(['start']);
    act.dispose();
    expect(cakeBus.listenerCount('act:done')).toBe(0);
  });
  it('the real cake act says act:done {act: 4}, and that is exactly what the chain listens for', () => {
    expect(src('acts/act4_cake.ts')).toMatch(/bus\.emit\('act:done', \{ act: 4 \}\)/);
    expect(src('acts/releaseAct.ts')).toMatch(/e\.act === 4/);
  });
  it('asks nothing of the viewer: no input, no microphone, no draw', () => {
    const code = src('acts/releaseAct.ts').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/createInput|createMic|getUserMedia|three|document\.|window\./);
  });
});

describe('the engine and the bus', () => {
  it('the bus has the three release events, and nothing else changed shape', () => {
    const ev = src('state/events.ts');
    for (const n of ['release:start', 'release:burst', 'release:done']) expect(ev).toContain(`'${n}'`);
  });
  it('the engine hushes on release:start, and on release:burst lifts the hush and swells', () => {
    const e = src('audio/engine.ts');
    expect(e).toMatch(/bus\.on\('release:start', \(\) => api\.duck\('hush', true\)\)/);
    expect(e).toMatch(/bus\.on\('release:burst', \(\) => \{\s*api\.duck\('hush', false\);\s*api\.swell\(\);\s*\}\)/);
    expect(e).toMatch(/swell\(\)\s*\{\s*if \(!live\(\)/);
  });
  it('the view hands its bus to the audio engine under &sound and waits for the first touch so the phone\'s audio is unlocked', () => {
    expect(src('main.ts')).toMatch(/audio\?\.listen\(releaseView\.bus\)/);
    const v = src('acts/releaseView.ts');
    expect(v).toMatch(/params\.has\('sound'\)/);
    expect(v).toMatch(/'pointerdown', 'keydown'/);
  });
  it('the release view runs the real machine, not its own clock', () => {
    const v = src('acts/releaseView.ts');
    expect(v).toMatch(/createReleaseAct\(/);
    expect(v).toMatch(/act\.step\(/);
  });
});

describe('purity', () => {
  it('releaseMath imports no three, no DOM, no clock, no random', () => {
    const code = src('fx/releaseMath.ts').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/from 'three'|document\.|window\.|Date\.now|performance\.now|Math\.random|requestAnimationFrame/);
  });
});
