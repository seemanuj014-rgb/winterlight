import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FinaleMachine, FINALE, finaleMessageFor, type FinaleEvent } from '../src/acts/finaleMath';
import { StayAwhileMachine, STAY_EXITS, STAY_ACTIVITIES, type StayActivity } from '../src/acts/stayAwhileMath';
import { createFinaleAct } from '../src/acts/act6_finale';
import { createStayAwhileAct } from '../src/acts/stayAwhile';
import { createBus, type WinterEvents } from '../src/state/events';

// Phase 28 (first quarter): the finale's rules, stay a while's "never trapped" rule, and the bus chain. No word of the owner's is used or invented here.

const run = (m: { step(dt: number): void }, seconds: number, dt = 1 / 60): void => {
  for (let t = 0; t < seconds; t += dt) m.step(dt);
};
const types = (log: readonly FinaleEvent[]): string[] => log.map((e) => e.type);
const ORDER = ['start', 'join', 'swell', 'pullback', 'done'];

describe('the finale machine', () => {
  it('does nothing until start()', () => {
    const m = new FinaleMachine();
    run(m, 60);
    expect(m.phase).toBe('idle');
    expect(m.log).toEqual([]);
    expect(m.progress).toBe(0);
    expect(m.replay()).toBe(false);
  });
  it('plays its five events once each and in order, then holds at done', () => {
    const m = new FinaleMachine();
    m.start();
    run(m, m.totalSeconds + 5);
    expect(types(m.log)).toEqual(ORDER);
    expect(m.phase).toBe('done');
    const t = m.time;
    run(m, 600);
    expect(types(m.log)).toEqual(ORDER);
    expect(m.progress).toBe(1);
    expect(m.time).toBeGreaterThan(t);
  });
  it('start() twice does nothing; replay() only works once it is done and never cuts a beat', () => {
    const m = new FinaleMachine();
    m.start();
    m.start();
    expect(m.timesStarted).toBe(1);
    run(m, 3);
    expect(m.replay()).toBe(false);
    run(m, m.totalSeconds);
    expect(m.replay()).toBe(true);
    expect(m.phase).toBe('lifting');
    expect(m.timesStarted).toBe(2);
    expect(m.progress).toBe(0);
    run(m, m.totalSeconds + 1);
    expect(types(m.log)).toEqual([...ORDER, ...ORDER]);
  });
  it('progress numbers rise in order and never go backwards or out of 0..1', () => {
    const m = new FinaleMachine();
    m.start();
    let last = [0, 0, 0, 0, 0];
    for (let t = 0; t < m.totalSeconds + 2; t += 1 / 30) {
      m.step(1 / 30);
      const now = [m.liftProgress, m.joinProgress, m.auroraSwell, m.pullProgress, m.progress];
      now.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(last[i]!);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      });
      // a later beat never starts before the earlier one is whole
      if (m.joinProgress > 0) expect(m.liftProgress).toBe(1);
      if (m.auroraSwell > 0) expect(m.joinProgress).toBe(1);
      if (m.pullProgress > 0) expect(m.auroraSwell).toBe(1);
      last = now;
    }
    expect([m.liftProgress, m.joinProgress, m.auroraSwell, m.pullProgress]).toEqual([1, 1, 1, 1]);
  });
  it('the aurora holds at full through the pull-back', () => {
    const m = new FinaleMachine();
    m.start();
    run(m, FINALE.liftS + FINALE.joinS + FINALE.swellS + 1);
    expect(m.phase).toBe('pulling');
    expect(m.auroraSwell).toBe(1);
  });
  it('a long frame is capped: a stalled tab does not skip the beat', () => {
    const m = new FinaleMachine();
    m.start();
    m.step(500);
    expect(m.time).toBeCloseTo(FINALE.maxDt, 5);
    expect(m.phase).toBe('lifting');
    // even many huge steps cross one beat at a time and see every event
    for (let i = 0; i < 400; i++) m.step(1000);
    expect(types(m.log)).toEqual(ORDER);
  });
  it('bad numbers are ignored', () => {
    const m = new FinaleMachine();
    m.start();
    for (const v of [NaN, -1, 0, Infinity, '1' as unknown as number]) m.step(v);
    expect(m.time).toBe(0);
  });
  it('reduced motion keeps the same beats in the same order, shorter', () => {
    const n = new FinaleMachine();
    const r = new FinaleMachine({ reducedMotion: true });
    r.start();
    run(r, r.totalSeconds + 1);
    expect(types(r.log)).toEqual(ORDER);
    expect(r.totalSeconds).toBeLessThan(n.totalSeconds / 2);
  });
  it('a throwing listener never stops the beat', () => {
    const m = new FinaleMachine({ onEvent: () => { throw new Error('boom'); } });
    m.start();
    run(m, m.totalSeconds + 1);
    expect(m.phase).toBe('done');
  });
  it('fuzz: 200 random runs always give the five events in order, each play', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < 200; k++) {
      const m = new FinaleMachine({ reducedMotion: rnd() < 0.5 });
      m.start();
      const plays = 1 + Math.floor(rnd() * 3);
      for (let p = 0; p < plays; p++) {
        for (let i = 0; i < 4000 && !m.finished; i++) m.step(rnd() * 0.4);
        expect(m.finished).toBe(true);
        if (p < plays - 1) expect(m.replay()).toBe(true);
      }
      expect(types(m.log)).toEqual(Array.from({ length: plays }, () => ORDER).flat());
    }
  });
});

