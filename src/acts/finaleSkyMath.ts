// Phase 28: where everything is in the finale's pictures. Pure (no three, no DOM, no clock, no random): numbers in, numbers out, so a frozen frame, a test and the page agree.
//
//   * the five finished shapes lift off their patches (`lift`) and drift into one row across the upper sky (`join`), the crown over the message
//   * the owner's message is one flat panel in the sky under the crown (laid out by `layoutMessage`: wraps at spaces, never cuts a word unless one word is wider than the line,
//     never drops or changes a character, shrinks the type to fit and, at the smallest size, grows taller instead of cutting anything)
//   * the aurora swells (`auroraGain`)
//   * the camera looks up at the sky, then pulls back and up through the pines until the cabin glows in the valley (`finaleCamera`, the existing `finale` shot); reduced motion = no
//     travel: a dip to night and back (`finaleFade`) with the camera cutting while the screen is dark
// The words are the owner's and are only measured and drawn, never written here. Every number is `[A]`.

import { layoutFor, skyViewFor, viewToAzEl, projectPlane, screenBox, extentOf, type SkyPlacement, type SkyView as SkyViewT } from '../constellations/skyLayoutMath';
import { SHAPE_ORDER, SHAPES } from '../constellations/shapes';
import { fovForAspect, makePath, slerpUnit, smootherstep, clamp01, lerp, type V3 } from '../core/directorMath';
import { SHOTS } from '../world/shots';
import { AURORA, fitBackdropView } from '../world/backdropMath';

const D2R = Math.PI / 180;

/** `[A]` how far a shape rises off its patch as it lifts (degrees of elevation), and how much it swells while it lifts */
export const LIFT = { riseDeg: 3, grow: 1.12 } as const;
/** `[A]` each shape sets off a little after the one before it (share of the join), so they cross the sky one after another and not in one clump */
export const JOIN_STAGGER = 0.07;
/** `[A]` the crown: the shapes' plane half-width with their glow (`pad`, the room kept round each shape for its glow, in plane units), the gap kept between neighbouring boxes (screen u units), how much of the half screen width a row may use (`fitU`), the biggest half-size (a fraction of the half view height), and the screen heights of its rows (v, -1 bottom to 1 top): a tall phone gets two rows (3 then 2), a wide screen one */
export const CROWN = { pad: 0.1, gapU: 0.02, fitU: 0.9, sMax: 0.16, sPerAspect: 0.17, oneRowV: 0.66, twoRowV: [0.78, 0.47] as readonly number[], twoRowsBelowAspect: 0.75 } as const;
/** `[A]` the message panel: its centre height on the screen (v), its width as a fraction of the screen width, its tallest height as a fraction of the screen height */
export const MESSAGE = { v: -0.14, widthFrac: 0.84, maxHeightFrac: 0.4, distance: 60 } as const;
/** `[A]` the aurora at its fullest is this many times its normal strength */
export const AURORA_SWELL_GAIN = 1.25;
/** `[A]` the share of the pull-back spent turning from the sky to the valley (the rest follows the shot's own path) */
export const TURN_SHARE = 0.5;

// ---- the shapes --------------------------------------------------------------------------------------------------------------------------

/** the five ids in the order the sky lists them (the crown's left to right) */
export const CROWN_ORDER: readonly string[] = SHAPE_ORDER;

const defOfId = (id: string) => {
  const def = Object.values(SHAPES).find((d) => d.id === id);
  if (!def) throw new Error(`crown: no shape "${id}"`);
  return def;
};

/** the screen box a shape fills when its middle is at (u, v) and its size is `s` (half the view height times s per plane unit): measured by projecting its corners, so the sky's own perspective counts */
function boxAt(view: SkyViewT, id: string, u: number, v: number, s: number): { u0: number; u1: number } {
  const d = viewToAzEl(view, u, v);
  const tanV = Math.tan((view.fovDeg * D2R) / 2);
  const b = screenBox(view, { azDeg: d.azDeg, elDeg: d.elDeg, halfAngleDeg: Math.atan(s * tanV) / D2R }, extentOf(defOfId(id).nodes), CROWN.pad);
  return { u0: b.u0, u1: b.u1 };
}

