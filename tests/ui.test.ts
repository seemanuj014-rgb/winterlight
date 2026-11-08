import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { THEME, NOOK_COLOURS, TEXT_PAIRS, WORST_SCENE, parseHex, luminance, contrast, over, checkPair, checkAll, charsPerLine, cardBox } from '../src/ui/themeMath';

// Phase 24 (first half): the contrast maths, the colour table against theme.css, the wish card box on small phones, and the wish card component in a fake DOM-free way
// (the DOM behaviour is checked in a real browser by tools/ui_check.py). No word of the owner's is used or invented here.

const css = readFileSync('src/ui/theme.css', 'utf8');
const cssVar = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`--${name} missing from theme.css`);
  return m[1]!.trim();
};

describe('contrast maths', () => {
  it('black on white is 21 and a colour on itself is 1', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([10, 99, 200], [10, 99, 200])).toBeCloseTo(1, 9);
  });
  it('is symmetric and luminance is monotonic', () => {
    expect(contrast([20, 30, 40], [200, 210, 220])).toBeCloseTo(contrast([200, 210, 220], [20, 30, 40]), 9);
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 9);
    expect(luminance([100, 100, 100])).toBeLessThan(luminance([101, 100, 100]));
  });
  it('matches a published WCAG value (#767676 on white is 4.54)', () => {
    expect(contrast(parseHex('#767676'), [255, 255, 255])).toBeCloseTo(4.54, 2);
  });
  it('parseHex refuses anything but #rrggbb', () => {
    expect(() => parseHex('red')).toThrow();
    expect(() => parseHex('#fff')).toThrow();
    expect(parseHex('#0d1b2e')).toEqual([13, 27, 46]);
  });
  it('over() mixes, clamps alpha and survives NaN', () => {
    expect(over([0, 0, 0], 0.5, [200, 100, 50])).toEqual([100, 50, 25]);
    expect(over([0, 0, 0], 2, [200, 100, 50])).toEqual([0, 0, 0]);
    expect(over([0, 0, 0], -1, [200, 100, 50])).toEqual([200, 100, 50]);
    expect(over([0, 0, 0], NaN, [200, 100, 50])).toEqual([0, 0, 0]);
  });
});

describe('every text style passes its contrast minimum', () => {
  const results = checkAll();
  for (const r of results) {
    it(`${r.id}: ${r.ratio} (needs ${r.min}) against ${r.worstAgainst}`, () => {
      expect(r.pass).toBe(true);
    });
  }
  it('a see-through card is judged against the brightest scene colours, not only its own colour', () => {
    const wish = TEXT_PAIRS.find((p) => p.id === 'wish-card')!;
    expect(wish.worst.length).toBeGreaterThanOrEqual(3);
    const solid = contrast(parseHex(wish.fg), parseHex(wish.bg));
    expect(checkPair(wish).ratio).toBeLessThan(solid);
  });
  it('the checker can fail (a pale grey on white is refused)', () => {
    expect(checkPair({ id: 'x', fg: '#cccccc', bg: '#ffffff', bgAlpha: 1, worst: [], minRatio: 4.5, note: '' }).pass).toBe(false);
  });
  it('writes the numbers for the log (docs/phase24/contrast.json)', () => {
    mkdirSync('docs/phase24', { recursive: true });
    writeFileSync('docs/phase24/contrast.json', JSON.stringify({ worstScene: WORST_SCENE, results: checkAll().map((r) => ({ ...r })) }, null, 2) + '\n');
    expect(results.every((r) => r.pass)).toBe(true);
  });
});

describe('theme.css and themeMath.ts agree', () => {
  it('the colour variables equal the TypeScript table', () => {
    expect(cssVar('wl-night').toLowerCase()).toBe(THEME.night);
    expect(cssVar('wl-night-mid').toLowerCase()).toBe(THEME.nightMid);
    expect(cssVar('wl-card-bg').toLowerCase()).toBe(THEME.cardBg);
    expect(cssVar('wl-card-text').toLowerCase()).toBe(THEME.cardText);
    expect(cssVar('wl-card-edge').toLowerCase()).toBe(THEME.cardEdge);
    expect(cssVar('wl-label').toLowerCase()).toBe(THEME.label);
    expect(cssVar('wl-hint').toLowerCase()).toBe(THEME.hint);
    expect(cssVar('wl-focus').toLowerCase()).toBe(THEME.focus);
    expect(Number(cssVar('wl-card-alpha'))).toBe(THEME.cardAlpha);
    expect(cssVar('wl-letter-bg').toLowerCase()).toBe(THEME.letterBg);
    expect(Number(cssVar('wl-letter-alpha'))).toBe(THEME.letterAlpha);
    expect(cssVar('wl-button-fg').toLowerCase()).toBe(THEME.buttonFg);
    expect(cssVar('wl-button-bg').toLowerCase()).toBe(THEME.buttonBg);
    expect(Number(cssVar('wl-button-alpha'))).toBe(THEME.buttonAlpha);
  });
  it('the card surface in the CSS uses the same opacity as the contrast check', () => {
    expect(css).toMatch(/color-mix\(in srgb, var\(--wl-card-bg\) 90%, transparent\)/);
  });
  it('has a reduced-motion variant and removes the fades', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.wl-reduced \.wl-card/);
  });
  it('takes the safe areas off the card and has a short-screen rule', () => {
    expect(css).toContain('var(--wl-safe-top)');
    expect(css).toContain('var(--wl-safe-bottom)');
    expect(css).toMatch(/max-height: calc\(100dvh/);
    expect(css).toMatch(/@media \(max-height: 420px\)/);
  });
  it('lists a Devanagari fallback in both font stacks and loads no remote font', () => {
    expect(cssVar('wl-font-serif')).toMatch(/Devanagari/);
    expect(cssVar('wl-font-ui')).toMatch(/Devanagari/);
    expect(css).not.toMatch(/@import|url\(|https?:/);
  });
  it('contains no sentence of its own (words come from content/)', () => {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text).not.toMatch(/content\s*:\s*["'][^"']+["']/);
  });
});

