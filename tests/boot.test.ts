import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTasks, BootError, type BootTask } from '../src/core/bootTasks';
import { ProgressEase, stallLevel, CREEP_CEILING, CREEP_HEADROOM, SLOW_AFTER, STUCK_AFTER } from '../src/ui/bootMath';
import { BOOT_TEXT, describeFailure } from '../src/ui/bootText';

const tick = (): Promise<void> => Promise.resolve();

describe('the task runner', () => {
  it('runs tasks in order, yields between them, and reports a growing progress that ends at 1', async () => {
    const order: string[] = [];
    let yields = 0;
    const tasks: BootTask[] = ['a', 'b', 'c'].map((id, i) => ({ id, weight: [1, 2, 1][i], run: () => void order.push(id) }));
    const seen: number[] = [];
    await runTasks(tasks, { onProgress: (p) => seen.push(p), yieldFn: async () => void yields++ });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(yields).toBe(3);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen[0]).toBeCloseTo(0.25, 9); // weights 1, 2, 1
  });
  it('a task can report part of itself, clamped, and the bar never goes back', async () => {
    const seen: number[] = [];
    await runTasks(
      [
        {
          id: 'x',
          weight: 4,
          async run(report) {
            report(0.25);
            report(0.1); // going back is ignored
            report(7); // too much is clamped
            report(NaN);
          },
        },
        { id: 'y', run: () => undefined },
      ],
      { onProgress: (p) => seen.push(p), yieldFn: tick },
    );
    expect(Math.max(...seen)).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen[0]).toBeCloseTo(0.2, 9);
  });
  it('the first task that throws stops the boot and is named, whatever it threw', async () => {
    const ran: string[] = [];
    const tasks: BootTask[] = [
      { id: 'one', run: () => void ran.push('one') },
      { id: 'two', run: () => { throw 'plain string'; } },
      { id: 'three', run: () => void ran.push('three') },
    ];
    await expect(runTasks(tasks, { yieldFn: tick })).rejects.toMatchObject({ name: 'BootError', taskId: 'two' });
    expect(ran).toEqual(['one']);
    const err = await runTasks([{ id: 'p', run: () => Promise.reject(new Error('boom')) }], { yieldFn: tick }).catch((e) => e);
    expect(err).toBeInstanceOf(BootError);
    expect(String(err.message)).toContain('boom');
  });
  it('no tasks is a finished boot, and bad weights count as 1', async () => {
    const seen: number[] = [];
    await runTasks([], { onProgress: (p) => seen.push(p), yieldFn: tick });
    expect(seen).toEqual([1]);
    const s2: number[] = [];
    await runTasks([{ id: 'a', weight: -3, run: () => undefined }, { id: 'b', weight: NaN, run: () => undefined }], { onProgress: (p) => s2.push(p), yieldFn: tick });
    expect(s2).toEqual([0.5, 1]);
  });
  it('the default yield really gives the page a turn (a zero timeout)', async () => {
    let timerRan = false;
    setTimeout(() => (timerRan = true), 0);
    let sawTimer = false;
    await runTasks([{ id: 'a', run: () => undefined }, { id: 'b', run: () => void (sawTimer = timerRan) }]);
    expect(sawTimer).toBe(true);
  });
});

describe('the loading bar', () => {
  it('never goes backwards, never reaches full before the boot is done, and never sits perfectly still', () => {
    const e = new ProgressEase(0);
    let prev = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const target = Math.min(0.5, i / 600); // real progress stalls at 0.5 for a long time
      const v = e.update(1 / 60, target, false);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(CREEP_CEILING);
      prev = v;
    }
    // stalled at 0.5 for 30 s: it crept a little past it and stopped at the ceiling just ahead of the real progress (the words take over: slow, then reload)
    expect(e.shown).toBeGreaterThan(0.5);
    expect(e.shown).toBeLessThanOrEqual(0.5 + CREEP_HEADROOM + 1e-9);
    // while it is within the headroom it keeps moving
    const f = new ProgressEase(0.5);
    const b = f.update(1 / 60, 0.5, false);
    for (let i = 0; i < 60 * 3; i++) f.update(1 / 60, 0.5, false);
    expect(f.shown).toBeGreaterThan(b);
  });
  it('catches up to real progress smoothly, without a jump', () => {
    const e = new ProgressEase(0);
    e.update(1 / 60, 0.8, false);
    expect(e.shown).toBeLessThan(0.05); // one frame later it has barely moved
    for (let i = 0; i < 60 * 4; i++) e.update(1 / 60, 0.8, false);
    expect(e.shown).toBeGreaterThan(0.78);
  });
  it('runs to exactly full within a second when done, from anywhere', () => {
    for (const start of [0, 0.3, 0.9, 0.97]) {
      const e = new ProgressEase(start);
      for (let i = 0; i < 61; i++) e.update(1 / 60, 1, true);
      expect(e.shown).toBe(1);
    }
  });
  it('bad numbers never break it', () => {
    const e = new ProgressEase(NaN);
    for (const dt of [NaN, -1, 0, Infinity, 1e9]) for (const t of [NaN, -5, 7]) expect(Number.isFinite(e.update(dt, t, false))).toBe(true);
    expect(e.shown).toBeLessThanOrEqual(CREEP_CEILING);
  });
  it('says the connection is slow after a while, and offers a reload later still', () => {
    expect(stallLevel(0)).toBe('ok');
    expect(stallLevel(SLOW_AFTER - 0.1)).toBe('ok');
    expect(stallLevel(SLOW_AFTER)).toBe('slow');
    expect(stallLevel(STUCK_AFTER)).toBe('stuck');
    expect(stallLevel(NaN)).toBe('ok');
  });
});

describe('the words', () => {
  it('every failure kind has a title and a body in plain words (no code, no stack, no jargon)', () => {
    for (const k of ['webgl', 'script', 'context'] as const) {
      const d = describeFailure(k);
      expect(d.title.length).toBeGreaterThan(3);
      expect(d.body.length).toBeGreaterThan(20);
      expect(`${d.title} ${d.body}`).not.toMatch(/undefined|exception|stack|error code|0x|null/i);
    }
    expect(describeFailure('webgl').title).toContain('WebGL');
  });
  it('index.html carries the same sentences for the moments before any script has arrived', () => {
    const html = readFileSync('index.html', 'utf8');
    for (const k of ['slow', 'stuck', 'noWebglTitle', 'noWebglBody', 'scriptFailTitle', 'scriptFailBody', 'noscript', 'loading', 'reload'] as const) {
      expect(html, k).toContain(BOOT_TEXT[k]);
    }
  });
  it('the words are warm and short, with nothing romantic and nothing from the letter', () => {
    const all = Object.values(BOOT_TEXT).join(' ');
    expect(all).not.toMatch(/love|heart|darling|dear|\u2764/i);
    for (const v of Object.values(BOOT_TEXT)) expect(v.length).toBeLessThan(200);
  });
  it('the page has the splash, the snow, the bar and a reload button, and keeps the old text line', () => {
    const html = readFileSync('index.html', 'utf8');
    for (const id of ['splash', 'splash-fill', 'splash-msg', 'splash-title', 'splash-reload', 'boot']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain("getContext('webgl2')");
    expect(html).not.toMatch(/<img|https?:\/\//); // nothing to fetch before the app: no images, no outside links
  });

  it('when the page has already failed on its own (no WebGL), the app keeps those words instead of painting over them (found by the no-WebGL screenshot)', () => {
    const src = readFileSync('src/ui/boot.ts', 'utf8');
    expect(src).toMatch(/let failed = state\.failed/);
  });
});
