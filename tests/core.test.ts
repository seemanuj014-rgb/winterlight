import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickInitialTier, settingsFor } from '../src/core/quality';
import { validateSilhouette, boundsOf, type Silhouette } from '../src/core/silhouette';

describe('quality', () => {
  it('drops to low for reduced motion and weak devices', () => {
    expect(pickInitialTier(8, 8, true)).toBe('low');
    expect(pickInitialTier(4, 4, false)).toBe('low');
    expect(pickInitialTier(8, 8, false)).toBe('high');
    expect(settingsFor('low').postprocessing).toBe(false);
  });
});

describe('character data', () => {
  const sil = JSON.parse(readFileSync('character/traced/chamgadad_ref_01_head_front.silhouette.json', 'utf8')) as Silhouette;
  it('traced silhouette is valid', () => {
    expect(validateSilhouette(sil)).toEqual([]);
  });
  it('knows the drawing is cropped, so the body is not measured', () => {
    expect(sil.cropped_at_bottom).toBe(true);
    expect(boundsOf(sil).maxY).toBeGreaterThan(0.95);
  });
  it('palette has the colors the bible names', () => {
    const p = JSON.parse(readFileSync('character/palette.json', 'utf8')) as { colors: Record<string, string> };
    for (const k of ['body_base', 'ear_inner_lavender', 'eye_black', 'outline_ink']) expect(p.colors[k]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('content skeleton', () => {
  const names = JSON.parse(readFileSync('content/names.json', 'utf8')) as { constellations: { id: string }[] };
  const wishes = JSON.parse(readFileSync('content/wishes.json', 'utf8')) as Record<string, string>;
  it('has five constellations and a wish slot for each', () => {
    expect(names.constellations).toHaveLength(5);
    for (const c of names.constellations) expect(Object.keys(wishes)).toContain(c.id);
  });
  it('letter file exists and still carries the owner placeholder', () => {
    expect(readFileSync('content/letter.md', 'utf8')).toContain('TODO_OWNER');
  });
});
