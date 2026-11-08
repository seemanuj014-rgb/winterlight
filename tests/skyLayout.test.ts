import { describe, it, expect } from 'vitest';
import { layoutFor, skyViewFor, screenBox, extentOf, boxesOverlap, moonOnScreen, viewToAzEl, projectPlane, MOUNTAIN_TOP_DEG, MOUNTAIN_MARGIN_DEG } from '../src/constellations/skyLayoutMath';
import { SHAPES, SHAPE_ORDER } from '../src/constellations/shapes';
import names from '../content/names.json';

// Phase 22: every patch is fully on screen, above the mountains, clear of the others, and clear of the moon; the projection maths agrees with itself.
const ASPECTS = [0.46, 0.56, 0.75, 1.0, 1.78];
const defOf = (id: string) => SHAPES[names.constellations.find((c) => c.id === id)!.shape]!;

describe('sky layout', () => {
  for (const a of ASPECTS) {
    describe(`aspect ${a}`, () => {
      const view = skyViewFor(a);
      const L = layoutFor(a);
      it('has a placement for every name, in discovery order', () => {
        expect(Object.keys(L)).toEqual([...SHAPE_ORDER]);
        expect(names.constellations.map((c) => c.id)).toEqual([...SHAPE_ORDER]);
      });
      it('every star (and a little room round it) is on the screen', () => {
        for (const [id, p] of Object.entries(L)) {
          const b = screenBox(view, p, extentOf(defOf(id).nodes), 0.1);
          expect(b.u0, `${id} left`).toBeGreaterThan(-1);
          expect(b.u1, `${id} right`).toBeLessThan(1);
          expect(b.v0, `${id} bottom`).toBeGreaterThan(-1);
          expect(b.v1, `${id} top`).toBeLessThan(1);
        }
      });
      it('every star is above the mountain tops with room to spare', () => {
        for (const [id, p] of Object.entries(L)) {
          const b = screenBox(view, p, extentOf(defOf(id).nodes), 0);
          expect(b.lowestElDeg, id).toBeGreaterThanOrEqual(MOUNTAIN_TOP_DEG + MOUNTAIN_MARGIN_DEG);
        }
      });
      it('no two patches overlap', () => {
        const ids = Object.keys(L);
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            const A = screenBox(view, L[ids[i]!]!, extentOf(defOf(ids[i]!).nodes), 0.05);
            const B = screenBox(view, L[ids[j]!]!, extentOf(defOf(ids[j]!).nodes), 0.05);
            expect(boxesOverlap(A, B), `${ids[i]} / ${ids[j]}`).toBe(false);
          }
      });
      it('no patch sits on the moon', () => {
        const m = moonOnScreen(view);
        for (const [id, p] of Object.entries(L)) {
          const b = screenBox(view, p, extentOf(defOf(id).nodes), 0.05);
          const hit = b.u0 < m.u + m.rU && b.u1 > m.u - m.rU && b.v0 < m.v + m.rV && b.v1 > m.v - m.rV;
          expect(hit, id).toBe(false);
        }
      });
      it('the first patch is lowest and the last highest (low and near to high and grand)', () => {
        const els = SHAPE_ORDER.map((id) => L[id]!.elDeg);
        expect(els[0]).toBe(Math.min(...els));
        expect(els[els.length - 1]).toBe(Math.max(...els));
        expect([...els].sort((x, y) => x - y)).toEqual(els);
      });
    });
  }
  it('viewToAzEl and projectPlane agree: the centre of a patch placed at (u, v) projects back to (u, v)', () => {
    for (const a of ASPECTS) {
      const view = skyViewFor(a);
      for (const [u, v] of [[0, 0], [0.5, 0.3], [-0.7, 0.6], [0.2, -0.4]] as const) {
        const d = viewToAzEl(view, u, v);
        const r = projectPlane(view, { azDeg: d.azDeg, elDeg: d.elDeg, halfAngleDeg: 5 }, 0, 0);
        expect(r.u).toBeCloseTo(u, 6);
        expect(r.v).toBeCloseTo(v, 6);
      }
    }
  });
  it('odd aspects never give NaN', () => {
    for (const a of [NaN, 0, -3, Infinity, 0.2, 5]) {
      const L = layoutFor(a);
      for (const p of Object.values(L)) expect(Number.isFinite(p.azDeg + p.elDeg + p.halfAngleDeg)).toBe(true);
    }
  });
});
