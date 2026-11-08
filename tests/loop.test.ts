import { describe, it, expect } from 'vitest';
import { FixedStepper, FIXED_DT } from '../src/core/loop';

describe('fixed stepper', () => {
  it('runs one step per 1/60 s frame', () => {
    const s = new FixedStepper();
    for (let i = 0; i < 10; i++) expect(s.advance(FIXED_DT).steps).toBe(1);
  });
  it('catches up on a slow frame and keeps the remainder as alpha', () => {
    const s = new FixedStepper();
    const a = s.advance(0.025); // 1.5 steps
    expect(a.steps).toBe(1);
    expect(a.alpha).toBeCloseTo(0.5, 5);
    const b = s.advance(0.025); // 0.5 + 1.5 = 2.0 steps
    expect(b.steps).toBe(2);
    expect(b.alpha).toBeCloseTo(0, 5);
  });
  it('runs zero steps on a very short frame and totals match real time', () => {
    const s = new FixedStepper();
    let steps = 0;
    for (let i = 0; i < 240; i++) steps += s.advance(1 / 240).steps; // 1 s at 240 Hz
    expect(steps).toBe(60);
  });
  it('clamps a huge frame and drops the backlog instead of replaying it', () => {
    const s = new FixedStepper();
    const r = s.advance(30); // tab was asleep
    expect(r.steps).toBe(5);
    expect(r.alpha).toBe(0);
    expect(s.advance(FIXED_DT).steps).toBe(1); // back to normal next frame
  });
  it('treats zero and negative frames as no time', () => {
    const s = new FixedStepper();
    expect(s.advance(0).steps).toBe(0);
    expect(s.advance(-1).steps).toBe(0);
  });
  it('reset clears the remainder', () => {
    const s = new FixedStepper();
    s.advance(0.025);
    s.reset();
    expect(s.advance(0).alpha).toBe(0);
  });
});
