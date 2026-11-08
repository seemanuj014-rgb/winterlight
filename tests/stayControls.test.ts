import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFinaleAct } from '../src/acts/act6_finale';
import { createLetterAct } from '../src/acts/act5_letter';
import { createStayAwhileAct } from '../src/acts/stayAwhile';
import { createStayControls } from '../src/acts/stayControls';
import { REPLAY_LABELS } from '../src/ui/replayControls';
import { createBus, type WinterEvents } from '../src/state/events';

// Phase 28 (third quarter): the two exits of stay a while as controls, on the real letter, finale and stay acts sharing one bus. A fake replay column stands in for the DOM.

const run = (m: { step(dt: number): void }, seconds: number, dt = 1 / 60): void => {
  for (let t = 0; t < seconds; t += dt) m.step(dt);
};

function setup() {
  const bus = createBus<WinterEvents>(() => undefined);
  const letter = createLetterAct({ bus });
  const finale = createFinaleAct({ bus, chainFrom: bus });
  const stay = createStayAwhileAct({ bus, chainFrom: bus });
  const shown = new Map<string, boolean>();
  const pressed: string[] = [];
  const presses = new Map<string, () => void>();
  const controls = {
    add: (kind: string, press: () => void, opts?: { visible?: boolean }) => {
      shown.set(kind, opts?.visible !== false);
      presses.set(kind, press);
      return undefined as never;
    },
    setVisible: (kind: string, on: boolean) => void shown.set(kind, on),
  };
  const sc = createStayControls({ stay, letter, controls: controls as never });
  // the letter is read once and put away, the finale plays, she is staying
  letter.start();
  run(letter, 30);
  letter.open();
  run(letter, 10); // the flap and the letter rising, then she is reading
  letter.close();
  run(finale, 60);
  return { bus, letter, finale, stay, sc, shown, pressed, presses };
}

describe('the ending-again control', () => {
  it('exists from the start, but is shown only while she is staying', () => {
    const bus = createBus<WinterEvents>(() => undefined);
    const letter = createLetterAct({ bus });
    const stay = createStayAwhileAct({ bus, chainFrom: bus });
    const shown = new Map<string, boolean>();
    createStayControls({ stay, letter, controls: { add: (k, _p, o) => (shown.set(k, o?.visible !== false), undefined as never), setVisible: (k, on) => void shown.set(k, on) } });
    expect(shown.get('finale')).toBe(false);
    stay.enter();
    expect(shown.get('finale')).toBe(true);
    stay.exit('replay');
    expect(shown.get('finale')).toBe(false);
  });
  it('pressing it plays the finale again and she comes back to stay a while, with the control back', () => {
    const { finale, stay, shown, presses } = setup();
    expect(stay.state().staying).toBe(true);
    expect(shown.get('finale')).toBe(true);
    presses.get('finale')!();
    expect(stay.state().staying).toBe(false);
    expect(shown.get('finale')).toBe(false);
    expect(finale.machine.phase).toBe('lifting');
    run(finale, 60);
    expect(stay.state().staying).toBe(true);
    expect(shown.get('finale')).toBe(true);
    expect(finale.machine.timesStarted).toBe(2);
  });
});

describe('the way to the letter', () => {
  it('toLetter() leaves stay a while, opens the letter, and she comes back when it is put away', () => {
    const { letter, stay, sc } = setup();
    expect(sc.toLetter()).toBe(true);
    expect(stay.state().staying).toBe(false);
    expect(letter.machine.phase).toBe('reading');
    letter.close();
    expect(stay.state().staying).toBe(true);
    expect(stay.state().timesEntered).toBe(2);
  });
  it('the letter\'s own read-again button counts as the exit too, once (no double exit)', () => {
    const { bus, letter, stay } = setup();
    const exits: string[] = [];
    bus.on('stay:exit', (e) => void exits.push(e.to));
    letter.readAgain();
    expect(exits).toEqual(['letter']);
    expect(stay.state().staying).toBe(false);
    letter.close();
    expect(stay.state().staying).toBe(true);
  });
  it('toLetter() does nothing, and she stays, when the letter cannot open (never read yet)', () => {
    const bus = createBus<WinterEvents>(() => undefined);
    const letter = createLetterAct({ bus }); // idle: nothing to read again
    const stay = createStayAwhileAct({ bus, chainFrom: bus });
    const sc = createStayControls({ stay, letter, controls: { add: () => undefined as never, setVisible: () => undefined } });
    stay.enter();
    expect(sc.toLetter()).toBe(false);
    expect(stay.state().staying).toBe(true);
    expect(stay.state().exits).toEqual(['letter', 'replay']);
  });
  it('toLetter() when she is not staying does nothing', () => {
    const { stay, sc } = setup();
    stay.exit('replay');
    expect(sc.toLetter()).toBe(false);
  });
  it('a letter opened during a replay does not end the replay early: she comes back only when the finale is done', () => {
    const { letter, finale, stay, sc } = setup();
    sc.replay();
    run(finale, 3);
    expect(finale.machine.phase).not.toBe('done');
    letter.readAgain();
    letter.close();
    expect(stay.state().staying).toBe(false);
    run(finale, 60);
    expect(stay.state().staying).toBe(true);
  });
});

describe('never trapped, with the real acts', () => {
  it('fuzz: 300 random sessions; once she has entered, she is always staying, or the finale is playing, or the letter is open', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let n = 0; n < 300; n++) {
      const { letter, finale, stay, sc } = setup();
      for (let i = 0; i < 40; i++) {
        const r = rnd();
        if (r < 0.2) sc.toLetter();
        else if (r < 0.4) sc.replay();
        else if (r < 0.55) letter.readAgain();
        else if (r < 0.7) letter.close();
        else if (r < 0.8) stay.setActivity(rnd() < 0.5 ? 'pet' : 'wishes');
        else run(finale, rnd() * 5);
        const letterOpen = letter.machine.phase === 'reading' || letter.machine.phase === 'opening';
        const finalePlaying = finale.machine.phase !== 'done' && finale.machine.phase !== 'idle';
        expect(stay.state().staying || finalePlaying || letterOpen).toBe(true);
      }
    }
  });
});

describe('the files', () => {
  it('stayControls draws nothing, imports no three, audio or DOM, and has no sentence', () => {
    const src = readFileSync('src/acts/stayControls.ts', 'utf8').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/from 'three'|audio|document\.|window\./);
    expect(src).not.toMatch(/['"`][A-Z][a-z]+ [a-z]+ [a-z]+[^'"`]*['"`]/);
  });
  it('the new button has a plain functional name and sits before the letter button', () => {
    expect(REPLAY_LABELS.finale).toBe('Play the ending again');
    const src = readFileSync('src/ui/replayControls.ts', 'utf8');
    expect(src).toMatch(/\['music', 'wishes', 'finale', 'letter'\]/);
  });
  it('the engine hears the finale swell and no other finale event', () => {
    const src = readFileSync('src/audio/engine.ts', 'utf8');
    expect(src).toMatch(/bus\.on\('finale:swell', \(\) => void api\.birthday\(\)\)/);
    expect(src).not.toMatch(/bus\.on\('finale:(start|join|pullback|done)'/);
  });
});