describe('the message', () => {
  it('is the owner\'s string as it is, even awkward text, and placeholders show as placeholders', () => {
    for (const s of ['TODO_OWNER', '  two  spaces\tand a tab ', 'नमस्ते 🌙\r\n<b>x</b> & y', '']) expect(finaleMessageFor({ finale_sky_message: s })).toBe(s);
  });
  it('no sentence lives in the finale or stay-a-while files', () => {
    for (const f of ['finaleMath', 'stayAwhileMath', 'act6_finale', 'stayAwhile']) {
      const src = readFileSync(`src/acts/${f}.ts`, 'utf8').replace(/\/\/.*$/gm, '');
      const quoted = [...src.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]!).filter((s) => s.length >= 12 && /\s/.test(s) && !/^[a-z:_-]+$/.test(s));
      expect(quoted, f).toEqual([]);
    }
  });
  it('the finale and stay a while draw nothing: no three, no DOM, no audio', () => {
    for (const f of ['finaleMath', 'stayAwhileMath', 'act6_finale', 'stayAwhile']) {
      const src = readFileSync(`src/acts/${f}.ts`, 'utf8');
      expect(src, f).not.toMatch(/from 'three|document\.|window\.|from '\.\.\/audio/);
    }
  });
});

describe('stay a while never traps her', () => {
  it('does nothing until she enters; no exit is offered before that', () => {
    const m = new StayAwhileMachine();
    expect(m.exits).toEqual([]);
    expect(m.exit('letter')).toBe(false);
    expect(m.setActivity('pet')).toBe(false);
  });
  it('both exits are on offer in every activity, and exit() always works while she is staying', () => {
    for (const a of STAY_ACTIVITIES) {
      for (const to of STAY_EXITS) {
        const m = new StayAwhileMachine();
        m.enter();
        m.setActivity(a);
        expect(m.exits).toEqual(['letter', 'replay']);
        expect(m.exit(to)).toBe(true);
        expect(m.phase).toBe('left');
      }
    }
  });
  it('has no timer: nothing happens by itself however long she stays (it has no step at all)', () => {
    const m = new StayAwhileMachine();
    m.enter();
    expect('step' in m).toBe(false);
    expect(m.staying).toBe(true);
    expect(m.log).toHaveLength(1);
  });
  it('she can come back after either exit, any number of times, and the exits are there again', () => {
    const m = new StayAwhileMachine();
    for (let i = 0; i < 10; i++) {
      expect(m.enter()).toBe(true);
      expect(m.exits).toEqual(['letter', 'replay']);
      expect(m.exit(i % 2 ? 'letter' : 'replay')).toBe(true);
      expect(m.exits).toEqual([]);
    }
    expect(m.timesEntered).toBe(10);
  });
  it('a second enter() while staying does nothing; an unknown exit or activity is refused and changes nothing', () => {
    const m = new StayAwhileMachine();
    m.enter();
    expect(m.enter()).toBe(false);
    expect(m.exit('nowhere' as never)).toBe(false);
    expect(m.setActivity('fly' as never)).toBe(false);
    expect(m.exits).toEqual(['letter', 'replay']);
    expect(m.staying).toBe(true);
  });
  it('fuzz: 300 random sessions, whatever she does, the exits are always both there while staying', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < 300; k++) {
      const m = new StayAwhileMachine();
      m.enter();
      for (let i = 0; i < 60; i++) {
        const r = rnd();
        if (r < 0.6) m.setActivity(STAY_ACTIVITIES[Math.floor(rnd() * STAY_ACTIVITIES.length)] as StayActivity);
        else if (r < 0.7) m.exit(STAY_EXITS[Math.floor(rnd() * 2)]!);
        else if (r < 0.9) m.enter();
        if (m.staying) expect(m.exits).toEqual(['letter', 'replay']);
        else expect(m.exits).toEqual([]);
      }
      m.enter();
      expect(m.exit('letter')).toBe(true);
    }
  });
  it('a throwing listener never traps her', () => {
    const m = new StayAwhileMachine({ onEvent: () => { throw new Error('boom'); } });
    m.enter();
    expect(m.exit('replay')).toBe(true);
  });
});

