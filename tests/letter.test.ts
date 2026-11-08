import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LetterMachine, LETTER, signOffLines, letterTextFor, type LetterEvent } from '../src/acts/letterMath';
import { createLetterAct } from '../src/acts/act5_letter';
import { createBus, type WinterEvents } from '../src/state/events';
import { assertContent, validateContent, ContentError, type RawContent } from '../src/content/validate';

// Phase 27 (first quarter): the letter ritual's rules, the verbatim guarantee and the production guard. No word of the owner's is used or invented here.

const disk = (f: string) => readFileSync(`content/${f}`, 'utf8');
const real: RawContent = { letter: disk('letter.md'), wishes: disk('wishes.json'), names: disk('names.json'), credits: disk('credits.json') };
const filled: RawContent = {
  letter: 'x',
  wishes: JSON.stringify({ _note: 'x', strawberry: 'a', bumblebee: 'b', rose: 'c', 'kaaju-katli': 'd', 'cutie-patootie': 'e' }),
  names: JSON.stringify({
    formal: 'F', nickname: 'N', owner_calls_her: 'O', she_calls_owner: 'S', character: { name: 'C' },
    constellations: ['strawberry', 'bumblebee', 'rose', 'kaaju-katli', 'cutie-patootie'].map((id) => ({ id, name: id, shape: 's' })),
  }),
  credits: JSON.stringify({ finale_sky_message: 'c', sign_off: 'd', made_by: 'e' }),
};

const run = (m: LetterMachine, seconds: number, dt = 1 / 60): void => {
  for (let t = 0; t < seconds; t += dt) m.step(dt);
};
const types = (log: readonly LetterEvent[]): string[] => log.map((e) => e.type);

describe('the ritual', () => {
  it('starts idle and does nothing until start()', () => {
    const m = new LetterMachine();
    run(m, 30);
    expect(m.phase).toBe('idle');
    expect(m.log).toEqual([]);
    expect(m.open()).toBe(false);
    expect(m.close()).toBe(false);
    expect(m.readAgain()).toBe(false);
  });
  it('arrives, then WAITS for ever: nothing opens it but open()', () => {
    const m = new LetterMachine();
    m.start();
    run(m, 600); // ten minutes
    expect(m.phase).toBe('waiting');
    expect(m.canOpen).toBe(true);
    expect(types(m.log)).toEqual(['arrive', 'ready']);
  });
  it('open() works only while waiting, then the opening runs and the reader opens once', () => {
    const m = new LetterMachine();
    expect(m.open()).toBe(false);
    m.start();
    expect(m.open()).toBe(false); // still arriving
    run(m, LETTER.arriveS.lantern + 0.1);
    expect(m.open()).toBe(true);
    expect(m.open()).toBe(false); // a second tap does nothing
    expect(m.phase).toBe('opening');
    run(m, LETTER.openS + 0.1);
    expect(m.phase).toBe('reading');
    expect(types(m.log)).toEqual(['arrive', 'ready', 'opening', 'open']);
    expect(m.timesOpened).toBe(1);
  });
  it('start() twice arrives once', () => {
    const m = new LetterMachine();
    m.start();
    m.start();
    expect(types(m.log)).toEqual(['arrive']);
  });
  it('a huge frame is capped, so a stalled tab does not skip the arrival', () => {
    const m = new LetterMachine();
    m.start();
    m.step(1e9);
    expect(m.phase).toBe('arriving');
    expect(m.phaseTime).toBeLessThanOrEqual(LETTER.maxDt + 1e-9);
  });
  it('NaN, negative, zero and infinite frames are ignored', () => {
    const m = new LetterMachine();
    m.start();
    for (const bad of [NaN, -1, 0, Infinity, -Infinity]) m.step(bad);
    expect(m.time).toBe(0);
  });
  it('the table delivery is shorter than the lantern, reduced motion shorter still, and the beats are the same', () => {
    expect(LETTER.arriveS.table).toBeLessThan(LETTER.arriveS.lantern);
    expect(LETTER.reducedArriveS).toBeLessThan(LETTER.arriveS.table);
    for (const opts of [{ delivery: 'lantern' as const }, { delivery: 'table' as const }, { reducedMotion: true }]) {
      const m = new LetterMachine(opts);
      m.start();
      run(m, 20);
      m.open();
      run(m, 20);
      expect(types(m.log)).toEqual(['arrive', 'ready', 'opening', 'open']);
    }
  });
  it('progress values for the picture run 0 to 1 and hold', () => {
    const m = new LetterMachine();
    expect(m.arriveProgress).toBe(0);
    m.start();
    run(m, LETTER.arriveS.lantern / 2);
    expect(m.arriveProgress).toBeGreaterThan(0.4);
    expect(m.arriveProgress).toBeLessThan(0.6);
    run(m, 20);
    expect(m.arriveProgress).toBe(1);
    expect(m.openProgress).toBe(0);
    m.open();
    run(m, 20);
    expect(m.openProgress).toBe(1);
  });
});