/** one row's middles (u), spaced so that neighbouring boxes are `gapU` apart, then centred on u = 0; and its half span. Measured, a few passes, because a box's width depends on where it is. */
function layRow(view: SkyViewT, row: readonly string[], v: number, s: number): { us: number[]; half: number } {
  let us: number[] = row.map((_, i) => (i - (row.length - 1) / 2) * 0.2);
  for (let pass = 0; pass < 6; pass++) {
    const next: number[] = [us[0]!];
    for (let i = 1; i < row.length; i++) {
      const prev = boxAt(view, row[i - 1]!, next[i - 1]!, v, s);
      const here = boxAt(view, row[i]!, us[i]!, v, s);
      next.push(next[i - 1]! + (prev.u1 - next[i - 1]!) + CROWN.gapU + (us[i]! - here.u0));
    }
    // centre the row on u = 0 (the boxes are not the same width left and right of the middle)
    const first = boxAt(view, row[0]!, next[0]!, v, s);
    const last = boxAt(view, row[row.length - 1]!, next[next.length - 1]!, v, s);
    const mid = (first.u0 + last.u1) / 2;
    us = next.map((u) => u - mid);
  }
  // the edge reached at the final places (a box is wider nearer the screen's edge)
  let reach = 0;
  row.forEach((id, i) => {
    const b = boxAt(view, id, us[i]!, v, s);
    reach = Math.max(reach, Math.abs(b.u0), Math.abs(b.u1));
  });
  return { us, half: reach };
}

/** the crown: five placements, for a screen shape (one row, or on a tall screen two rows of three and two, each row centred). Spaced by what the shapes really fill on the screen, so the wide ones (the bee) never touch the next. */
export function crownFor(aspect: number): Record<string, SkyPlacement> {
  const view = skyViewFor(aspect);
  const rows: string[][] = view.aspect < CROWN.twoRowsBelowAspect ? [CROWN_ORDER.slice(0, 3) as string[], CROWN_ORDER.slice(3) as string[]] : [CROWN_ORDER.slice() as string[]];
  const vs = rows.length === 2 ? CROWN.twoRowV : [CROWN.oneRowV];
  let s = Math.min(CROWN.sMax, view.aspect * CROWN.sPerAspect);
  let laid = rows.map((r, i) => layRow(view, r, vs[i]!, s));
  for (let k = 0; k < 6; k++) {
    const half = Math.max(...laid.map((l) => l.half));
    if (half <= CROWN.fitU) break;
    s *= (CROWN.fitU / half) * 0.99;
    laid = rows.map((r, i) => layRow(view, r, vs[i]!, s));
  }
  const tanV = Math.tan((view.fovDeg * D2R) / 2);
  const out: Record<string, SkyPlacement> = {};
  rows.forEach((row, r) => {
    row.forEach((id, i) => {
      const d = viewToAzEl(view, laid[r]!.us[i]!, vs[r]!);
      out[id] = { azDeg: d.azDeg, elDeg: d.elDeg, halfAngleDeg: Math.atan(s * tanV) / D2R };
    });
  });
  return out;
}

/** shape `id` at lift `lift` (0..1) and join `join` (0..1): up off its patch first, then across to its place in the crown */
export function finalePlacement(aspect: number, id: string, lift: number, join: number): SkyPlacement {
  const home = layoutFor(aspect)[id];
  const crown = crownFor(aspect)[id];
  if (!home || !crown) throw new Error(`finalePlacement: no shape "${id}"`);
  const l = smootherstep(clamp01(lift));
  const k = Math.max(0, CROWN_ORDER.indexOf(id));
  const span = 1 - (CROWN_ORDER.length - 1) * JOIN_STAGGER;
  const j = smootherstep(clamp01((clamp01(join) - k * JOIN_STAGGER) / span));
  const up: SkyPlacement = { azDeg: home.azDeg, elDeg: home.elDeg + LIFT.riseDeg * l, halfAngleDeg: home.halfAngleDeg * lerp(1, LIFT.grow, l) };
  return {
    azDeg: lerp(up.azDeg, crown.azDeg, j),
    elDeg: lerp(up.elDeg, crown.elDeg, j),
    halfAngleDeg: lerp(up.halfAngleDeg, crown.halfAngleDeg, j),
  };
}

