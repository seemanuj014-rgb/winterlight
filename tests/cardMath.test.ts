import { describe, expect, it } from 'vitest';
import { CARD_STAGES, DIP_S, SKY_NEEDED, dipLevel, isStage, nextStage, switchesAt, type CardEvent, type CardStage } from '../src/acts/cardMath';

const EVENTS: CardEvent[] = [
  { type: 'acts:done' },
  { type: 'sky:count', done: 4 },
  { type: 'sky:count', done: 5 },
  { type: 'cake:done' },
  { type: 'release:done' },
  { type: 'letter:done' },
  { type: 'finale:done' },
  { type: 'stay:replay' },
];

describe('card order (Phase 28)', () => {
  it('walks the storyboard in order, one stage at a time', () => {
    let s: CardStage = 'acts';
    const seen: CardStage[] = [s];
    for (const ev of [{ type: 'acts:done' }, { type: 'sky:count', done: SKY_NEEDED }, { type: 'cake:done' }, { type: 'release:done' }, { type: 'letter:done' }, { type: 'finale:done' }] as CardEvent[]) {
      const n = nextStage(s, ev);
      expect(n).not.toBeNull();
      s = n!;
      seen.push(s);
    }
    expect(seen).toEqual([...CARD_STAGES]);
  });
  it('the sky waits for all five names and never moves on four', () => {
    expect(nextStage('sky', { type: 'sky:count', done: 4 })).toBeNull();
    expect(nextStage('sky', { type: 'sky:count', done: 5 })).toBe('cake');
  });
  it('only the event that belongs to a stage moves it (fuzz over every pair)', () => {
    for (const s of CARD_STAGES) for (const ev of EVENTS) {
      const n = nextStage(s, ev);
      if (n !== null) expect(CARD_STAGES.includes(n)).toBe(true);
    }
    expect(nextStage('cake', { type: 'finale:done' })).toBeNull();
    expect(nextStage('envelope', { type: 'cake:done' })).toBeNull();
  });
  it('stay a while is never ended by the card: the only way out is the replay, and it comes back through the finale', () => {
    for (const ev of EVENTS) if (ev.type !== 'stay:replay') expect(nextStage('stay', ev)).toBeNull();
    expect(nextStage('stay', { type: 'stay:replay' })).toBe('finale');
    expect(nextStage('finale', { type: 'finale:done' })).toBe('stay');
  });
  it('knows its stage names', () => {
    expect(isStage('cake')).toBe(true);
    expect(isStage('nook')).toBe(false);
    expect(isStage(null)).toBe(false);
  });
});

describe('the dip between stages', () => {
  it('goes dark and clear again, never past 0..1, and not at all with reduced motion', () => {
    expect(dipLevel(0, false)).toBe(0);
    expect(dipLevel(DIP_S / 2, false)).toBeCloseTo(1, 6);
    expect(dipLevel(DIP_S, false)).toBe(0);
    for (let t = -1; t < 3; t += 0.05) {
      const v = dipLevel(t, false);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(dipLevel(t, true)).toBe(0);
    }
    expect(dipLevel(Number.NaN, false)).toBe(0);
  });
  it('switches at the darkest moment, at once when reduced', () => {
    expect(switchesAt(false)).toBeCloseTo(DIP_S / 2, 6);
    expect(switchesAt(true)).toBe(0);
  });
});
