import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PetMachine } from '../src/interaction/petMath';
import { STAY_BUNNY_LEASH, TAP_MAX_S, STAY_BUNNY_RADIUS } from '../src/acts/stayPet';

const pet = readFileSync('src/acts/stayPet.ts', 'utf8');
const petCode = pet.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'); // the comments say what it does NOT touch
const input = readFileSync('src/acts/stayInput.ts', 'utf8');
const view = readFileSync('src/acts/stayView.ts', 'utf8');

describe('stay a while: petting the bunny', () => {
  it('uses the Phase 20 machine as it is (no rules of its own) and has no cat in the valley', () => {
    expect(pet).toMatch(/new PetMachine\(/);
    expect(pet).toMatch(/catPresent: false/);
    expect(petCode).not.toMatch(/exit|letter|replay|readAgain/);
  });
  it('a press on the bunny is claimed before the view can take it, and nothing else is', () => {
    expect(input).toMatch(/o\.claim && o\.claim\(/);
    expect(view).toMatch(/claim: \(x, y, k\) => pet\.claim\(x, y, k\)/);
    expect(pet).toMatch(/if \(!present \|\| pressing\) return false/);
    expect(pet).toMatch(/picker\.pick\(x, y, kind\) !== 'bunny'\) return false/);
  });
  it('the numbers are sane: a generous target, a short tap, a short leash', () => {
    expect(STAY_BUNNY_RADIUS).toBeGreaterThan(0.3);
    expect(TAP_MAX_S).toBeGreaterThan(0.1);
    expect(TAP_MAX_S).toBeLessThan(0.5);
    expect(STAY_BUNNY_LEASH).toBeGreaterThan(0.5);
    expect(STAY_BUNNY_LEASH).toBeLessThan(2.6);
  });
  it('the machine with the valley numbers: a held finger makes her hop, a tap on her makes her hide, she never leaves the leash', () => {
    const home = { x: -2, z: 1 };
    const m = new PetMachine({ bunnyHome: home, bunnyYaw: 0, bunnyLeash: STAY_BUNNY_LEASH });
    const base = { catPresent: false, bunnyPresent: true, reduced: false, cat: { on: false, moved: 0, tap: false, state: 'sit' as never }, chamState: 'sit' };
    let hopped = false;
    for (let i = 0; i < 600; i++) {
      const o = m.update(1 / 60, { ...base, bunny: { state: m.bunny.mode === 'hop' ? 'hop' : 'sit', finger: { x: home.x + 1, z: home.z }, tap: null, reduced: false } as never });
      if (o.events.some((e) => e.type === 'bunnyHop')) hopped = true;
      expect(Math.hypot(m.bunny.x - home.x, m.bunny.z - home.z)).toBeLessThanOrEqual(STAY_BUNNY_LEASH + 0.01);
    }
    expect(hopped).toBe(true);
    const m2 = new PetMachine({ bunnyHome: home, bunnyYaw: 0, bunnyLeash: STAY_BUNNY_LEASH });
    const o2 = m2.update(1 / 60, { ...base, bunny: { state: 'sit' as never, finger: null, tap: { at: { x: home.x, z: home.z }, on: true }, reduced: false } });
    expect(o2.events.some((e) => e.type === 'bunnyStartle')).toBe(true);
  });
  it('changes nothing about the exits and is rehomed when the screen changes shape', () => {
    expect(pet).toMatch(/rehome\(\)/);
    expect(view).toMatch(/pet\.rehome\(\)/);
    expect(view).toMatch(/cast\.setAspect\(a\)/);
  });
});
