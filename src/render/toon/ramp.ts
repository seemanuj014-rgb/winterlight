// The cel-shading ramp as data (no three import). x axis = dot(N, L) from -1 to 1.
// Each step is a colour MULTIPLIER on the base colour; 1.0 is the base itself, so with a light of
// intensity PI the lit tone is exactly the measured palette colour (see material.ts).

export interface RampStep {
  /** dot(N, L) where this step begins. */
  at: number;
  /** Linear RGB multiplier of the base colour, each 0..1. */
  mul: [number, number, number];
}

export interface RampSpec {
  steps: RampStep[];
  /** Half-width of each transition in dot(N, L) units: small = crisp cel edge, large = soft. */
  softness: number;
}

/** Four steps. Shadows lean slightly cool: same hue family, no new hues. Tune by eye in Phase 11. */
export const RAMP_SOFT4: RampSpec = {
  softness: 0.06,
  steps: [
    { at: -1, mul: [0.5, 0.58, 0.72] },
    { at: -0.15, mul: [0.68, 0.75, 0.86] },
    { at: 0.2, mul: [0.86, 0.91, 0.97] },
    { at: 0.55, mul: [1, 1, 1] },
  ],
};

/** Three steps, for things that should read flatter (far props, snow). */
export const RAMP_SOFT3: RampSpec = {
  softness: 0.08,
  steps: [
    { at: -1, mul: [0.6, 0.67, 0.8] },
    { at: 0.0, mul: [0.82, 0.88, 0.95] },
    { at: 0.45, mul: [1, 1, 1] },
  ],
};

export const RAMP_PRESETS = { soft4: RAMP_SOFT4, soft3: RAMP_SOFT3 } as const;
export type RampName = keyof typeof RAMP_PRESETS;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** RGBA bytes, `width` texels wide, one row. Texel i holds dot(N,L) = (i+0.5)/width*2-1. */
export function buildRampTexels(spec: RampSpec, width = 64): Uint8Array {
  const steps = [...spec.steps].sort((a, b) => a.at - b.at);
  const first = steps[0];
  if (!first) throw new Error('ramp needs at least one step');
  const out = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const d = ((i + 0.5) / width) * 2 - 1;
    let c: [number, number, number] = [...first.mul];
    for (let k = 1; k < steps.length; k++) {
      const s = steps[k]!;
      const t = smoothstep(s.at - spec.softness, s.at + spec.softness, d);
      c = [c[0] + (s.mul[0] - c[0]) * t, c[1] + (s.mul[1] - c[1]) * t, c[2] + (s.mul[2] - c[2]) * t];
    }
    out[i * 4] = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
    out[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
    out[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}
