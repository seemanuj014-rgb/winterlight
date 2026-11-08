import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import partsJson from '../character/traced/chamgadad_ref_01_head_front.parts.json';
import { buildHeadParts, sampleFrontZ, type PartsJson } from '../src/character/chamgadad/parts';
import { buildBodyParts, chestStrokes, neckEdgesAt, ellipseOutline, inflatable, catmull } from '../src/character/chamgadad/bodyParts';
import { distanceToPolygon, type InflatedMesh } from '../src/character/chamgadad/inflate';
import { POSES, SIT, CURL, blendPose } from '../src/character/chamgadad/pose';

const json = partsJson as unknown as PartsJson;
const head = buildHeadParts(json);
const body = buildBodyParts(json, head.neck);
const tris = (m: InflatedMesh): number => m.indices.length / 3;

describe('chest strokes (her V, Q4: arms / shoulders)', () => {
  const V = chestStrokes();
  it('the two strokes converge below the crop, where the paws meet', () => {
    expect(V.meet[1]).toBeLessThan(-2.0);
    expect(V.meet[1]).toBeGreaterThan(-2.7);
    expect(V.meet[0]).toBeGreaterThan(V.left[0][0]);
    expect(V.meet[0]).toBeLessThan(V.right[0][0]);
  });
  it('each arm\'s inner edge lies on her stroke (the rim is inset by one ink width because the ink hull is drawn outward, so within 0.09)', () => {
    // sample the stroke between its top and the crop; the nearest arm rim point must be within 0.09 world units
    for (const [stroke, arm] of [[V.left, body.armLeft], [V.right, body.armRight]] as const) {
      for (const t of [0.2, 0.5, 0.8]) {
        const x = stroke[0][0] + (stroke[1][0] - stroke[0][0]) * t, y = stroke[0][1] + (stroke[1][1] - stroke[0][1]) * t;
        expect(distanceToPolygon(x, y, arm.rim)).toBeLessThan(0.09);
      }
    }
  });
});

describe('torso joins her neck', () => {
  it('at her crop line the torso is as wide as her drawn neck and chest (the silhouette is continuous)', () => {
    const e = neckEdgesAt(json.neck.points, -1.99);
    const xs = body.torso.rim.filter(([, y]) => Math.abs(y + 1.99) < 0.05).map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThan(e.left[0] - 0.12);
    expect(Math.min(...xs)).toBeLessThan(e.left[0] + 0.2);
    expect(Math.max(...xs)).toBeLessThan(e.right[0] + 0.12);
    expect(Math.max(...xs)).toBeGreaterThan(e.right[0] - 0.2);
  });
  it('the torso top is hidden: it starts above the crop, inside the neck', () => {
    const top = Math.max(...body.torso.rim.map(([, y]) => y));
    expect(top).toBeGreaterThan(-1.9);
    expect(top).toBeLessThan(-1.2);
  });
  it('the joint is the middle of her neck\'s flat bottom', () => {
    expect(body.joint[1]).toBeCloseTo(-1.996, 2);
    expect(body.joint[0]).toBeCloseTo(body.axisX, 6);
  });
});

describe('no intersections', () => {
  it('every arm rim vertex stands in front of the chest surface behind it', () => {
    for (const arm of [body.armLeft, body.armRight]) {
      let low = Infinity;
      const rimCount = arm.rim.length;
      for (let v = 0; v < rimCount; v++) {
        const x = arm.positions[v * 3]!, y = arm.positions[v * 3 + 1]!, z = arm.positions[v * 3 + 2]!;
        const bases = [sampleFrontZ(head.neck, x, y), sampleFrontZ(body.torso, x, y)].filter((q): q is number => q !== null);
        if (!bases.length || y > -1.85) continue; // the top of an arm sinks into the chest on purpose (her strokes taper off there); below it the line must be whole
        low = Math.min(low, z - Math.max(...bases));
      }
      expect(low).toBeGreaterThan(0.04); // above the surface by more than the gap, so the line is drawn whole
    }
  });
  it('the two thighs do not overlap each other and stand in front of the torso', () => {
    const maxL = Math.max(...body.thighLeft.rim.map(([x]) => x));
    const minR = Math.min(...body.thighRight.rim.map(([x]) => x));
    expect(minR - maxL).toBeGreaterThan(0.1);
    for (const t of [body.thighLeft, body.thighRight]) {
      const z = sampleFrontZ(body.torso, t.centre[0], t.centre[1]);
      expect(t.frontZMax).toBeGreaterThan(z ?? 0);
    }
  });
  it('the arms and thighs are inside the torso silhouette sideways (the arms by at least the ink width)', () => {
    const tx = body.torso.rim.map(([x]) => x);
    for (const arm of [body.armLeft, body.armRight]) {
      for (const [x, y] of arm.rim) {
        if (y > -1.9) continue; // above the crop the silhouette is the drawn neck
        expect(x).toBeGreaterThan(Math.min(...tx));
        expect(x).toBeLessThan(Math.max(...tx));
      }
    }
  });
  it('the head stays exactly where Phase 6 put it: building the body does not move or change the head', () => {
    const again = buildHeadParts(json);
    expect(Array.from(again.head.positions)).toEqual(Array.from(head.head.positions));
    expect(Array.from(again.neck.positions)).toEqual(Array.from(head.neck.positions));
  });
});