// ---- the message -------------------------------------------------------------------------------------------------------------------------

/** the message panel's place in the sky for a screen shape: the direction of its centre, and its size in sky-plane metres at `MESSAGE.distance` */
export function messageFrame(aspect: number): { azDeg: number; elDeg: number; widthM: number; maxHeightM: number; distance: number } {
  const view = skyViewFor(aspect);
  const tanV = Math.tan((view.fovDeg * D2R) / 2);
  const tanH = tanV * view.aspect;
  const d = viewToAzEl(view, 0, MESSAGE.v);
  const dist = MESSAGE.distance;
  return { azDeg: d.azDeg, elDeg: d.elDeg, widthM: 2 * tanH * dist * MESSAGE.widthFrac, maxHeightM: 2 * tanV * dist * MESSAGE.maxHeightFrac, distance: dist };
}

/** how much of the message shows at join progress `join`: it fades in over the second half of the joining, and is whole at 1 */
export function messageAlpha(join: number): number {
  return smootherstep(clamp01((join - 0.4) / 0.6));
}

export interface MessageLayout {
  /** the lines, in order, as drawn; joined with "\n" they hold every character of the text (spaces at the breaks are dropped, nothing else) */
  lines: string[];
  fontPx: number;
  lineHeightPx: number;
  /** the canvas height the lines need (at least `minHeightPx`, more when the text is long) */
  heightPx: number;
  /** true when even the smallest type did not fit the target height, so the panel grew taller instead */
  grew: boolean;
}

/** split one run of text into grapheme clusters (so a long word is never cut inside a Devanagari conjunct or an emoji); falls back to code points */
export function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(x: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  return Array.from(s);
}

/**
 * Wrap `text` into lines no wider than `maxWidth` by `measure` (a function of the string; the page passes canvas `measureText`). Paragraph breaks ("\n") stay; blank lines stay.
 * Breaks fall at spaces. A word wider than a whole line is split between grapheme clusters. Never changes a word, never drops one.
 */
