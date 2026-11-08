import { describe, it, expect } from 'vitest';
import { musicTarget } from '../src/audio/music';
import { STAY_WORLD, clampWalk, walkBy, wanderCamera, CENTRED } from '../src/acts/stayWorldMath';

describe('background music levels', () => {
  it('full when nothing is on, quiet under the letter, off for the finale, lowest reason wins', () => {
    expect(musicTarget([])).toBe(1);
    expect(musicTarget(['wish'])).toBe(1);
    expect(musicTarget(['letter'])).toBeLessThan(1);
    expect(musicTarget(['letter', 'finale'])).toBe(0);
  });
});

describe('free roaming', () => {
  it('stays inside the disc and ignores bad numbers', () => {
    const far = clampWalk({ x: 1000, z: 0 });
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(STAY_WORLD.walkRadiusM, 6);
    expect(clampWalk({ x: NaN, z: 5 })).toMatchObject({ x: 0, z: 5 });
    expect(walkBy({ x: 0, z: 0 }, CENTRED, NaN, NaN)).toMatchObject({ x: 0, z: 0 });
  });
  it('walking forward moves the eye toward where she looks, and walking back undoes it', () => {
    const a = wanderCamera(1, 0, CENTRED, true);
    const w = walkBy({ x: 0, z: 0 }, CENTRED, 5, 0);
    const b = wanderCamera(1, 0, CENTRED, true, w);
    const dx = b.eye[0] - a.eye[0];
    const dz = b.eye[2] - a.eye[2];
    expect(Math.hypot(dx, dz)).toBeCloseTo(5, 5);
    const lx = a.look[0] - a.eye[0];
    const lz = a.look[2] - a.eye[2];
    expect(dx * lx + dz * lz).toBeGreaterThan(0);
    const back = walkBy(w, CENTRED, -5, 0);
    expect(Math.hypot(back.x, back.z)).toBeLessThan(1e-9);
  });
});
