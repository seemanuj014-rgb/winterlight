import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertContent, validateContent, ContentError, PLACEHOLDER, type RawContent } from '../src/content/validate';
import { isStrictEnv } from '../tools/buildEnv';
import { createBus } from '../src/state/events';
import { createProgress, createMemoryStorage, parseProgress, pickStorage, PROGRESS_KEY, type KeyValueStorage } from '../src/state/progress';

const disk = (f: string) => readFileSync(`content/${f}`, 'utf8');
const real: RawContent = { letter: disk('letter.md'), wishes: disk('wishes.json'), names: disk('names.json'), credits: disk('credits.json') };

// A filled set, written only for these tests. Nothing here is shipped or is the owner's wording.
const filled: RawContent = {
  letter: 'line one\n\n  line two, spacing kept \n',
  wishes: JSON.stringify({ _note: 'x', strawberry: 'a', bumblebee: 'b', rose: 'c', 'kaaju-katli': 'd', 'cutie-patootie': 'e' }),
  names: JSON.stringify({
    formal: 'F', nickname: 'N', owner_calls_her: 'O', she_calls_owner: 'S', character: { name: 'C' },
    constellations: ['strawberry', 'bumblebee', 'rose', 'kaaju-katli', 'cutie-patootie'].map((id) => ({ id, name: id, shape: 's' })),
  }),
  credits: JSON.stringify({ finale_sky_message: 'c', sign_off: 'd', made_by: 'e' }),
};

describe('placeholder detection', () => {
  it('finds every placeholder in the real files, with file and field', () => {
    const r = validateContent(real);
    expect(r.errors).toEqual([]);
    // the real files fill in over time, so only the shape is pinned: every placeholder names its file and field
    for (const p of r.placeholders) expect(`${p.file}:${p.where}`).toMatch(/^content\/[a-z]+\.(md|json):.+/);
  });
  it('allows placeholders in dev and returns the content as written', () => {
    const r = assertContent(real, false);
    expect(r.placeholders.length).toBe(11);
    expect(r.content.letter).toBe(real.letter);
  });
  it('refuses placeholders in a strict (production) build, naming each one', () => {
    expect(() => assertContent(real, true)).toThrow(ContentError);
    try {
      assertContent(real, true);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('Refusing to ship');
      expect(msg).toContain('content/wishes.json > rose');
      expect(msg).toContain(PLACEHOLDER);
    }
  });
  it('ignores underscore note keys', () => {
    const r = validateContent({ ...filled, wishes: JSON.stringify({ _note: PLACEHOLDER, strawberry: 'a', bumblebee: 'b', rose: 'c', 'kaaju-katli': 'd', 'cutie-patootie': 'e' }) });
    expect(r.placeholders).toEqual([]);
  });
  it('a filled set passes strict, and the letter is returned byte for byte', () => {
    const r = assertContent(filled, true);
    expect(r.placeholders).toEqual([]);
    expect(r.content.letter).toBe(filled.letter);
    expect(r.content.names.constellations).toHaveLength(5);
  });
});

describe('structural errors are always fatal', () => {
  it('bad JSON, empty letter, missing and stray wishes, duplicate ids, missing credits', () => {
    expect(() => assertContent({ ...filled, wishes: '{nope' }, false)).toThrow(/not valid JSON/);
    expect(() => assertContent({ ...filled, letter: '  \n' }, false)).toThrow(/is empty/);
    expect(() => assertContent({ ...filled, wishes: JSON.stringify({ strawberry: 'a' }) }, false)).toThrow(/missing/);
    expect(() => assertContent({ ...filled, wishes: JSON.stringify({ strawberry: 'a', bumblebee: 'b', rose: 'c', 'kaaju-katli': 'd', 'cutie-patootie': 'e', extra: 'z' }) }, false)).toThrow(/does not match any constellation/);
    const dup = JSON.parse(filled.names);
    dup.constellations[1].id = 'strawberry';
    expect(() => assertContent({ ...filled, names: JSON.stringify(dup) }, false)).toThrow(/used twice/);
    expect(() => assertContent({ ...filled, credits: JSON.stringify({ finale_sky_message: 'a' }) }, false)).toThrow(/sign_off/);
  });
});