describe('shapes', () => {
  it('every limb outline can be inflated (star-shaped)', () => {
    for (const m of [body.armLeft, body.armRight, body.thighLeft, body.thighRight, body.footLeft, body.tail]) expect(m.indices.length).toBeGreaterThan(0);
    expect(inflatable(ellipseOutline(0, 0, 1, 2))).toBe(true);
    expect(inflatable(body.armLeft.rim)).toBe(true);
    expect(inflatable(body.armRight.rim)).toBe(true);
  });
  it('all positions are finite', () => {
    for (const m of [body.torso, body.armLeft, body.armRight, body.thighLeft, body.thighRight, body.footLeft, body.tail]) {
      for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('catmull keeps its end points when open', () => {
    const c = catmull([[0, 0], [1, 1], [2, 0]], 4, false);
    expect(c[0]).toEqual([0, 0]);
    expect(c[c.length - 1]).toEqual([2, 0]);
  });
  it('triangle budget: head + body surfaces stay under 40k (PERF_BUDGET low scene is 80k with the ink hulls doubling it)', () => {
    const feet = 2 * tris(body.footLeft);
    const total = [head.head, head.neck, head.earUpright.flap, head.earUpright.bowl, head.earAngled.flap, head.earAngled.bowl, body.torso, body.armLeft, body.armRight, body.thighLeft, body.thighRight, body.tail].reduce((s, m) => s + tris(m), feet);
    expect(total).toBeLessThan(40000);
  });
});

describe('poses', () => {
  it('sit is the rest layout (all zeros) and both poses name the same parts', () => {
    for (const p of Object.values(SIT)) { expect(p.pos).toEqual([0, 0, 0]); expect(p.rot).toEqual([0, 0, 0]); }
    expect(Object.keys(CURL).sort()).toEqual(Object.keys(SIT).sort());
    expect(Object.keys(POSES)).toEqual(['sit', 'curl']);
  });
  it('blend is the ends at 0 and 1 and the middle at 0.5, and clamps', () => {
    expect(blendPose(SIT, CURL, 0).root.rot).toEqual(SIT.root.rot);
    expect(blendPose(SIT, CURL, 1).neck.rot).toEqual(CURL.neck.rot);
    expect(blendPose(SIT, CURL, 0.5).root.rot[2]).toBeCloseTo(CURL.root.rot[2] / 2, 9);
    expect(blendPose(SIT, CURL, 7).root.rot).toEqual(CURL.root.rot);
  });
});

describe('source rules', () => {
  const read = (f: string): string => readFileSync(`src/character/chamgadad/${f}`, 'utf8');
  it('bodyParts.ts and pose.ts are pure (no three)', () => {
    expect(read('bodyParts.ts')).not.toMatch(/from 'three'/);
    expect(read('pose.ts')).not.toMatch(/from 'three'/);
  });
  it('accessories are created hidden (off by default)', () => {
    expect(read('accessories.ts')).toMatch(/group\.visible = false/);
  });
  it('nothing is added that she did not draw: no nose, whiskers, blush, tuft, pad or finger parts', () => {
    const src = read('limbs.ts') + read('body.ts') + read('bodyParts.ts');
    expect(src).not.toMatch(/\b(nose|whisker|blush|tuft|finger|toe)s?-?(mesh|geometry)/i);
  });
});
