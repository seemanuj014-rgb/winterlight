import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { STAY_WORLD, CENTRED, clampPan, panFromDrag, panFromKey, activityForPan, wanderCamera, homeProgress, homePlacement } from '../src/acts/stayWorldMath';
import { valleyCamera, finalePlacement, CROWN_ORDER } from '../src/acts/finaleSkyMath';
import { layoutFor } from '../src/constellations/skyLayoutMath';
import { createStayWorld } from '../src/acts/stayWorld';
import { createStayAwhileAct } from '../src/acts/stayAwhile';
import { createBus, type WinterEvents } from '../src/state/events';

// Phase 28 (fourth quarter): the look of stay a while, as numbers, and its glue. No word of the owner's is used or invented here.

const ASPECTS = [0.46, 0.5, 0.75, 1, 1.78, 2.2];
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('the pan', () => {
  it('is always clamped, whatever is thrown at it', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    let p = { ...CENTRED };
    for (let i = 0; i < 2000; i++) {
      const r = rnd();
      p = r < 0.5 ? panFromDrag(p, (rnd() - 0.5) * 4000, (rnd() - 0.5) * 4000, 390) : panFromKey(p, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'x'][Math.floor(rnd() * 5)]!);
      expect(p.yawDeg).toBeGreaterThanOrEqual(STAY_WORLD.yawRangeDeg[0]);
      expect(p.yawDeg).toBeLessThanOrEqual(STAY_WORLD.yawRangeDeg[1]);
      expect(p.pitchDeg).toBeGreaterThanOrEqual(STAY_WORLD.pitchLimitDeg[0]);
      expect(p.pitchDeg).toBeLessThanOrEqual(STAY_WORLD.pitchLimitDeg[1]);
    }
  });
  it('a drag across half the screen turns the view by half of dragDegPerScreen (a whole screen is 70 degrees and would hit the left end of the yaw range); the world follows the finger', () => {
    expect(panFromDrag(CENTRED, 195, 0, 390).yawDeg).toBe(-STAY_WORLD.dragDegPerScreen / 2);
    expect(panFromDrag(CENTRED, 390, 0, 390).yawDeg).toBe(STAY_WORLD.yawRangeDeg[0]);
    expect(panFromDrag(CENTRED, 100, 0, 390).yawDeg).toBeLessThan(0);
    expect(panFromDrag(CENTRED, 0, 100, 390).pitchDeg).toBeGreaterThan(0);
  });
  it('bad numbers change nothing; unknown keys change nothing; Home recentres', () => {
    const p = { yawDeg: 10, pitchDeg: 5 };
    expect(panFromDrag(p, NaN, 3, 390)).toEqual(p);
    expect(panFromDrag(p, 3, 3, 0)).toEqual(p);
    expect(panFromKey(p, 'q')).toEqual(p);
    expect(panFromKey(p, 'Home')).toEqual(CENTRED);
    expect(clampPan({ yawDeg: NaN, pitchDeg: 1 }).yawDeg).toBe(STAY_WORLD.yawRangeDeg[0]);
  });
  it('looking up far enough is "constellations", otherwise "wander"', () => {
    expect(activityForPan(CENTRED)).toBe('wander');
    expect(activityForPan({ yawDeg: 0, pitchDeg: STAY_WORLD.skyLookPitchDeg })).toBe('constellations');
    expect(activityForPan({ yawDeg: 0, pitchDeg: STAY_WORLD.skyLookPitchDeg - 1 })).toBe('wander');
  });
});

describe('the camera', () => {
  it('under reduced motion, with no pan, it is exactly the valley the finale ended on, at every moment', () => {
    for (const a of ASPECTS) {
      const v = valleyCamera(a);
      for (const t of [0, 5, 99]) {
        const c = wanderCamera(a, t, CENTRED, true);
        expect(dist(c.eye, v.eye)).toBeLessThan(1e-9);
        expect(dist(c.look, v.look) < 1e-6 || dist(c.look.map((x, i) => x - c.eye[i]!), v.look.map((x, i) => x - v.eye[i]!)) > 0).toBe(true);
        expect(c.fovDeg).toBe(v.fovDeg);
      }
    }
  });
  it('the sway is small, slow, and starts from the valley eye within the stated reach', () => {
    const v = valleyCamera(0.5);
    let worst = 0;
    for (let t = 0; t < 200; t += 0.5) worst = Math.max(worst, dist(wanderCamera(0.5, t, CENTRED, false).eye, v.eye));
    expect(worst).toBeLessThan(Math.hypot(STAY_WORLD.driftM[0], STAY_WORLD.driftM[1]) + 1e-9);
    expect(worst).toBeGreaterThan(0.1);
  });
  it('the look direction turns by the pan (yaw about the vertical, pitch up), and keeps its length at 20 m', () => {
    const c0 = wanderCamera(1, 0, CENTRED, true);
    const c1 = wanderCamera(1, 0, { yawDeg: 20, pitchDeg: 0 }, true);
    const c2 = wanderCamera(1, 0, { yawDeg: 0, pitchDeg: 30 }, true);
    expect(Math.abs(dist(c1.look, c1.eye) - 20)).toBeLessThan(1e-6);
    expect(c1.look[1]! - c1.eye[1]!).toBeCloseTo(c0.look[1]! - c0.eye[1]!, 5);
    expect(c1.look[0]).not.toBe(c0.look[0]);
    expect(c2.look[1]! - c2.eye[1]!).toBeGreaterThan(c0.look[1]! - c0.eye[1]!);
  });
  it('is deterministic and ignores a bad clock', () => {
    expect(wanderCamera(0.5, 7, CENTRED, false)).toEqual(wanderCamera(0.5, 7, CENTRED, false));
    expect(wanderCamera(0.5, NaN, CENTRED, false)).toEqual(wanderCamera(0.5, 0, CENTRED, false));
  });
});

