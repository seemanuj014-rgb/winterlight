import { describe, it, expect } from 'vitest';
import { pickInitialTier, settingsFor, lowerTier, FpsWatchdog, DEFAULT_WATCHDOG, type QualityTier } from '../src/core/quality';

describe('tier picker', () => {
  it('reduced motion is always low', () => {
    expect(pickInitialTier(16, 16, true)).toBe('low');
  });
  it('weak hardware is low', () => {
    expect(pickInitialTier(4, 8, false)).toBe('low');
    expect(pickInitialTier(8, 2, false)).toBe('low');
  });
  it('strong hardware is high, in-between is mid', () => {
    expect(pickInitialTier(8, 8, false)).toBe('high');
    expect(pickInitialTier(6, 4, false)).toBe('mid');
    expect(pickInitialTier(8, undefined, false)).toBe('mid'); // memory unknown counts as 4 GB
  });
  it('tier table matches PERF_BUDGET pixel ratios and particles', () => {
    expect([settingsFor('low').maxPixelRatio, settingsFor('mid').maxPixelRatio, settingsFor('high').maxPixelRatio]).toEqual([1.25, 1.75, 2]);
    expect([settingsFor('low').maxParticles, settingsFor('mid').maxParticles, settingsFor('high').maxParticles]).toEqual([800, 2500, 6000]);
  });
  it('lowerTier steps down and stops at low', () => {
    expect(lowerTier('high')).toBe('mid');
    expect(lowerTier('mid')).toBe('low');
    expect(lowerTier('low')).toBe('low');
  });
});

// Feeds n frames of ms each; returns every step-down it reported, in order.
function feed(w: FpsWatchdog, n: number, ms: number): QualityTier[] {
  const out: QualityTier[] = [];
  for (let i = 0; i < n; i++) {
    const r = w.push(ms);
    if (r) out.push(r);
  }
  return out;
}
const { warmupFrames: WARM, windowFrames: WIN, strikesToStepDown: STRIKES } = DEFAULT_WATCHDOG;
const SLOW_FRAMES = WARM + WIN * STRIKES; // frames from a fresh start to the first step-down

describe('fps watchdog', () => {
  it('stays put on a healthy device', () => {
    const w = new FpsWatchdog('high');
    expect(feed(w, 2000, 16.7)).toEqual([]);
    expect(w.tier).toBe('high');
  });
  it('steps down only after sustained slow frames, not before', () => {
    const w = new FpsWatchdog('high');
    expect(feed(w, SLOW_FRAMES - 1, 40)).toEqual([]);
    expect(feed(w, 1, 40)).toEqual(['mid']);
    expect(w.tier).toBe('mid');
  });
  it('ignores the warm-up frames, however slow', () => {
    const w = new FpsWatchdog('high');
    expect(feed(w, WARM, 90)).toEqual([]);
    expect(feed(w, WIN, 16)).toEqual([]);
    expect(w.tier).toBe('high');
  });
  it('one slow window followed by a fast one resets the strike', () => {
    const w = new FpsWatchdog('high');
    feed(w, WARM, 16);
    expect(feed(w, WIN, 40)).toEqual([]); // strike 1
    expect(feed(w, WIN, 16)).toEqual([]); // healthy window clears it
    expect(feed(w, WIN, 40)).toEqual([]); // strike 1 again, not 2
    expect(w.tier).toBe('high');
  });
  it('ignores stalls (tab switch, debugger) and non-positive samples', () => {
    const w = new FpsWatchdog('high');
    feed(w, WARM, 16);
    expect(feed(w, 5000, 5000)).toEqual([]);
    expect(feed(w, 500, 0)).toEqual([]);
    expect(feed(w, 500, NaN)).toEqual([]);
    expect(w.tier).toBe('high');
  });
  it('one hitch inside a good window does not count as slow', () => {
    const w = new FpsWatchdog('high');
    feed(w, WARM, 16);
    for (let round = 0; round < 5; round++) {
      w.push(900); // a single long frame, clamped
      expect(feed(w, WIN - 1, 16)).toEqual([]);
    }
    expect(w.tier).toBe('high');
  });
  it('goes high to mid to low, needs a fresh warm-up and fresh strikes for each step, then stays low', () => {
    const w = new FpsWatchdog('high');
    expect(feed(w, SLOW_FRAMES, 60)).toEqual(['mid']);
    expect(feed(w, SLOW_FRAMES - 1, 60)).toEqual([]); // not one frame sooner
    expect(feed(w, 1, 60)).toEqual(['low']);
    expect(feed(w, 5000, 100)).toEqual([]);
    expect(w.tier).toBe('low');
  });
  it('never steps back up, even after a long run of fast frames', () => {
    const w = new FpsWatchdog('high');
    feed(w, SLOW_FRAMES, 60);
    expect(w.tier).toBe('mid');
    expect(feed(w, 20000, 8)).toEqual([]);
    expect(w.tier).toBe('mid');
  });
  it('mid tolerates an OS-capped 30 fps but not 20 fps', () => {
    const capped = new FpsWatchdog('mid');
    expect(feed(capped, 3000, 33.4)).toEqual([]);
    const slow = new FpsWatchdog('mid');
    expect(feed(slow, SLOW_FRAMES, 50)).toEqual(['low']);
  });
  it('a low-start session never reports anything', () => {
    const w = new FpsWatchdog('low');
    expect(feed(w, 5000, 200)).toEqual([]);
    expect(w.tier).toBe('low');
  });
  it('options can be overridden without losing the other defaults', () => {
    const w = new FpsWatchdog('high', { warmupFrames: 0, windowFrames: 10, strikesToStepDown: 1 });
    expect(feed(w, 10, 40)).toEqual(['mid']);
  });
});