describe('build env', () => {
  it('strict mode follows Vercel production or WINTERLIGHT_STRICT=1 only', () => {
    expect(isStrictEnv({ VERCEL_ENV: 'production' })).toBe(true);
    expect(isStrictEnv({ WINTERLIGHT_STRICT: '1' })).toBe(true);
    expect(isStrictEnv({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(isStrictEnv({})).toBe(false);
  });
});

describe('progress store', () => {
  it('round-trips through storage', () => {
    const storage = createMemoryStorage();
    const a = createProgress({ storage });
    expect(a.markConstellation('rose')).toBe(true);
    expect(a.markConstellation('rose')).toBe(false);
    expect(a.markLetterRead()).toBe(true);
    expect(a.markSecret('moon')).toBe(true);
    const b = createProgress({ storage });
    expect(b.get()).toEqual({ v: 1, constellations: ['rose'], letterRead: true, secrets: ['moon'] });
  });
  it('get() returns a copy and subscribers hear changes', () => {
    const s = createProgress({ storage: createMemoryStorage() });
    const seen: number[] = [];
    const off = s.subscribe((p) => seen.push(p.constellations.length));
    s.get().constellations.push('hacked');
    s.markConstellation('rose');
    off();
    s.markConstellation('bumblebee');
    expect(seen).toEqual([1]);
    expect(s.get().constellations).toEqual(['rose', 'bumblebee']);
  });
  it('only known constellation ids can be marked when a list is given', () => {
    const s = createProgress({ storage: createMemoryStorage(), knownConstellations: ['rose'] });
    expect(s.markConstellation('nope')).toBe(false);
    expect(s.markConstellation('rose')).toBe(true);
  });
  it('reset clears memory and storage', () => {
    const storage = createMemoryStorage();
    const s = createProgress({ storage });
    s.markSecret('moon');
    s.reset();
    expect(s.get().secrets).toEqual([]);
    expect(storage.getItem(PROGRESS_KEY)).toBeNull();
  });
  it('corrupt or odd saved data becomes a clean default', () => {
    for (const raw of ['{nope', 'null', '42', '[]', '"x"']) expect(parseProgress(raw)).toEqual({ v: 1, constellations: [], letterRead: false, secrets: [] });
    expect(parseProgress(JSON.stringify({ constellations: ['rose', 'rose', 5, 'Bad Id'], letterRead: 'yes', secrets: 'x' }))).toEqual({ v: 1, constellations: ['rose'], letterRead: false, secrets: [] });
  });
});

describe('storage blocked', () => {
  const throwing: KeyValueStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  it('falls back to memory when reads throw', () => {
    const s = createProgress({ storage: throwing });
    expect(s.persistent).toBe(false);
    expect(s.markConstellation('rose')).toBe(true);
    expect(s.get().constellations).toEqual(['rose']);
  });
  it('keeps working from memory when a write fails mid-session', () => {
    let fail = false;
    const base = createMemoryStorage();
    const flaky: KeyValueStorage = { ...base, setItem(k, v) { if (fail) throw new Error('quota'); base.setItem(k, v); } };
    const s = createProgress({ storage: flaky });
    s.markSecret('moon');
    expect(s.persistent).toBe(true);
    fail = true;
    expect(s.markConstellation('rose')).toBe(true);
    expect(s.persistent).toBe(false);
    expect(s.get()).toEqual({ v: 1, constellations: ['rose'], letterRead: false, secrets: ['moon'] });
    s.reset();
    expect(s.get().secrets).toEqual([]);
  });
  it('pickStorage falls back when window.localStorage throws or is missing', () => {
    vi.stubGlobal('window', { get localStorage(): Storage { throw new Error('SecurityError'); } });
    const a = pickStorage();
    expect(a.persistent).toBe(false);
    a.storage.setItem('k', 'v');
    expect(a.storage.getItem('k')).toBe('v');
    vi.stubGlobal('window', {});
    expect(pickStorage().persistent).toBe(false);
    vi.unstubAllGlobals();
  });
  it('pickStorage uses a working localStorage', () => {
    const m = createMemoryStorage();
    vi.stubGlobal('window', { localStorage: m });
    expect(pickStorage()).toEqual({ storage: m, persistent: true });
    vi.unstubAllGlobals();
  });
});

describe('event bus', () => {
  interface E { ping: { n: number }; done: void }
  it('delivers typed payloads, supports off and once', () => {
    const bus = createBus<E>();
    const got: number[] = [];
    const h = (p: { n: number }) => got.push(p.n);
    const off = bus.on('ping', h);
    bus.once('ping', (p) => got.push(p.n * 10));
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    off();
    bus.emit('ping', { n: 3 });
    expect(got).toEqual([1, 10, 2]);
    expect(bus.listenerCount('ping')).toBe(0);
  });
  it('void events take no payload', () => {
    const bus = createBus<E>();
    const fn = vi.fn();
    bus.on('done', fn);
    bus.emit('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('one throwing handler does not stop the others, and unsubscribing mid-emit is safe', () => {
    const errors: unknown[] = [];
    const bus = createBus<E>((e) => errors.push(e));
    const seen: string[] = [];
    bus.on('ping', () => { throw new Error('bad'); });
    const off = bus.on('ping', () => { seen.push('a'); off(); });
    bus.on('ping', () => seen.push('b'));
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(seen).toEqual(['a', 'b', 'b']);
    expect(errors).toHaveLength(2);
  });
});
