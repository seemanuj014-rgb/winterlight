import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { clampGaze, gazeTowardLocalPoint, newGaze, setGazeTarget, stepGaze, GAZE_TARGETS, GAZE_LIMITS } from '../src/character/chamgadad/gaze';
import { blinkAt, BLINK_TOTAL, Blinker, makeRng, BLINK_RHYTHM } from '../src/character/chamgadad/blink';
import { eyePlacement, patchGrid, patchUv, type FaceJson } from '../src/character/chamgadad/eyePlacement';
import { refToWorld, REF_WORLD_SIZE } from '../src/character/refFrame';

const face = JSON.parse(readFileSync('character/traced/chamgadad_ref_01_head_front.face.json', 'utf8')) as FaceJson;
const feats = JSON.parse(readFileSync('character/traced/chamgadad_ref_01_head_front.features.json', 'utf8')) as { dark_blobs_left_to_right: { full_cx: number; full_cy: number }[] };

describe('gaze', () => {
  it('every named target is inside the eyes\' limits, and the five are distinct', () => {
    const seen = new Set<string>();
    for (const [x, y] of Object.values(GAZE_TARGETS)) {
      expect(Math.hypot(x / GAZE_LIMITS.rx, y / GAZE_LIMITS.ry)).toBeLessThanOrEqual(1 + 1e-9);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(5);
  });
  it('clamps anything outside the ellipse onto its edge, keeps inside points, and survives garbage', () => {
    const [x, y] = clampGaze(10, 10);
    expect(Math.hypot(x / GAZE_LIMITS.rx, y / GAZE_LIMITS.ry)).toBeCloseTo(1, 9);
    expect(clampGaze(0.2, -0.1)).toEqual([0.2, -0.1]);
    expect(clampGaze(NaN, 3)).toEqual([0, 0]);
    expect(clampGaze(Infinity, 0)).toEqual([0, 0]);
  });
  it('a point straight ahead looks straight ahead; one far to the side saturates', () => {
    expect(gazeTowardLocalPoint(0, 0, 5)).toEqual([0, 0]);
    const [x] = gazeTowardLocalPoint(100, 0, 1);
    expect(x).toBeCloseTo(GAZE_LIMITS.rx, 9);
  });
  it('smoothing never overshoots and reaches the target', () => {
    const g = newGaze();
    setGazeTarget(g, 1, 0);
    let prev = 0;
    for (let i = 0; i < 600; i++) {
      stepGaze(g, 1 / 60);
      expect(g.x).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(g.x).toBeLessThanOrEqual(1 + 1e-12);
      prev = g.x;
    }
    expect(g.x).toBeCloseTo(1, 6);
    stepGaze(g, 0);
    stepGaze(g, -1);
    expect(g.x).toBeCloseTo(1, 6);
  });
});

describe('blink', () => {
  it('is open before and after, closed in between, and never outside 0..1', () => {
    expect(blinkAt(-1)).toBe(0);
    expect(blinkAt(0)).toBe(0);
    expect(blinkAt(0.07 + 0.01)).toBe(1);
    expect(blinkAt(BLINK_TOTAL)).toBe(0);
    for (let t = -0.1; t < 0.5; t += 0.003) {
      const v = blinkAt(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('closes faster than it opens', () => {
    expect(BLINK_TOTAL).toBeLessThan(0.4);
    expect(blinkAt(0.035)).toBeGreaterThan(1 - blinkAt(0.07 + 0.05 + 0.07));
  });
  it('the seeded generator replays, and automatic blinks come on a calm rhythm', () => {
    const a = makeRng(3), b = makeRng(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const runs = (seed: number): number[] => {
      const bl = new Blinker(seed);
      const starts: number[] = [];
      let was = 0;
      for (let i = 0; i < 60 * 120; i++) {
        const v = bl.update(1 / 60);
        if (v > 0 && was === 0) starts.push(i / 60);
        was = v;
      }
      return starts;
    };
    const s1 = runs(5);
    expect(s1).toEqual(runs(5));
    expect(s1.length).toBeGreaterThan(15);
    expect(s1.length).toBeLessThan(55);
    const gaps = s1.slice(1).map((t, i) => t - s1[i]!);
    expect(Math.min(...gaps.filter((g) => g > 0.5))).toBeGreaterThanOrEqual(BLINK_RHYTHM.minGap - 0.4);
  });
  it('reduced motion: no automatic blinks, but a manual one still plays', () => {
    const bl = new Blinker(1);
    bl.auto = false;
    for (let i = 0; i < 60 * 60; i++) expect(bl.update(1 / 60)).toBe(0);
    bl.trigger();
    let peak = 0;
    for (let i = 0; i < 60; i++) peak = Math.max(peak, bl.update(1 / 60));
    expect(peak).toBe(1);
  });
});

describe('face data (traced from her drawing)', () => {
  it('has a left and a right eye, each with real layers', () => {
    expect(face.eyes.map((e) => e.side)).toEqual(['left', 'right']);
    for (const e of face.eyes) {
      expect(e.body_px).toBeGreaterThan(8000);
      expect(e.white_px).toBeGreaterThan(800);
      expect(e.tab_px).toBeGreaterThan(300);
      expect(e.brow_px).toBeGreaterThan(300);
    }
  });
  it('the layer images exist', () => {
    for (const s of ['eye_left', 'eye_right', 'brow_left', 'brow_right']) expect(existsSync(`character/traced/chamgadad_ref_01_head_front.${s}.png`)).toBe(true);
  });
  it('each eye sits where Phase 5 measured it (within 0.01, the fidelity spec) and inside the image', () => {
    face.eyes.forEach((e, i) => {
      const f = feats.dark_blobs_left_to_right[i]!;
      expect(Math.hypot(e.body_centroid[0] - f.full_cx, e.body_centroid[1] - f.full_cy)).toBeLessThan(0.01);
      expect(e.crop.cx - e.crop.size / 2).toBeGreaterThanOrEqual(0);
      expect(e.crop.cx + e.crop.size / 2).toBeLessThanOrEqual(1);
      expect(e.crop.cy - e.crop.size / 2).toBeGreaterThanOrEqual(0);
      expect(e.crop.cy + e.crop.size / 2).toBeLessThanOrEqual(1);
      const [x0, y0, x1, y1] = e.body_bbox;
      expect(x0).toBeGreaterThan(e.crop.cx - e.crop.size / 2);
      expect(x1).toBeLessThan(e.crop.cx + e.crop.size / 2);
      expect(y0).toBeGreaterThan(e.crop.cy - e.crop.size / 2);
      expect(y1).toBeLessThan(e.crop.cy + e.crop.size / 2);
    });
  });
  it('the left eye is left of the right eye and neither is a nose, mouth or anything else (only eyes are traced)', () => {
    expect(face.eyes[0]!.crop.cx).toBeLessThan(face.eyes[1]!.crop.cx);
    expect(face.note).toMatch(/No mouth/);
  });
});

describe('eye patch placement', () => {
  it('centres the patch on the eye in the reference frame and sizes it from her pixels', () => {
    const p = eyePlacement(face.eyes[0]!);
    const [wx, wy] = refToWorld(face.eyes[0]!.crop.cx, face.eyes[0]!.crop.cy);
    expect(p.centre).toEqual([wx, wy]);
    expect(p.size).toBeCloseTo((240 / 1080) * REF_WORLD_SIZE, 6);
    expect(patchUv(p, wx, wy)[0]).toBeCloseTo(0.5, 12);
    expect(patchUv(p, wx, wy)[1]).toBeCloseTo(0.5, 12);
    expect(patchUv(p, wx - p.size / 2, wy + p.size / 2)[0]).toBeCloseTo(0, 9);
    expect(patchUv(p, wx - p.size / 2, wy + p.size / 2)[1]).toBeCloseTo(1, 9);
  });
  it('the grid covers the patch once, with a cheap triangle count and valid indices', () => {
    const p = eyePlacement(face.eyes[1]!);
    const g = patchGrid(p, 24);
    expect(g.indices.length / 3).toBe(24 * 24 * 2);
    const verts = 25 * 25;
    expect(Math.max(...g.indices)).toBe(verts - 1);
    expect(Math.min(...g.xy.filter((_, i) => i % 2 === 0))).toBeCloseTo(p.centre[0] - p.size / 2, 6);
    expect(Math.max(...g.xy.filter((_, i) => i % 2 === 1))).toBeCloseTo(p.centre[1] + p.size / 2, 6);
    // two eyes: 2304 triangles, small next to the head's 14k and the 80k low-scene budget
    expect(2 * (g.indices.length / 3)).toBeLessThan(3000);
  });
});

describe('what the face does not have', () => {
  it('has no mouth, nose, whisker, lash or blush code (not in her drawing; the mouth is Q1)', () => {
    const src = ['face.ts', 'eyes.ts', 'shaders/eye.frag'].map((f) => readFileSync(`src/character/chamgadad/${f}`, 'utf8').toLowerCase().replace(/\/\/.*$/gm, '')).join('\n');
    for (const w of ['mouth', 'nose', 'whisker', 'lash', 'blush', 'smile']) expect(src).not.toContain(w);
  });
});