describe('the bus chain: letter put away -> finale -> stay a while -> exits', () => {
  const setup = () => {
    const bus = createBus<WinterEvents>();
    const seen: string[] = [];
    for (const k of ['act:enter', 'act:done', 'finale:start', 'finale:join', 'finale:swell', 'finale:pullback', 'finale:done', 'stay:enter', 'stay:exit', 'stay:activity'] as const) {
      bus.on(k, ((p?: unknown) => seen.push(p === undefined ? k : `${k} ${JSON.stringify(p)}`)) as never);
    }
    const finale = createFinaleAct({ bus, chainFrom: bus });
    const stay = createStayAwhileAct({ bus, chainFrom: bus });
    return { bus, seen, finale, stay };
  };
  it('nothing starts until the letter says act:done 5; then the finale plays and stay a while begins', () => {
    const { bus, seen, finale, stay } = setup();
    run(finale, 60);
    expect(finale.state().started).toBe(false);
    bus.emit('act:done', { act: 4 });
    expect(finale.state().started).toBe(false);
    bus.emit('act:done', { act: 5 });
    expect(finale.state().phase).toBe('lifting');
    run(finale, finale.machine.totalSeconds + 1);
    expect(seen.filter((s) => s !== 'act:done {"act":4}' && s !== 'act:done {"act":5}')).toEqual([
      'act:enter {"act":6}', 'finale:start', 'finale:join', 'finale:swell', 'finale:pullback', 'finale:done', 'stay:enter', 'act:done {"act":6}',
    ]);
    expect(stay.state().staying).toBe(true);
  });
  it('the replay exit plays the finale again and comes back to stay a while', () => {
    const { bus, finale, stay } = setup();
    bus.emit('act:done', { act: 5 });
    run(finale, finale.machine.totalSeconds + 1);
    expect(stay.exit('replay')).toBe(true);
    expect(finale.state().phase).toBe('lifting');
    expect(stay.state().staying).toBe(false);
    run(finale, finale.machine.totalSeconds + 1);
    expect(finale.state().timesStarted).toBe(2);
    expect(stay.state().staying).toBe(true);
    expect(stay.state().timesEntered).toBe(2);
  });
  it('the letter exit says so on the bus, and when the letter is put away again she is back, with the finale not replayed', () => {
    const { bus, seen, finale, stay } = setup();
    bus.emit('act:done', { act: 5 });
    run(finale, finale.machine.totalSeconds + 1);
    expect(stay.exit('letter')).toBe(true);
    expect(seen).toContain('stay:exit {"to":"letter"}');
    expect(stay.state().exits).toEqual([]);
    bus.emit('act:done', { act: 5 }); // she closed the read-again
    expect(stay.state().staying).toBe(true);
    expect(finale.state().timesStarted).toBe(1);
  });
  it('activities are announced and change no exit', () => {
    const { seen, stay, finale, bus } = setup();
    bus.emit('act:done', { act: 5 });
    run(finale, finale.machine.totalSeconds + 1);
    stay.setActivity('pet');
    stay.setActivity('pet');
    expect(seen.filter((s) => s.startsWith('stay:activity'))).toEqual(['stay:activity {"activity":"pet"}']);
    expect(stay.state().exits).toEqual(['letter', 'replay']);
  });
  it('dispose lets go of the bus', () => {
    const { bus, finale, stay } = setup();
    finale.dispose();
    stay.dispose();
    bus.emit('act:done', { act: 5 });
    expect(finale.state().started).toBe(false);
  });
});