describe('the shapes coming home', () => {
  it('k = 0 is the crown as the finale left it and k = 1 is the Phase 22 patch, exactly, for every shape at every screen', () => {
    for (const a of ASPECTS) {
      for (const id of CROWN_ORDER) {
        expect(homePlacement(a, id, 0)).toEqual(finalePlacement(a, id, 1, 1));
        const end = homePlacement(a, id, 1);
        const patch = layoutFor(a)[id]!;
        expect(Math.abs(end.azDeg - patch.azDeg)).toBeLessThan(1e-9);
        expect(Math.abs(end.elDeg - patch.elDeg)).toBeLessThan(1e-9);
        expect(Math.abs(end.halfAngleDeg - patch.halfAngleDeg)).toBeLessThan(1e-9);
      }
    }
  });
  it('is continuous: no step between neighbouring moments jumps more than a few degrees', () => {
    for (const id of CROWN_ORDER) {
      let prev = homePlacement(0.5, id, 0);
      for (let i = 1; i <= 200; i++) {
        const q = homePlacement(0.5, id, i / 200);
        expect(Math.hypot(q.azDeg - prev.azDeg, q.elDeg - prev.elDeg)).toBeLessThan(2);
        prev = q;
      }
    }
  });
  it('homeProgress: 0 at the start, 1 after homeSeconds, always 1 under reduced motion, bad clock = 0', () => {
    expect(homeProgress(0, false)).toBe(0);
    expect(homeProgress(STAY_WORLD.homeSeconds, false)).toBe(1);
    expect(homeProgress(STAY_WORLD.homeSeconds * 9, false)).toBe(1);
    expect(homeProgress(0, true)).toBe(1);
    expect(homeProgress(NaN, false)).toBe(0);
  });
});

describe('the glue', () => {
  const setup = (reduced = false) => {
    const bus = createBus<WinterEvents>(() => undefined);
    const stay = createStayAwhileAct({ bus, chainFrom: bus });
    const world = createStayWorld({ stay, reducedMotion: reduced });
    return { bus, stay, world };
  };
  it('does nothing until she is staying; then the clock runs and the shapes come home', () => {
    const { stay, world } = setup();
    world.update(1);
    expect(world.state().time).toBe(0);
    stay.enter();
    for (let i = 0; i < 60 * 3; i++) world.update(1 / 60);
    expect(world.state().home).toBe(1);
  });
  it('a long stall counts as at most a quarter second', () => {
    const { stay, world } = setup();
    stay.enter();
    world.update(100);
    expect(world.state().time).toBe(0.25);
  });
  it('looking up says "constellations" to the stay act, looking down says "wander", and it never overrides pet', () => {
    const { bus, stay, world } = setup();
    const seen: string[] = [];
    bus.on('stay:activity', (e) => void seen.push(e.activity));
    stay.enter();
    for (let i = 0; i < 6; i++) world.key('ArrowUp');
    expect(stay.state().activity).toBe('constellations');
    world.key('Home');
    expect(stay.state().activity).toBe('wander');
    expect(seen).toEqual(['constellations', 'wander']);
    stay.setActivity('pet');
    for (let i = 0; i < 6; i++) world.key('ArrowUp');
    expect(stay.state().activity).toBe('pet');
  });
  it('entering again resets the clock and the pan, and the exits are never touched', () => {
    const { stay, world } = setup();
    stay.enter();
    world.key('ArrowLeft');
    world.update(1);
    expect(stay.state().exits).toEqual(['letter', 'replay']);
    stay.exit('replay');
    stay.enter();
    expect(world.state().time).toBe(0);
    expect(world.state().pan).toEqual(CENTRED);
    expect(stay.state().exits).toEqual(['letter', 'replay']);
  });
  it('drag, key and recenter work even when she is not staying (they only move the view)', () => {
    const { world } = setup();
    world.drag(-100, 0, 390);
    expect(world.state().pan.yawDeg).toBeGreaterThan(0);
    world.recenter();
    expect(world.state().pan).toEqual(CENTRED);
  });
});

describe('the files', () => {
  it('draw nothing, import no three, audio or DOM, and carry no sentence', () => {
    for (const f of ['stayWorldMath', 'stayWorld']) {
      const src = readFileSync(`src/acts/${f}.ts`, 'utf8').replace(/\/\/[^\n]*/g, '');
      expect(src).not.toMatch(/from 'three'|audio|document\.|window\./);
      expect(src).not.toMatch(/['"`][A-Z][a-z]+ [a-z]+ [a-z]+[^'"`]*['"`]/);
    }
  });
});
