import { describe, it, expect } from 'vitest';
import { readDebugParams, formatDebugLines } from '../src/core/debug';

describe('debug params', () => {
  it('is off without ?debug, and ignores a tier override then', () => {
    expect(readDebugParams('')).toEqual({ debug: false, tier: null });
    expect(readDebugParams('?tier=low')).toEqual({ debug: false, tier: null });
  });
  it('is on with ?debug, with an optional valid tier override', () => {
    expect(readDebugParams('?debug')).toEqual({ debug: true, tier: null });
    expect(readDebugParams('?debug&tier=mid')).toEqual({ debug: true, tier: 'mid' });
    expect(readDebugParams('?debug&tier=ultra')).toEqual({ debug: true, tier: null });
  });
});

describe('debug lines', () => {
  const base = { tier: 'high', startTier: 'high', fps: 60, calls: 3, triangles: 1200, textureMB: 0, pixelRatio: 2, width: 390, height: 780, contextLost: false } as const;
  it('shows the fields the budget asks for', () => {
    const t = formatDebugLines(base).join('\n');
    for (const k of ['tier', 'fps', 'calls', 'tris', 'tex']) expect(t).toContain(k);
  });
  it('shows a step-down and a lost context', () => {
    expect(formatDebugLines({ ...base, tier: 'mid' }).join('\n')).toContain('started high');
    expect(formatDebugLines({ ...base, contextLost: true }).join('\n')).toContain('CONTEXT LOST');
  });
});
