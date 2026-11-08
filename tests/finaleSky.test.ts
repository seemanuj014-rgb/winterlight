import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  crownFor,
  CROWN_ORDER,
  finalePlacement,
  finaleCamera,
  finaleFade,
  skyCamera,
  valleyCamera,
  wrapLines,
  graphemes,
  layoutMessage,
  messageAlpha,
  messageFrame,
  auroraGain,
  AURORA_SWELL_GAIN,
  onScreen,
} from '../src/acts/finaleSkyMath';
import { layoutFor, skyViewFor, screenBox, extentOf, boxesOverlap } from '../src/constellations/skyLayoutMath';
import { SHAPES } from '../src/constellations/shapes';

// Phase 28 (second quarter): where the finale's pictures are. All pure; no word of the owner's is used or invented here (the strings below are made up for the layout test only).

const ASPECTS = [0.46, 0.56, 0.75, 1, 1.78, 2.2];
const defOf = (id: string) => Object.values(SHAPES).find((d) => d.id === id)!;
const mono = (px: number) => (s: string): number => Array.from(s).length * px * 0.5;

describe('the crown (the five shapes in one row)', () => {
  it.each(ASPECTS)('aspect %f: five placements, rows in order left to right, all on screen and not touching', (a) => {
    const c = crownFor(a);
    expect(Object.keys(c).sort()).toEqual([...CROWN_ORDER].sort());
    const view = skyViewFor(a);
    const lastU: Record<string, number> = {};
    const boxes: ReturnType<typeof screenBox>[] = [];
    for (const id of CROWN_ORDER) {
      const p = c[id]!;
      const pos = onScreen(a, p);
      const row = pos.v.toFixed(1); // shapes in one row are in the sky's order, left to right
      expect(pos.u).toBeGreaterThan(lastU[row] ?? -Infinity);
      lastU[row] = pos.u;
      const box = screenBox(view, p, extentOf(defOf(id).nodes), 0.1);
      expect(box.u0).toBeGreaterThanOrEqual(-1);
      expect(box.u1).toBeLessThanOrEqual(1);
      expect(box.v1).toBeLessThanOrEqual(1);
      boxes.push(box);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(boxesOverlap(boxes[i]!, boxes[j]!)).toBe(false);
  });
  it('the row sits above the message panel on every screen shape', () => {
    for (const a of ASPECTS) {
      const m = messageFrame(a);
      const view = skyViewFor(a);
      // the lowest edge of the crown is above the top edge of the panel (elevation of the panel's top vs the shapes' lowest star)
      const crownLow = Math.min(...CROWN_ORDER.map((id) => screenBox(view, crownFor(a)[id]!, extentOf(defOf(id).nodes), 0.05).v0));
      const tanV = Math.tan((view.fovDeg * Math.PI) / 360);
      const panelTopV = -0.14 + m.maxHeightM / 2 / (m.distance * tanV);
      expect(crownLow).toBeGreaterThan(panelTopV);
    }
  });
});

describe('finalePlacement (lift, then join)', () => {
  it('lift 0 and join 0 is exactly the Phase 22 patch', () => {
    for (const a of ASPECTS) for (const id of CROWN_ORDER) expect(finalePlacement(a, id, 0, 0)).toEqual(layoutFor(a)[id]);
  });
  it('lift 1 and join 1 is exactly the crown', () => {
    for (const a of ASPECTS) for (const id of CROWN_ORDER) {
      const p = finalePlacement(a, id, 1, 1);
      const c = crownFor(a)[id]!;
      expect(p.azDeg).toBeCloseTo(c.azDeg, 9);
      expect(p.elDeg).toBeCloseTo(c.elDeg, 9);
      expect(p.halfAngleDeg).toBeCloseTo(c.halfAngleDeg, 9);
    }
  });
  it('lifting only goes up, a little, and the shape stays where it was sideways', () => {
    const home = layoutFor(0.56).rose!;
    const p = finalePlacement(0.56, 'rose', 1, 0);
    expect(p.azDeg).toBeCloseTo(home.azDeg, 9);
    expect(p.elDeg).toBeGreaterThan(home.elDeg);
    expect(p.elDeg - home.elDeg).toBeLessThan(6);
  });
  it('it is smooth: no step bigger than a fraction of the whole move, and bad numbers do not break it', () => {
    let prev = finalePlacement(0.56, 'strawberry', 1, 0);
    const total = Math.abs(finalePlacement(0.56, 'strawberry', 1, 1).azDeg - prev.azDeg) + 1e-9;
    for (let j = 0.01; j <= 1.0001; j += 0.01) {
      const p = finalePlacement(0.56, 'strawberry', 1, j);
      expect(Math.abs(p.azDeg - prev.azDeg)).toBeLessThan(total * 0.1);
      prev = p;
    }
    const bad = finalePlacement(0.56, 'strawberry', NaN, Infinity);
    expect(Number.isFinite(bad.azDeg + bad.elDeg + bad.halfAngleDeg)).toBe(true);
  });
  it('an unknown shape is an error, not a silent default', () => {
    expect(() => finalePlacement(1, 'nope', 0, 0)).toThrow();
  });
});

describe('the message layout (the owner\'s words are only measured, never changed)', () => {
  const squash = (lines: string[]): string => lines.join(' ').replace(/ +/g, ' ').trim();
  it('wraps at spaces and loses no word', () => {
    const text = 'one two three four five six seven eight nine ten';
    const lines = wrapLines(text, mono(10), 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(mono(10)(l)).toBeLessThanOrEqual(100);
    expect(squash(lines)).toBe(text);
  });
  it('keeps paragraph breaks and blank lines as given', () => {
    expect(wrapLines('a\n\nb', mono(10), 1000)).toEqual(['a', '', 'b']);
  });
  it('splits one too-long word between grapheme clusters and keeps every character', () => {
    const word = 'x'.repeat(40);
    const lines = wrapLines(word, mono(10), 100);
    expect(lines.join('')).toBe(word);
    for (const l of lines) expect(mono(10)(l)).toBeLessThanOrEqual(100);
  });
  it('never splits a Devanagari conjunct or a combined mark in the middle', () => {
    const s = 'क्षत्रिय'; // क्ष (one cluster) + त्रि + य
    const g = graphemes(s);
    expect(g.join('')).toBe(s);
    if (typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter === 'function') expect(g.length).toBeLessThan(Array.from(s).length);
    const lines = wrapLines(s.repeat(6), mono(10), 60);
    expect(lines.join('')).toBe(s.repeat(6));
  });
  it('Hindi and Hinglish text keeps every character through layout', () => {
    const text = 'जन्मदिन मुबारक ho, yeh dil se hai';
    const lay = layoutMessage(text, mono, 1024, 400);
    expect(squash(lay.lines)).toBe(text);
  });
  it('a short message gets big type and a short panel; a long one gets smaller type', () => {
    const short = layoutMessage('hello', mono, 1024, 400);
    const long = layoutMessage('word '.repeat(80).trim(), mono, 1024, 400);
    expect(short.fontPx).toBeGreaterThan(long.fontPx);
    expect(short.heightPx).toBeLessThan(long.heightPx);
    expect(long.heightPx).toBeLessThanOrEqual(400);
  });
  it('a message too long for the smallest type grows the panel instead of cutting a word', () => {
    const text = 'word '.repeat(400).trim();
    const lay = layoutMessage(text, mono, 1024, 300);
    expect(lay.grew).toBe(true);
    expect(lay.fontPx).toBe(30);
    expect(lay.lines.join(' ').split(' ').length).toBe(400);
    expect(lay.heightPx).toBeGreaterThan(300);
  });
  it('a placeholder is laid out as the placeholder it is', () => {
    const lay = layoutMessage('TODO_OWNER', mono, 1024, 400);
    expect(lay.lines).toEqual(['TODO_OWNER']);
  });
  it('fits the screen: the panel is inside the view on every screen shape', () => {
    for (const a of ASPECTS) {
      const m = messageFrame(a);
      const view = skyViewFor(a);
      const tanV = Math.tan((view.fovDeg * Math.PI) / 360);
      const tanH = tanV * a;
      expect(m.widthM / 2 / (m.distance * tanH)).toBeLessThanOrEqual(1);
      expect(m.maxHeightM / 2 / (m.distance * tanV)).toBeLessThan(0.5);
    }
  });
});

describe('the fade-in, the aurora swell and the dip', () => {
  it('the message is hidden until the joining is under way, whole at the end, and never goes backwards', () => {
    expect(messageAlpha(0)).toBe(0);
    expect(messageAlpha(0.4)).toBe(0);
    expect(messageAlpha(1)).toBe(1);
    let prev = 0;
    for (let j = 0; j <= 1.0001; j += 0.02) {
      const a = messageAlpha(j);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(messageAlpha(NaN)).toBe(0);
  });
  it('the aurora is as always at rest and `1 + gain` at the fullest', () => {
    expect(auroraGain(0)).toBe(1);
    expect(auroraGain(1)).toBeCloseTo(1 + AURORA_SWELL_GAIN, 9);
    expect(auroraGain(0.5)).toBeGreaterThan(1);
    expect(auroraGain(0.5)).toBeLessThan(auroraGain(1));
  });
  it('the dip: nothing in normal motion; under reduced motion 0 at the ends, 1 in the middle', () => {
    for (let p = 0; p <= 1.0001; p += 0.05) expect(finaleFade(p, false)).toBe(0);
    expect(finaleFade(0, true)).toBe(0);
    expect(finaleFade(1, true)).toBe(0);
    expect(finaleFade(0.5, true)).toBe(1);
    let max = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) max = Math.max(max, finaleFade(p, true));
    expect(max).toBe(1);
  });
});

describe('the camera', () => {
  const near = (a: number[], b: number[], eps: number): void => a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(eps));
  it.each(ASPECTS)('aspect %f: pull 0 is the sky look and pull 1 is the valley', (a) => {
    const s = skyCamera(a);
    const c0 = finaleCamera(a, 0, false);
    near(c0.eye, s.eye, 1e-6);
    near(c0.look, s.look, 1e-4);
    expect(c0.fovDeg).toBeCloseTo(s.fovDeg, 6);
    const v = valleyCamera(a);
    const c1 = finaleCamera(a, 1, false);
    near(c1.eye, v.eye, 1e-6);
    // same direction (the look point is 20 m out along it)
    const d = (e: number[], l: number[]): number[] => {
      const x = [l[0]! - e[0]!, l[1]! - e[1]!, l[2]! - e[2]!];
      const n = Math.hypot(x[0]!, x[1]!, x[2]!);
      return x.map((q) => q / n);
    };
    near(d(c1.eye, c1.look), d(v.eye, v.look), 1e-3);
    expect(c1.fovDeg).toBeCloseTo(v.fovDeg, 6);
  });
  it('the sky look tips up by the Phase 22 pitch and looks straight ahead', () => {
    const s = skyCamera(0.56);
    const dy = s.look[1] - s.eye[1];
    const dz = s.look[2] - s.eye[2];
    expect((Math.atan2(dy, -dz) * 180) / Math.PI).toBeCloseTo(skyViewFor(0.56).pitchDeg, 6);
    expect(s.look[0] - s.eye[0]).toBeCloseTo(0, 9);
  });
  it('it pulls back and up: the eye never gets lower than the start by more than a metre, ends higher and farther', () => {
    const s = skyCamera(0.56).eye;
    const v = valleyCamera(0.56).eye;
    expect(v[1]).toBeGreaterThan(s[1] + 3);
    expect(v[2]).toBeGreaterThan(s[2] + 10);
    for (let p = 0; p <= 1.0001; p += 0.02) expect(finaleCamera(0.56, p, false).eye[1]).toBeGreaterThan(s[1] - 1);
  });
  it('it is smooth: a step of 1/200 of the pull moves the eye a small part of the whole way and turns the view a small angle', () => {
    let prev = finaleCamera(0.56, 0, false);
    const whole = Math.hypot(...valleyCamera(0.56).eye.map((q, i) => q - skyCamera(0.56).eye[i]!) as [number, number, number]);
    for (let p = 0.005; p <= 1.0001; p += 0.005) {
      const c = finaleCamera(0.56, p, false);
      expect(Math.hypot(c.eye[0] - prev.eye[0], c.eye[1] - prev.eye[1], c.eye[2] - prev.eye[2])).toBeLessThan(whole * 0.03);
      const a = [prev.look[0] - prev.eye[0], prev.look[1] - prev.eye[1], prev.look[2] - prev.eye[2]];
      const b = [c.look[0] - c.eye[0], c.look[1] - c.eye[1], c.look[2] - c.eye[2]];
      const cos = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (Math.hypot(...(a as [number, number, number])) * Math.hypot(...(b as [number, number, number])));
      expect((Math.acos(Math.min(1, cos)) * 180) / Math.PI).toBeLessThan(2);
      prev = c;
    }
  });
  it('reduced motion does not travel: the sky look until the middle, the valley after', () => {
    expect(finaleCamera(0.56, 0.3, true)).toEqual(skyCamera(0.56));
    expect(finaleCamera(0.56, 0.7, true)).toEqual(valleyCamera(0.56));
  });
  it('everything is finite for bad input', () => {
    const c = finaleCamera(NaN, NaN, false);
    expect([...c.eye, ...c.look, c.fovDeg].every(Number.isFinite)).toBe(true);
  });
});

describe('the finale pictures never write a sentence', () => {
  it('no quoted sentence in the new files (words come only from content/)', () => {
    for (const f of ['src/acts/finaleSkyMath.ts', 'src/acts/finaleSky.ts', 'src/acts/finaleView.ts']) {
      const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      // the only multi-word string in the view is the made-up `&long` layout test, which is labelled as such
      const sentences = [...text.matchAll(/'([^'\n]{25,})'/g)].map((m) => m[1]!).filter((s) => /\s\w+\s\w+\s\w+/.test(s));
      const allowed = f.endsWith('finaleView.ts') ? sentences.filter((s) => !s.includes('layout test only')) : sentences;
      expect(allowed.filter((s) => !/^[\w ,.:;'"\-/#%*()=<>{}[\]]*$/.test(s) || /\b(happy|birthday|love|dear|wish)\b/i.test(s))).toEqual([]);
    }
  });
});
