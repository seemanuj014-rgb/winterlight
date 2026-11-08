// Phase 24: the colours and sizes of every piece of text, as DATA, plus the contrast maths that checks them. Pure: no DOM, no three, no clock.
// theme.css holds the same numbers as CSS variables; tests/ui.test.ts reads theme.css and fails if the two drift apart.
// Every number is `[A]` (mine), tuned against AD's palette; the owner's eyes decide.

export type Rgb = readonly [number, number, number];

/** one text style that sits on one surface (a card, or straight on the scene) */
export interface TextPair {
  readonly id: string;
  readonly fg: string; // text colour, #rrggbb
  readonly bg: string; // the surface behind it, #rrggbb
  readonly bgAlpha: number; // 1 = solid card; < 1 = the scene shows through, checked against `worst`
  readonly worst: readonly string[]; // scene colours that may sit behind a see-through surface
  readonly minRatio: number; // WCAG: 4.5 body text, 3 large text (>= 24px, or >= 18.66px bold) and UI glyphs
  readonly note: string;
}

export const THEME = {
  night: '#0d1b2e', // AD deep sky
  nightMid: '#1c3556', // AD mid sky
  cardBg: '#0e1a2c',
  cardAlpha: 0.9,
  cardText: '#f4fbff',
  cardEdge: '#9cc8ff', // the frost-line blue of the constellations
  label: '#e6f2ff', // constellation names, straight on the sky
  hint: '#f1e6d2', // the acts' hint and line, straight on the scene
  buttonFg: '#cfe3f2',
  buttonBg: '#0d1b2e',
  buttonAlpha: 0.72,
  focus: '#ffe2aa',
  hintScrim: '#080604', // the soft backing behind the hint and the owner's line (hud.ts uses rgba(8,6,4,.62))
  hintScrimAlpha: 0.62,
  letterBg: '#0a1424',
  letterAlpha: 0.94,
  snowLit: '#e8f1f8',
  horizonGlow: '#6f86b8',
  mountainFar: '#5a7196',
} as const;

/** what we put behind a see-through surface when we ask "is it still readable?" (the brightest things in the scene) */
/** the colours the hint can land on in the nook (src/world/cabinMath.ts COL, plus the void round the room in tourView.ts); tests/ui.test.ts checks they match the source */
export const NOOK_COLOURS = { void: '#1a1512', floor: '#4a382e', wall: '#65504a', rug: '#5d7480', rugRing: '#7a909b', blanket: '#8d86b0', pillow: '#e8f1f8' } as const;

export const WORST_SCENE = [THEME.snowLit, THEME.horizonGlow, THEME.mountainFar] as const;

