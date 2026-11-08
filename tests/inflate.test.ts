import { describe, it, expect } from 'vitest';
import {
  signedArea, ensureCCW, resampleClosed, smoothClosed, pointInPolygon, distanceToPolygon, isStarShaped, findCentre,
  inflate, computeNormals, perimeter, type Pt,
} from '../src/character/chamgadad/inflate';

const circle = (n: number, r = 1, cx = 0, cy = 0): Pt[] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as Pt);

/** Every undirected edge must be used by exactly two triangles: a closed surface with no holes and no T-junctions. */
function edgeCounts(indices: ArrayLike<number>): Map<string, number> {
  const m = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]!, b = indices[t + ((k + 1) % 3)]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  }
  return m;
}

describe('outline helpers', () => {
  it('ensureCCW flips a clockwise outline and leaves a CCW one alone', () => {
    const cw = [...circle(8)].reverse();
    expect(signedArea(cw)).toBeLessThan(0);
    expect(signedArea(ensureCCW(cw))).toBeGreaterThan(0);
    const ccw = circle(8);
    expect(ensureCCW(ccw)).toEqual(ccw);
  });
  it('resampleClosed gives n evenly spaced points on the same outline', () => {
    const sq: Pt[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const r = resampleClosed(sq, 16);
    expect(r).toHaveLength(16);
    const gaps = r.map((p, i) => Math.hypot(r[(i + 1) % 16]![0] - p[0], r[(i + 1) % 16]![1] - p[1]));
    for (const g of gaps) expect(Math.abs(g - 1)).toBeLessThan(1e-9);
    for (const [x, y] of r) expect(distanceToPolygon(x, y, sq)).toBeLessThan(1e-9);
  });
  it('Taubin smoothing removes jitter without shrinking the outline', () => {
    const noisy = circle(120).map(([x, y], i) => [x * (1 + (i % 2 ? 0.02 : -0.02)), y * (1 + (i % 2 ? 0.02 : -0.02))] as Pt);
    const s = smoothClosed(noisy, 3);
    expect(Math.abs(signedArea(s) - Math.PI) / Math.PI).toBeLessThan(0.02);
    const spread = (p: readonly Pt[]) => Math.max(...p.map(([x, y]) => Math.hypot(x, y))) - Math.min(...p.map(([x, y]) => Math.hypot(x, y)));
    expect(spread(s)).toBeLessThan(spread(noisy) / 4);
  });
  it('point-in-polygon and distance behave', () => {
    const sq: Pt[] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    expect(pointInPolygon(1, 1, sq)).toBe(true);
    expect(pointInPolygon(3, 1, sq)).toBe(false);
    expect(distanceToPolygon(1, 1, sq)).toBeCloseTo(1, 9);
    expect(distanceToPolygon(3, 1, sq)).toBeCloseTo(1, 9);
    expect(perimeter(sq)).toBeCloseTo(8, 9);
  });
});

describe('star shape', () => {
  it('a circle is star-shaped from its centre, an L is not from the far end of an arm', () => {
    expect(isStarShaped(circle(40), [0, 0])).toBe(true);
    const L: Pt[] = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]];
    expect(isStarShaped(L, [0.5, 0.5])).toBe(true);
    expect(isStarShaped(L, [2.5, 0.5])).toBe(false);
  });
  it('findCentre returns a clear interior point, and refuses a horseshoe', () => {
    const c = findCentre(circle(64, 2, 5, -3));
    expect(Math.hypot(c.centre[0] - 5, c.centre[1] + 3)).toBeLessThan(0.3);
    expect(c.distance).toBeGreaterThan(1.7);
    const horseshoe: Pt[] = [
      ...Array.from({ length: 30 }, (_, i) => { const a = 0.35 + (i / 29) * (2 * Math.PI - 0.7); return [2 * Math.cos(a), 2 * Math.sin(a)] as Pt; }),
      ...Array.from({ length: 30 }, (_, i) => { const a = 2 * Math.PI - 0.35 - (i / 29) * (2 * Math.PI - 0.7); return [1 * Math.cos(a), 1 * Math.sin(a)] as Pt; }),
    ];
    expect(() => findCentre(horseshoe)).toThrow();
  });
});