describe('reading, reading again, and "read"', () => {
  const opened = (): LetterMachine => {
    const m = new LetterMachine();
    m.start();
    run(m, 20);
    m.open();
    run(m, 20);
    return m;
  };
  it('"read" fires once, only at the end of the scroll, only while the reader is open', () => {
    const m = new LetterMachine();
    m.reportProgress(1); // idle: ignored
    expect(m.read).toBe(false);
    const o = opened();
    o.reportProgress(NaN);
    o.reportProgress(0.5);
    expect(o.read).toBe(false);
    o.reportProgress(LETTER.readAt);
    o.reportProgress(1);
    expect(o.log.filter((e) => e.type === 'read')).toHaveLength(1);
    expect(o.read).toBe(true);
  });
  it('close() only from reading; read again goes straight back, any number of times, with no ritual', () => {
    const m = opened();
    expect(m.canReadAgain).toBe(false);
    expect(m.readAgain()).toBe(false);
    expect(m.close()).toBe(true);
    expect(m.close()).toBe(false);
    expect(m.canReadAgain).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(m.readAgain()).toBe(true);
      expect(m.phase).toBe('reading'); // no arriving, no opening
      expect(m.close()).toBe(true);
    }
    expect(m.timesOpened).toBe(6);
    expect(m.log.filter((e) => e.type === 'arrive')).toHaveLength(1);
    expect(m.log.filter((e) => e.type === 'opening')).toHaveLength(1);
  });
  it('a letter read on an earlier visit does not fire "read" again, and she can still open it', () => {
    const m = new LetterMachine();
    m.markReadFromProgress();
    m.start();
    run(m, 20);
    m.open();
    run(m, 20);
    m.reportProgress(1);
    expect(m.log.some((e) => e.type === 'read')).toBe(false);
    expect(m.read).toBe(true);
  });
  it('a throwing listener never stops the ritual', () => {
    const m = new LetterMachine({
      onEvent: () => {
        throw new Error('boom');
      },
    });
    m.start();
    run(m, 20);
    expect(m.phase).toBe('waiting');
  });
  it('fuzz: any order of calls ends somewhere legal and events stay in order', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let run_ = 0; run_ < 200; run_++) {
      const m = new LetterMachine({ reducedMotion: rnd() < 0.3 });
      for (let i = 0; i < 300; i++) {
        const r = rnd();
        if (r < 0.1) m.start();
        else if (r < 0.2) m.open();
        else if (r < 0.3) m.close();
        else if (r < 0.4) m.readAgain();
        else if (r < 0.5) m.reportProgress(rnd());
        else m.step(rnd() * 0.5);
      }
      const order = ['idle', 'arriving', 'waiting', 'opening', 'reading', 'closed'];
      expect(order).toContain(m.phase);
      const t = types(m.log);
      expect(t.filter((x) => x === 'arrive').length).toBeLessThanOrEqual(1);
      expect(t.filter((x) => x === 'ready').length).toBeLessThanOrEqual(1);
      expect(t.filter((x) => x === 'opening').length).toBeLessThanOrEqual(1);
      expect(t.filter((x) => x === 'read').length).toBeLessThanOrEqual(1);
      if (t.length) expect(t[0]).toBe('arrive');
    }
  });
});

describe('the act on the bus', () => {
  it('starts by itself on release:done and says act 5 and the letter events, in order', () => {
    const release = createBus<WinterEvents>();
    const act = createLetterAct({ chainFrom: release });
    const seen: string[] = [];
    for (const k of ['act:enter', 'letter:arrive', 'letter:open', 'letter:read', 'letter:close', 'act:done'] as const) {
      act.bus.on(k, () => seen.push(k));
    }
    act.step(30);
    expect(act.state().phase).toBe('idle'); // nothing before the release is over
    release.emit('release:done');
    for (let i = 0; i < 1200; i++) act.step(1 / 60);
    expect(act.state().canOpen).toBe(true);
    act.open();
    for (let i = 0; i < 600; i++) act.step(1 / 60);
    act.reportProgress(1);
    act.close();
    expect(seen).toEqual(['act:enter', 'letter:arrive', 'letter:open', 'letter:read', 'letter:close', 'act:done']);
    expect(act.state().canReadAgain).toBe(true);
    act.dispose();
    expect(release.listenerCount('release:done')).toBe(0);
  });
  it('a second release:done does not restart it', () => {
    const release = createBus<WinterEvents>();
    const act = createLetterAct({ chainFrom: release });
    release.emit('release:done');
    release.emit('release:done');
    expect(act.machine.log.filter((e) => e.type === 'arrive')).toHaveLength(1);
  });
});

