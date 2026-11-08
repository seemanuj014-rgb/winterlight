import { describe, it, expect } from 'vitest';
import { PowerGovernor } from '../src/core/power';
import { downloadBudgetError, DOWNLOAD_BUDGET_BYTES } from '../tools/buildEnv';
import { readFileSync } from 'node:fs';

const feed = (g: PowerGovernor, ms: number, n: number, low = true): boolean => {
  let hit = false;
  for (let i = 0; i < n; i++) hit = g.push(ms, low) || hit;
  return hit;
};

describe('low power', () => {
  it('stays off for a smooth card, and never counts above the lowest tier', () => {
    const g = new PowerGovernor();
    expect(feed(g, 16.7, 1000)).toBe(false);
    expect(feed(g, 60, 1000, false)).toBe(false);
    expect(g.lowPower).toBe(false);
  });
  it('turns on once, after sustained slowness at the lowest tier', () => {
    const g = new PowerGovernor();
    expect(feed(g, 50, 60 + 120)).toBe(false); // warm-up plus one slow window: only one strike
    expect(feed(g, 50, 120)).toBe(true);
    expect(g.lowPower).toBe(true);
    expect(feed(g, 50, 500)).toBe(false); // announced once
  });
  it('a recovered window resets the strikes, and stalls are ignored', () => {
    const g = new PowerGovernor();
    feed(g, 16.7, 60);
    feed(g, 50, 120);
    feed(g, 16.7, 120);
    expect(feed(g, 50, 120)).toBe(false);
    expect(feed(g, 5000, 1000)).toBe(false);
  });
  it('caps drawing at 30 per second on a 60 Hz screen, and does nothing when off', () => {
    const off = new PowerGovernor();
    expect(Array.from({ length: 6 }, (_, i) => off.shouldDraw(i * 16.67)).every(Boolean)).toBe(true);
    const g = new PowerGovernor();
    g.enter();
    let drawn = 0;
    for (let i = 0; i < 120; i++) if (g.shouldDraw(i * (1000 / 60))) drawn++;
    expect(drawn).toBe(60);
  });
});

describe('download budget', () => {
  it('passes inside the budget and names the biggest files over it', () => {
    expect(downloadBudgetError([{ name: 'a.js', gzipBytes: 1000 }])).toBeNull();
    const err = downloadBudgetError([{ name: 'big.js', gzipBytes: DOWNLOAD_BUDGET_BYTES }, { name: 'b.css', gzipBytes: 10 }]);
    expect(err).toMatch(/over the 2\.5 MB budget/);
    expect(err).toMatch(/big\.js/);
  });
});

describe('service worker file', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  it('is same-origin GET only and falls back to a saved copy', () => {
    expect(sw).toMatch(/req\.method !== 'GET'/);
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/);
    expect(sw).toMatch(/networkFirst/);
    expect(sw).toMatch(/cacheFirst/);
  });
});
