import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateSilhouette, boundsOf, type Silhouette } from '../src/core/silhouette';
import { FIDELITY_REGIONS, EYE_CENTRE_TOLERANCE, rasterizePolygon, maskIoU } from '../src/character/chamgadad/fidelity';

const j = <T,>(f: string) => JSON.parse(readFileSync(f, 'utf8')) as T;
const sil = j<Silhouette>('character/traced/chamgadad_ref_01_head_front.silhouette.json');
interface Eye { cx: number; cy: number; rx: number; ry: number; full_cx: number; full_cy: number; full_rx: number; full_ry: number }
const eyes = j<{ dark_blobs_left_to_right: Eye[] }>('character/traced/chamgadad_ref_01_head_front.features.json').dark_blobs_left_to_right;
const palette = j<{ colors: Record<string, string> }>('character/palette.json').colors;
const fid = j<any>('character/fidelity.json');
const bible = readFileSync('CHARACTER_BIBLE.md', 'utf8');

describe('traced silhouette (ref_01)', () => {
  it('is valid, closed-ish, and knows it is cropped', () => {
    expect(validateSilhouette(sil)).toEqual([]);
    expect(sil.cropped_at_bottom).toBe(true);
    expect(sil.point_count).toBe(147);
    const b = boundsOf(sil);
    expect(b.minY).toBeGreaterThan(0.15);
    expect(b.maxY).toBeGreaterThan(0.99);
  });
});

describe('eyes (ref_01)', () => {
  it('finds two eyes, left to right', () => {
    expect(eyes).toHaveLength(2);
    expect(eyes[0]!.cx).toBeLessThan(eyes[1]!.cx);
  });
  it('the full eye (with highlight and tab) is at least as big as the dark blob and contains its centre', () => {
    for (const e of eyes) {
      expect(e.full_rx).toBeGreaterThanOrEqual(e.rx - 1e-6);
      expect(e.full_ry).toBeGreaterThanOrEqual(e.ry - 1e-6);
      expect(Math.abs(e.cx - e.full_cx)).toBeLessThan(e.full_rx);
      expect(Math.abs(e.cy - e.full_cy)).toBeLessThan(e.full_ry);
    }
  });
  it('the full eye centre sits up and to the left of the dark centre (the highlight is on the viewer-left)', () => {
    for (const e of eyes) {
      expect(e.full_cx).toBeLessThan(e.cx);
      expect(e.full_cy).toBeLessThanOrEqual(e.cy);
    }
  });
  it('eye sizes and positions agree with the numbers written in CHARACTER_BIBLE.md', () => {
    expect(bible).toContain('(0.463, 0.511)');
    expect(bible).toContain('(0.620, 0.548)');
    expect(bible).toContain('(0.451, 0.506)');
    expect(bible).toContain('(0.607, 0.543)');
  });
});

describe('palette', () => {
  it('every colour is a hex and appears in the bible table', () => {
    for (const [k, v] of Object.entries(palette)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/);
      if (k !== 'ear_right_pale_blue') expect(bible).toContain(v);
    }
  });
  it('the ink is near black and the eye black is near black', () => {
    for (const k of ['outline_ink', 'eye_black']) {
      const v = palette[k]!;
      for (let i = 1; i < 7; i += 2) expect(parseInt(v.slice(i, i + 2), 16)).toBeLessThan(16);
    }
  });
});

describe('fidelity target', () => {
  it('fidelity.json and fidelity.ts agree', () => {
    expect(fid.regions.head_and_ears.y_max).toBe(FIDELITY_REGIONS.headAndEars.yMax);
    expect(fid.regions.head_and_ears.iou_min).toBe(FIDELITY_REGIONS.headAndEars.iouMin);
    expect(fid.regions.neck_and_chest.y_min).toBe(FIDELITY_REGIONS.neckAndChest.yMin);
    expect(fid.regions.neck_and_chest.iou_min).toBe(FIDELITY_REGIONS.neckAndChest.iouMin);
    expect(fid.eye_centre_tolerance.value).toBe(EYE_CENTRE_TOLERANCE);
  });
  it('head and ears target is the 0.97 the phase asks for, and the regions tile the figure', () => {
    expect(FIDELITY_REGIONS.headAndEars.iouMin).toBeGreaterThanOrEqual(0.97);
    expect(FIDELITY_REGIONS.headAndEars.yMax).toBe(FIDELITY_REGIONS.neckAndChest.yMin);
  });
  it('records the head-volume method', () => {
    expect(fid.head_volume_method.decision).toBe('inflation');
    expect(bible).toContain('Head-volume method');
  });
  it('the questions for the owner are in the bible', () => {
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']) expect(bible).toContain(`**${q}.`);
  });
});

describe('IoU maths', () => {
  const square = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]] as const;
  const S = 128;
  it('rasterises a square to about a quarter of the image', () => {
    const m = rasterizePolygon(square, S);
    const area = m.reduce((a, b) => a + b, 0) / (S * S);
    expect(Math.abs(area - 0.25)).toBeLessThan(0.01);
  });
  it('identical masks give 1, disjoint give 0, a half-shifted square gives 1/3', () => {
    const a = rasterizePolygon(square, S);
    expect(maskIoU(a, a, S)).toBe(1);
    const far = rasterizePolygon([[0.8, 0.8], [0.95, 0.8], [0.95, 0.95], [0.8, 0.95]], S);
    expect(maskIoU(a, far, S)).toBe(0);
    const shifted = rasterizePolygon(square.map(([x, y]) => [x + 0.25, y] as [number, number]), S);
    expect(Math.abs(maskIoU(a, shifted, S) - 1 / 3)).toBeLessThan(0.02);
  });
  it('a region limits the comparison to its rows', () => {
    const a = rasterizePolygon(square, S);
    const top = rasterizePolygon([[0.25, 0.25], [0.75, 0.25], [0.75, 0.5], [0.25, 0.5]], S);
    expect(maskIoU(a, top, S, { yMin: 0, yMax: 0.5 })).toBe(1);
    expect(maskIoU(a, top, S)).toBeCloseTo(0.5, 1);
  });
  it('the traced silhouette against itself is 1 in both regions, and against a shifted copy is below target', () => {
    const a = rasterizePolygon(sil.points as [number, number][], 256);
    expect(maskIoU(a, a, 256, FIDELITY_REGIONS.headAndEars)).toBe(1);
    expect(maskIoU(a, a, 256, FIDELITY_REGIONS.neckAndChest)).toBe(1);
    const moved = rasterizePolygon((sil.points as [number, number][]).map(([x, y]) => [x + 0.03, y] as [number, number]), 256);
    expect(maskIoU(a, moved, 256, FIDELITY_REGIONS.headAndEars)).toBeLessThan(FIDELITY_REGIONS.headAndEars.iouMin);
  });
  it('the traced figure fills a believable share of the frame', () => {
    const a = rasterizePolygon(sil.points as [number, number][], 256);
    const share = a.reduce((x, y) => x + y, 0) / (256 * 256);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.5);
  });
});
