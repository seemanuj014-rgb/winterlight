import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CALL_LIMIT, PART_CALLS, lookForActivity, planStay, shows } from '../src/acts/stayBudgetMath';

const src = readFileSync('src/acts/stayBudgetMath.ts', 'utf8');

describe('stay a while: the draw-call plan', () => {
  it('both looks fit the low tier limit', () => {
    for (const look of ['level', 'up'] as const) expect(planStay(look).calls).toBeLessThanOrEqual(CALL_LIMIT.low);
  });
  it('level is the valley plus Chamgadad and the bunny: 58 of 60, and that is the tight one', () => {
    const p = planStay('level');
    expect(p.calls).toBe(8 + 4 + 7 + 30 + 9);
    expect(p.calls).toBe(58);
  });
  it('looking up is the valley plus the five shapes: 29, the number read from ?stay', () => {
    expect(planStay('up').calls).toBe(29);
  });
  it('the animals and the sky are never drawn together', () => {
    for (const look of ['level', 'up'] as const) {
      const sky = shows(look, 'sky');
      const animals = shows(look, 'chamgadad') || shows(look, 'bunny');
      expect(sky && animals).toBe(false);
    }
    // and drawing all of them at once would break the limit (the reason for the rule)
    const all = Object.values(PART_CALLS).reduce((a, b) => a + b, 0);
    expect(all).toBeGreaterThan(CALL_LIMIT.low);
  });
  it('the valley is always there', () => {
    for (const look of ['level', 'up'] as const) for (const id of ['backdrop', 'ground', 'cabin'] as const) expect(shows(look, id)).toBe(true);
  });
  it('the look follows the world label and nothing else', () => {
    expect(lookForActivity('constellations')).toBe('up');
    for (const a of ['wander', 'pet', 'wishes', 'secrets', '']) expect(lookForActivity(a)).toBe('level');
  });
  it('is pure: no three, no DOM, no clock, no random, no sentence', () => {
    expect(src).not.toMatch(/from 'three'|document\.|window\.|Date\.now|performance\.now|Math\.random/);
    expect(src).not.toMatch(/exit|letter|replay/);
  });
});
