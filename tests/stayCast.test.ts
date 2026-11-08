import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { castSpots, castShows, callsNow, CAST, CAST_WIDE, HOME_DONE } from '../src/acts/stayCastMath';
import { valleyCamera } from '../src/acts/finaleSkyMath';
import { CALL_LIMIT, PART_CALLS } from '../src/acts/stayBudgetMath';
import { terrainHeight } from '../src/world/groundMath';

const src = readFileSync('src/acts/stayCastMath.ts', 'utf8');
const castSrc = readFileSync('src/acts/stayCast.ts', 'utf8');
const viewSrc = readFileSync('src/acts/stayView.ts', 'utf8');

describe('stay a while: the animals of the valley', () => {
  it('stand on the snow, in front of the valley eye, facing it', () => {
    const s = castSpots();
    const eye = valleyCamera(1).eye;
    for (const [p, yaw] of [[s.chamgadad, s.chamgadadYaw], [s.bunny, s.bunnyYaw]] as const) {
      expect(p[1]).toBeCloseTo(terrainHeight(p[0], p[2]), 6);
      const toEye = [eye[0] - p[0], eye[2] - p[2]];
      expect(Math.sin(yaw) * toEye[0] + Math.cos(yaw) * toEye[1]).toBeGreaterThan(0.99 * Math.hypot(toEye[0], toEye[1]));
    }
    expect(Math.hypot(s.chamgadad[0] - eye[0], s.chamgadad[2] - eye[2])).toBeGreaterThan(CAST.chamgadadAhead - 2);
  });
  it('the sky is the picture until the shapes are home, then only while she looks up', () => {
    expect(castShows('wander', 0, 'sky')).toBe(true);
    expect(castShows('wander', 0.99, 'sky')).toBe(true);
    expect(castShows('wander', HOME_DONE, 'sky')).toBe(false);
    expect(castShows('constellations', HOME_DONE, 'sky')).toBe(true);
    expect(castShows('wishes', HOME_DONE, 'sky')).toBe(false);
  });
  it('the animals wait for the shapes to be home, then show only while she looks level', () => {
    for (const id of ['chamgadad', 'bunny'] as const) {
      expect(castShows('wander', 0, id)).toBe(false);
      expect(castShows('wander', HOME_DONE, id)).toBe(true);
      expect(castShows('constellations', HOME_DONE, id)).toBe(false);
    }
  });
  it('the sky and the animals are never drawn together, at any moment', () => {
    for (const a of ['wander', 'constellations', 'wishes', 'pet', 'secrets', '']) for (let h = 0; h <= 1.0001; h += 0.05) {
      const animals = castShows(a, h, 'chamgadad') || castShows(a, h, 'bunny');
      expect(animals && castShows(a, h, 'sky')).toBe(false);
    }
  });
  it('never asks for more than the low limit, and the valley is always drawn', () => {
    for (const a of ['wander', 'constellations', 'wishes']) for (let h = 0; h <= 1.0001; h += 0.05) {
      expect(callsNow(a, h)).toBeLessThanOrEqual(CALL_LIMIT.low);
      expect(callsNow(a, h)).toBeGreaterThanOrEqual(PART_CALLS.backdrop + PART_CALLS.ground + PART_CALLS.cabin);
    }
    expect(callsNow('wander', 1)).toBe(58);
    expect(callsNow('constellations', 1)).toBe(29);
  });
  it('is pure and says nothing; the view puts them in and they cannot block an exit', () => {
    expect(src).not.toMatch(/from 'three'|document\.|window\.|Date\.now|performance\.now|Math\.random/);
    expect(src).not.toMatch(/exit|letter|replay/);
    expect(castSrc).not.toMatch(/exit|letter|replay|addEventListener|document\./);
    expect(viewSrc).toMatch(/createStayCast\(/);
    expect(viewSrc).toMatch(/sky\.setVisible\(/);
  });
  it('the spots follow the screen shape: tall = CAST, wide = CAST_WIDE, farther along the view line as it widens, always on the snow', () => {
    const eye = valleyCamera(1).eye;
    const d = (p: readonly number[]): number => Math.hypot(p[0]! - eye[0], p[2]! - eye[2]);
    const tall = castSpots(0.5);
    const mid = castSpots(1.1);
    const wide = castSpots(2.2);
    expect(d(tall.chamgadad)).toBeLessThan(d(mid.chamgadad));
    expect(d(mid.chamgadad)).toBeLessThan(d(wide.chamgadad));
    expect(d(tall.bunny)).toBeLessThan(d(wide.bunny));
    expect(Math.abs(d(tall.chamgadad) - CAST.chamgadadAhead)).toBeLessThan(1.5);
    expect(Math.abs(d(wide.chamgadad) - CAST_WIDE.chamgadadAhead)).toBeLessThan(1.5);
    for (const a of [0.46, 0.8, 1.2, 1.78, 2.4, NaN]) for (const p of [castSpots(a).chamgadad, castSpots(a).bunny]) expect(p[1]).toBeCloseTo(terrainHeight(p[0], p[2]), 6);
  });
});