export function wrapLines(text: string, measure: (s: string) => number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para.trim() === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/ +/).filter((w) => w !== '')) {
      const tryLine = line === '' ? word : `${line} ${word}`;
      if (measure(tryLine) <= maxWidth) {
        line = tryLine;
        continue;
      }
      if (line !== '') out.push(line);
      line = '';
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      // one word wider than the line: pack grapheme clusters
      let piece = '';
      for (const g of graphemes(word)) {
        if (piece !== '' && measure(piece + g) > maxWidth) {
          out.push(piece);
          piece = g;
        } else piece += g;
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

/**
 * Fit the text on a canvas `widthPx` wide: the biggest type from `maxFontPx` down to `minFontPx` whose lines fit `targetHeightPx`. At the smallest type the canvas grows taller instead
 * (`grew`), so no word is ever cut. `measureAt(fontPx)` returns a width function for that size.
 */
export function layoutMessage(
  text: string,
  measureAt: (fontPx: number) => (s: string) => number,
  widthPx: number,
  targetHeightPx: number,
  opts: { maxFontPx?: number; minFontPx?: number; lineHeight?: number; padPx?: number; minHeightPx?: number } = {},
): MessageLayout {
  const maxF = opts.maxFontPx ?? 96;
  const minF = opts.minFontPx ?? 30;
  const lh = opts.lineHeight ?? 1.32;
  const pad = opts.padPx ?? 24;
  const minH = opts.minHeightPx ?? 64;
  const inner = Math.max(1, widthPx - pad * 2);
  let last: MessageLayout | null = null;
  for (let f = maxF; f >= minF; f -= 2) {
    const lines = wrapLines(text, measureAt(f), inner);
    const h = Math.ceil(lines.length * f * lh + pad * 2);
    last = { lines, fontPx: f, lineHeightPx: f * lh, heightPx: Math.max(minH, h), grew: false };
    if (h <= targetHeightPx) return { ...last, heightPx: Math.max(minH, Math.min(h, targetHeightPx)) };
  }
  const l = last!;
  return { ...l, grew: true };
}

// ---- the aurora --------------------------------------------------------------------------------------------------------------------------

/** the aurora's strength multiplier at swell `k` (0..1): 1 at rest, `1 + AURORA_SWELL_GAIN` at the fullest */
export const auroraGain = (k: number): number => 1 + AURORA_SWELL_GAIN * smootherstep(clamp01(k));

// ---- the camera --------------------------------------------------------------------------------------------------------------------------

export interface FinaleCam {
  eye: V3;
  look: V3;
  /** vertical field of view in degrees for THIS screen shape */
  fovDeg: number;
}

const shot = SHOTS.finale;
const eyePath = makePath(shot.eye);
const lookPath = makePath(shot.look);

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** the sky look: the stage eye, tipped up the way `skyViewFor` says, straight ahead (the Phase 22 sky) */
export function skyCamera(aspect: number): FinaleCam {
  const view = skyViewFor(aspect);
  const eye = shot.eye[0] as V3;
  const p = view.pitchDeg * D2R;
  return { eye, look: add(eye, [0, Math.sin(p), -Math.cos(p)], 20), fovDeg: fitBackdropView(aspect).fovDeg };
}

/** the end of the pull-back: the shot's last frame (the cabin small in the valley) */
export function valleyCamera(aspect: number): FinaleCam {
  return { eye: eyePath.at(1) as V3, look: lookPath.at(1) as V3, fovDeg: fovForAspect(shot.fov[1], aspect) };
}

/**
 * The camera at pull-back progress `pull` (0..1). 0 is exactly the sky look; 1 is exactly the valley. Normal motion: up and away along the `finale` shot's own path while the view
 * turns from the sky down to the valley over the first `TURN_SHARE`. Reduced motion: no travel; it is the sky look until the screen is dark (`finaleFade` 1), the valley after.
 */
export function finaleCamera(aspect: number, pull: number, reduced: boolean): FinaleCam {
  const p = clamp01(pull);
  const sky = skyCamera(aspect);
  if (reduced) return p < 0.5 ? sky : valleyCamera(aspect);
  const u = smootherstep(p);
  const eye = eyePath.at(u) as V3;
  const shotLook = lookPath.at(u) as V3;
  const k = smootherstep(clamp01(p / TURN_SHARE));
  const dirSky = unit(sub(sky.look, sky.eye));
  const dirShot = unit(sub(shotLook, eye));
  const dir = slerpUnit(dirSky, dirShot, k);
  return { eye, look: add(eye, dir, 20), fovDeg: lerp(sky.fovDeg, fovForAspect(lerp(shot.fov[0], shot.fov[1], u), aspect), k) };
}

/** how dark the screen is (0..1) at pull-back progress `pull`: nothing in normal motion; under reduced motion a dip to night and back, dark while the camera changes places */
export function finaleFade(pull: number, reduced: boolean): number {
  if (!reduced) return 0;
  const p = clamp01(pull);
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.45) return smootherstep(p / 0.45);
  if (p <= 0.55) return 1;
  return 1 - smootherstep((p - 0.55) / 0.45);
}

// ---- proofs for the tests ----------------------------------------------------------------------------------------------------------------

/** the aurora's strip bounds (so a test can say the swell is in the picture the sky look sees) */
export const AURORA_BAND_DEG = { bottom: AURORA.bottomDeg, top: AURORA.topDeg } as const;

/** a placement's centre on the screen (u, v in -1..1) in the sky view, for tests of "is it on screen" */
export function onScreen(aspect: number, p: SkyPlacement): { u: number; v: number } {
  const r = projectPlane(skyViewFor(aspect), p, 0, 0);
  return { u: r.u, v: r.v };
}