describe('inflate', () => {
  const m = inflate(circle(200), { samples: 64, rings: 10, thickness: 1, rim: 1, backScale: 1, heightSmooth: 0, outlineSmooth: 0 });
  it('is a closed surface: every edge is shared by exactly two triangles', () => {
    for (const [, n] of edgeCounts(m.indices)) expect(n).toBe(2);
  });
  it('the rim is the outline at z = 0, and nothing is NaN', () => {
    for (let i = 0; i < m.rim.length; i++) {
      expect(m.positions[i * 3]).toBeCloseTo(m.rim[i]![0], 5);
      expect(m.positions[i * 3 + 1]).toBeCloseTo(m.rim[i]![1], 5);
      expect(m.positions[i * 3 + 2]).toBe(0);
    }
    expect(m.positions.every(Number.isFinite)).toBe(true);
  });
  it('a unit circle with thickness 1 and rim 1 is a sphere (within a few percent)', () => {
    for (let v = 0; v < m.positions.length / 3; v++) {
      const r = Math.hypot(m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!);
      expect(Math.abs(r - 1)).toBeLessThan(0.04);
    }
    expect(m.frontZMax).toBeGreaterThan(0.97);
    expect(m.backZMin).toBeLessThan(-0.97);
  });
  it('front triangles all face the viewer in the front view and back triangles face away (no fold-overs)', () => {
    const half = m.indices.length / 2;
    const area = (t: number) => {
      const a = m.indices[t]!, b = m.indices[t + 1]!, c = m.indices[t + 2]!;
      return (m.positions[b * 3]! - m.positions[a * 3]!) * (m.positions[c * 3 + 1]! - m.positions[a * 3 + 1]!) - (m.positions[c * 3]! - m.positions[a * 3]!) * (m.positions[b * 3 + 1]! - m.positions[a * 3 + 1]!);
    };
    for (let t = 0; t < half; t += 3) expect(area(t)).toBeGreaterThan(0);
    for (let t = half; t < m.indices.length; t += 3) expect(area(t)).toBeLessThan(0);
  });
  it('normals point outward on a sphere', () => {
    const n = computeNormals(m.positions, m.indices);
    for (let v = 0; v < m.positions.length / 3; v += 7) {
      const px = m.positions[v * 3]!, py = m.positions[v * 3 + 1]!, pz = m.positions[v * 3 + 2]!;
      const l = Math.hypot(px, py, pz);
      expect((n[v * 3]! * px + n[v * 3 + 1]! * py + n[v * 3 + 2]! * pz) / l).toBeGreaterThan(0.9);
    }
  });
  it('backScale 0 makes a flat back, zOffset moves everything, thickness scales the depth', () => {
    const flat = inflate(circle(100), { samples: 48, rings: 8, backScale: 0, zOffset: 0.5 });
    expect(flat.backZMin).toBeCloseTo(0.5, 6);
    expect(flat.frontZMax).toBeGreaterThan(1.3);
    const thin = inflate(circle(100), { samples: 48, rings: 8, thickness: 0.3 });
    expect(thin.frontZMax).toBeLessThan(0.35);
  });
  it('works on a non-round outline without folding (a bean)', () => {
    const bean: Pt[] = circle(180).map(([x, y]) => [x * 1.4, y * (0.8 + 0.2 * Math.cos(Math.atan2(y, x) * 2))] as Pt);
    const b = inflate(bean, { samples: 96, rings: 12 });
    const half = b.indices.length / 2;
    for (let t = 0; t < half; t += 3) {
      const a = b.indices[t]!, bb = b.indices[t + 1]!, c = b.indices[t + 2]!;
      const ar = (b.positions[bb * 3]! - b.positions[a * 3]!) * (b.positions[c * 3 + 1]! - b.positions[a * 3 + 1]!) - (b.positions[c * 3]! - b.positions[a * 3]!) * (b.positions[bb * 3 + 1]! - b.positions[a * 3 + 1]!);
      expect(ar).toBeGreaterThan(0);
    }
    for (const [, n] of edgeCounts(b.indices)) expect(n).toBe(2);
  });
});