describe('the wish card box on small phones', () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  it('fits 360x640, 390x780 and a sideways phone with safe areas off', () => {
    for (const [w, h, safe] of [
      [360, 640, none],
      [390, 780, { top: 47, right: 0, bottom: 34, left: 0 }],
      [844, 390, { top: 0, right: 47, bottom: 21, left: 47 }],
      [1280, 720, none],
    ] as const) {
      const b = cardBox(w, h, safe);
      expect(b.maxWidthPx).toBeGreaterThan(0);
      expect(b.maxWidthPx).toBeLessThanOrEqual(w - safe.left - safe.right);
      expect(b.maxWidthPx).toBeLessThanOrEqual(416);
      expect(b.maxHeightPx).toBeLessThanOrEqual(h - safe.top - safe.bottom);
      expect(b.fontPx).toBeGreaterThanOrEqual(17);
      expect(b.fontPx).toBeLessThanOrEqual(21);
    }
  });
  it('lines stay a comfortable length: 20 to 45 characters on a phone', () => {
    for (const w of [360, 390]) {
      const b = cardBox(w, 700, none);
      const cpl = charsPerLine(b.maxWidthPx - 44, b.fontPx);
      expect(cpl).toBeGreaterThanOrEqual(20);
      expect(cpl).toBeLessThanOrEqual(45);
    }
  });
  it('degenerate input never throws or goes negative', () => {
    const b = cardBox(0, 0, { top: 50, right: 50, bottom: 50, left: 50 });
    expect(b.maxWidthPx).toBe(0);
    expect(b.maxHeightPx).toBe(0);
    expect(charsPerLine(-1, 16)).toBe(0);
    expect(charsPerLine(300, 0)).toBe(0);
  });
});

describe('purity and ownership', () => {
  it('themeMath.ts has no DOM, three, clock or random', () => {
    const src = readFileSync('src/ui/themeMath.ts', 'utf8');
    expect(src).not.toMatch(/from 'three'|document\.|window\.|Math\.random|Date\.now|performance\.now/);
  });
  it('wishCard.ts sets text only from its caller (no sentence of its own)', () => {
    const src = readFileSync('src/ui/wishCard.ts', 'utf8').replace(/\/\/.*$/gm, '');
    const strings = [...src.matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]!);
    for (const s of strings) expect(s).not.toMatch(/^[A-Z][a-z]+( [a-z]+){2,}/); // no English sentence literal
  });
  it('skyText.ts passes the wish text through untouched', () => {
    const src = readFileSync('src/ui/skyText.ts', 'utf8');
    expect(src).toContain("card.show(id, o.wishes[id] ?? '')");
    expect(src).not.toMatch(/\.trim\(\)|\.replace\(/);
  });
});