export const TEXT_PAIRS: readonly TextPair[] = [
  { id: 'wish-card', fg: THEME.cardText, bg: THEME.cardBg, bgAlpha: THEME.cardAlpha, worst: WORST_SCENE, minRatio: 4.5, note: 'wish text on the night card, card over the brightest scene colours' },
  { id: 'wish-card-edge', fg: THEME.cardEdge, bg: THEME.cardBg, bgAlpha: THEME.cardAlpha, worst: WORST_SCENE, minRatio: 3, note: 'the card border against its own surface (a non-text boundary, WCAG 1.4.11)' },
  { id: 'button-glyph', fg: THEME.buttonFg, bg: THEME.buttonBg, bgAlpha: THEME.buttonAlpha, worst: WORST_SCENE, minRatio: 3, note: 'the sound button glyph over a see-through disc (UI glyph, WCAG 1.4.11)' },
  { id: 'letter-text', fg: THEME.cardText, bg: THEME.letterBg, bgAlpha: THEME.letterAlpha, worst: WORST_SCENE, minRatio: 4.5, note: 'the letter on its full-screen panel, panel over the brightest scene colours' },
  { id: 'letter-close-glyph', fg: THEME.buttonFg, bg: THEME.letterBg, bgAlpha: 1, worst: [], minRatio: 3, note: 'the close glyph on the letter panel (UI glyph)' },
  { id: 'label-on-sky', fg: THEME.label, bg: THEME.night, bgAlpha: 1, worst: [], minRatio: 4.5, note: 'constellation names sit on the sky, above the mountains' },
  { id: 'hint-on-nook', fg: THEME.hint, bg: THEME.hintScrim, bgAlpha: THEME.hintScrimAlpha, worst: Object.values(NOOK_COLOURS), minRatio: 4.5, note: 'the hint and the owner\'s line on their soft backing, over every colour of the nook (the pale pillow is the worst case)' },
  { id: 'replay-glyph', fg: THEME.buttonFg, bg: THEME.buttonBg, bgAlpha: THEME.buttonAlpha, worst: WORST_SCENE, minRatio: 3, note: 'the two replay button glyphs (same disc as the sound button)' },
  { id: 'hint-on-night', fg: THEME.hint, bg: THEME.night, bgAlpha: 1, worst: [], minRatio: 4.5, note: 'the quiet hint on the dark nook / night scene (fades, so checked at full strength)' },
];

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of an sRGB colour (0..255 per channel) */
export function luminance(c: Rgb): number {
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio, 1..21 */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` laid over `under` at the given opacity (straight sRGB mix, as a browser does) */
export function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  return [0, 1, 2].map((i) => Math.round(top[i]! * a + under[i]! * (1 - a))) as unknown as Rgb;
}

export interface ContrastResult {
  readonly id: string;
  readonly ratio: number; // the WORST case over the scene colours (or the plain pair when solid)
  readonly worstAgainst: string;
  readonly min: number;
  readonly pass: boolean;
}

export function checkPair(p: TextPair): ContrastResult {
  const fg = parseHex(p.fg);
  const bg = parseHex(p.bg);
  const unders = p.bgAlpha >= 1 || p.worst.length === 0 ? [p.bg] : p.worst;
  let worst = Infinity;
  let against = p.bg;
  for (const u of unders) {
    const surface = p.bgAlpha >= 1 ? bg : over(bg, p.bgAlpha, parseHex(u));
    const r = contrast(fg, surface);
    if (r < worst) {
      worst = r;
      against = u;
    }
  }
  const ratio = Math.round(worst * 100) / 100;
  return { id: p.id, ratio, worstAgainst: against, min: p.minRatio, pass: ratio >= p.minRatio };
}

export function checkAll(pairs: readonly TextPair[] = TEXT_PAIRS): ContrastResult[] {
  return pairs.map(checkPair);
}

/** A line of text is comfortable to read at about 30 to 45 characters on a phone. Returns the characters per line at a given width. */
export function charsPerLine(widthPx: number, fontPx: number): number {
  if (!(widthPx > 0) || !(fontPx > 0)) return 0;
  return Math.floor(widthPx / (fontPx * 0.5)); // an average serif glyph is about half an em wide
}

export interface CardBox {
  readonly maxWidthPx: number;
  readonly fontPx: number;
  readonly maxHeightPx: number;
}

/** The wish card's box for a viewport, safe areas taken off. Mirrors the CSS (min(86vw, 26rem), clamp font, max-height) so a test can prove it fits. */
export function cardBox(vw: number, vh: number, safe: { top: number; right: number; bottom: number; left: number }): CardBox {
  const usableW = Math.max(0, vw - safe.left - safe.right);
  const usableH = Math.max(0, vh - safe.top - safe.bottom);
  const maxWidthPx = Math.min(usableW * 0.86, 26 * 16);
  const fontPx = Math.max(17, Math.min(21, vw * 0.048)); // clamp(17px, 4.8vw, 21px)
  const maxHeightPx = Math.max(0, usableH - 32);
  return { maxWidthPx: Math.round(maxWidthPx), fontPx: Math.round(fontPx * 10) / 10, maxHeightPx: Math.round(maxHeightPx) };
}