describe('the letter text is the file, byte for byte', () => {
  const nasty = ['', 'a', '  leading spaces\n\n\ttab\r\nwindows line\r\n', 'trailing   \n\n\n', 'नमस्ते, kya haal hai 😭😭\n\nline two', '<b>not html</b> & &amp; "quotes" \'x\'', 'a\u00a0b\u200bc\u2028d'];
  it('letterTextFor returns exactly what it is given', () => {
    for (const s of nasty) expect(letterTextFor(s)).toBe(s);
  });
  it('loading content returns exactly the file for the letter, in lenient mode', () => {
    for (const s of nasty.filter((x) => x.trim() !== '')) {
      const r = assertContent({ ...filled, letter: s }, false);
      expect(r.content.letter).toBe(s);
      expect(letterTextFor(r.content.letter)).toBe(s);
    }
  });
  it('the reader and the act source never trim, replace, split or parse the text', () => {
    const reader = readFileSync('src/ui/letterReader.ts', 'utf8');
    const act = readFileSync('src/acts/act5_letter.ts', 'utf8');
    expect(reader).toContain('column.textContent = o.text');
    expect(reader).not.toMatch(/innerHTML\s*=\s*o\.text|\.trim\(|\.replace\(|\.split\(/);
    expect(act).not.toMatch(/\.(trim|replace|split)\(/);
    expect(readFileSync('src/acts/letterMath.ts', 'utf8')).toMatch(/export function letterTextFor\(fileText: string\): string \{\s*return fileText;/);
  });
  it('the letter machine has no words of the letter: no sentence-like string literal', () => {
    const src = readFileSync('src/acts/letterMath.ts', 'utf8').replace(/\/\/[^\n]*/g, '');
    const literals = [...src.matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]);
    expect(literals.filter((s) => / [a-z]+ [a-z]+/.test(s!))).toEqual([]);
  });
});

describe('the sign-off comes from credits.json, nothing added', () => {
  it('gives the two strings in order and leaves blanks out', () => {
    expect(signOffLines({ sign_off: 'one', made_by: 'two' })).toEqual(['one', 'two']);
    expect(signOffLines({ sign_off: '  ', made_by: 'two' })).toEqual(['two']);
    expect(signOffLines({ sign_off: '', made_by: '' })).toEqual([]);
  });
  it('does not alter the owner\'s strings', () => {
    expect(signOffLines({ sign_off: ' x  y ', made_by: 'z\n' })).toEqual([' x  y ', 'z\n']);
  });
});

describe('a production build refuses a letter that is still a placeholder', () => {
  it('the real letter.md still says TODO_OWNER, so strict mode throws and names the file', () => {
    expect(real.letter).toContain('TODO_OWNER');
    expect(() => assertContent(real, true)).toThrow(ContentError);
    expect(() => assertContent(real, true)).toThrow(/content\/letter\.md/);
  });
  it('lenient mode (the dev preview) still builds and reports the placeholder', () => {
    const r = validateContent(real);
    expect(r.placeholders.some((p) => p.file === 'content/letter.md')).toBe(true);
  });
  it('a filled letter passes strict mode', () => {
    expect(() => assertContent(filled, true)).not.toThrow();
  });
});

describe('the flow, the reader\'s sign-off and the read-again button (second quarter, source level; the DOM is checked by tools/letter_check.py)', () => {
  const flow = readFileSync('src/acts/letterFlow.ts', 'utf8');
  const reader = readFileSync('src/ui/letterReader.ts', 'utf8');
  const replay = readFileSync('src/ui/replayControls.ts', 'utf8');
  const css = readFileSync('src/ui/theme.css', 'utf8');
  it('the flow passes the letter and the credits through unchanged and imports no three, audio or world', () => {
    expect(flow).toContain('text: o.letter');
    expect(flow).toContain('signOffLines(o.credits)');
    expect(flow).not.toMatch(/from '(three|\.\.\/(audio|world|character|constellations|fx))/);
    expect(flow).not.toMatch(/\.(trim|replace|split)\(/);
  });
  it('the read-again button starts hidden, shows only on letter:close, hides on letter:open', () => {
    expect(flow).toMatch(/controls\.add\('letter'[\s\S]*visible: false/);
    expect(flow).toMatch(/'letter:close'[\s\S]*setVisible\('letter', true\)/);
    expect(flow).toMatch(/'letter:open'[\s\S]*setVisible\('letter', false\)/);
  });
  it('the reader\'s close goes back to the act, and the scroll is reported', () => {
    expect(flow).toMatch(/onToggle: \(open\) => \{\s*if \(!open\) o\.act\.close\(\)/);
    expect(flow).toContain('o.act.reportProgress(reader.progress())');
  });
  it('the sign-off is its own block set with textContent, outside the letter column', () => {
    expect(reader).toContain("sign.className = 'wl-letter-signoff'");
    expect(reader).toContain('p.textContent = line');
    expect(reader).toMatch(/scroller\.appendChild\(column\);[\s\S]*scroller\.appendChild\(sign\)/);
    expect(css).toContain('.wl-letter-signoff');
  });
  it('replay controls have a letter kind, a plain label, and keep their order (Phase 28 added `finale` before `letter`)', () => {
    expect(replay).toContain("'Read the letter again'");
    expect(replay).toContain("['music', 'wishes', 'finale', 'letter']");
  });
  it('the ritual test view has no words of its own beyond one functional label and takes made-up text from the URL', () => {
    const view = readFileSync('src/acts/letterView.ts', 'utf8');
    expect(view).toContain("'Open the envelope'");
    expect(view).toContain("params.has('ritual')".replace('params', 'ctx.params'));
  });
});