describe('letter reader, sound button and hint (second quarter)', () => {
  const reader = readFileSync('src/ui/letterReader.ts', 'utf8');
  it('the letter is set with textContent only, never trimmed, replaced or parsed', () => {
    expect(reader).toContain('column.textContent = o.text');
    const code = reader.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.trim\(|\.replace\(|innerHTML\s*=\s*o\.|marked|markdown/);
    expect(css).toMatch(/\.wl-letter-text[\s\S]*white-space: pre-wrap/);
  });
  it('the letter column is about 30 to 45 characters a line on 360 and 390 px phones', () => {
    for (const w of [360, 390]) {
      const font = Math.max(18, Math.min(20, w * 0.049));
      const cpl = charsPerLine(w - 2 * 1.4 * 16, font);
      expect(cpl).toBeGreaterThanOrEqual(28);
      expect(cpl).toBeLessThanOrEqual(45);
    }
  });
  it('the panel has a real close button with a caller-supplied name, a dialog role and Escape', () => {
    expect(reader).toContain("setAttribute('aria-label', o.closeLabel)");
    expect(reader).toContain("'role', 'dialog'");
    expect(reader).toContain("e.key === 'Escape'");
    expect(reader).toContain("type = 'button'");
  });
  it('the close button and the sound button are at least 44 px', () => {
    expect(css).toMatch(/\.wl-letter-close \{[^}]*width: 44px; height: 44px/);
    expect(css).toMatch(/\.mute-button \{[^}]*width: 44px; height: 44px/);
  });
  it('the sound button has no inline look any more and the hint reads the theme variables', () => {
    const mute = readFileSync('src/audio/muteButton.ts', 'utf8');
    expect(mute).not.toMatch(/style\.cssText/);
    expect(mute).toContain("'mute-button'");
    const hud = readFileSync('src/acts/hud.ts', 'utf8');
    expect(hud).toContain('var(--wl-hint');
    expect(hud).toContain('var(--wl-safe-bottom');
  });
  it('letter, close and hint pairs are in the contrast table', () => {
    const ids = TEXT_PAIRS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['letter-text', 'letter-close-glyph', 'hint-on-night']));
  });
  it('the letter view is opt-in and its test text comes from the URL, not from the source', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toContain("params.has('letter')");
    const view = readFileSync('src/acts/letterView.ts', 'utf8');
    expect(view).toContain("params.get('text')");
  });
});

describe('Phase 24 close-out: replay controls, tab order, ARIA, hint backing', () => {
  const replay = readFileSync('src/ui/replayControls.ts', 'utf8');
  const mute = readFileSync('src/audio/muteButton.ts', 'utf8');
  const hud = readFileSync('src/acts/hud.ts', 'utf8');
  const css2 = readFileSync('src/ui/theme.css', 'utf8');
  it('the nook colours in the contrast table are the colours in the nook source', () => {
    const src = readFileSync('src/world/cabinMath.ts', 'utf8');
    const hex = (k: string): string => {
      const m = new RegExp(`\\b${k}: 0x([0-9a-f]{6})`).exec(src);
      return '#' + (m ? m[1] : 'missing');
    };
    expect(hex('floor')).toBe(NOOK_COLOURS.floor);
    expect(hex('wall')).toBe(NOOK_COLOURS.wall);
    expect(hex('rug')).toBe(NOOK_COLOURS.rug);
    expect(hex('rugRing')).toBe(NOOK_COLOURS.rugRing);
    expect(hex('blanket')).toBe(NOOK_COLOURS.blanket);
    expect(hex('pillow')).toBe(NOOK_COLOURS.pillow);
    expect(readFileSync('src/tourView.ts', 'utf8')).toContain('0x1a1512');
  });
  it('the hint passes 4.5 over every nook colour on its backing, and would fail without it', () => {
    const r = checkAll().find((x) => x.id === 'hint-on-nook')!;
    expect(r.pass).toBe(true);
    expect(contrast(parseHex(THEME.hint), parseHex(NOOK_COLOURS.pillow))).toBeLessThan(4.5); // bare hint on the pillow: why the backing exists
  });
  it('the hud backing is the table\'s scrim', () => {
    expect(hud).toContain('background:rgba(8,6,4,.62)');
    expect(THEME.hintScrimAlpha).toBe(0.62);
  });
  it('replay controls: two kinds, plain labels, real buttons, hidden means out of the tab order', () => {
    expect(replay).toContain("type = 'button'");
    expect(replay).toContain("'Play the music box tune again'");
    expect(replay).toContain("'Show the wishes again'");
    expect(replay).toContain('b.hidden = ');
    expect(css2).toMatch(/\.wl-replay-btn \{[^}]*width: 44px; height: 44px/);
    expect(css2).toContain('.wl-replay-btn[hidden]');
  });
  it('replay controls have no word of the owner\'s and import no audio, three or constellations', () => {
    expect(replay).not.toMatch(/from '\.\.\/(audio|constellations|world|character)/);
    expect(replay).not.toMatch(/from 'three'/);
  });
  it('the sound button goes first in the tab order (prepended), the replay bar right after it', () => {
    expect(mute).toContain('parent.prepend(b)');
    expect(replay).toContain("mute.after(bar)");
  });
  it('the wish card names itself from the constellation, and the sky text has no second live region', () => {
    expect(readFileSync('src/ui/wishCard.ts', 'utf8')).toContain("card.setAttribute('aria-label', name)");
    expect(readFileSync('src/ui/skyText.ts', 'utf8')).not.toContain('aria-live');
  });
  it('reduced motion turns off every UI fade, buttons included', () => {
    expect(css2).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*\.wl-replay-btn[^}]*\.mute-button[^}]*\.wl-hud p/);
  });
});
