// Phase 15: the numbers behind the post pass. Pure: no three, no DOM, no clock, so it is unit-tested.
// PB: low = no postprocessing at all, mid = bloom at half resolution, high = bloom (two widths) + the grade.
// AD: "Bloom only on warm and aurora highlights." So the bright pass picks colour (chroma) as well as brightness: the pale snow and the moon are bright
// but nearly colourless and stay out of it; the window light, the lantern and the aurora are bright AND coloured and go in.

export type Tier = 'low' | 'mid' | 'high';
export type Vec3 = [number, number, number];

export interface BloomPlan {
  /** size of the bloom buffers relative to the scene buffer */
  scale: number;
  /** 1 = one blurred level; 2 = a second, wider level at half of that again */
  levels: 1 | 2;
  /** the bright pass keeps a pixel when its largest channel (display-encoded) passes this, with a soft knee either side */
  threshold: number;
  knee: number;
  /** ...and when its chroma (max channel minus min channel) is between these two */
  chroma: [number, number];
  /** how much of each level is added back */
  strength: [number, number];
  /** blur step in texels: bigger = wider glow */
  radius: number;
}

export interface GradePlan {
  enabled: boolean;
  exposure: number;
  saturation: number;
  /** 1 = none; pivots on mid grey */
  contrast: number;
  /** linear RGB multipliers pushed into the shadows and the highlights: cool blue-teal down low, a trace of warm up high */
  shadowTint: Vec3;
  highlightTint: Vec3;
  /** 0..1: how much of the split tone is applied */
  split: number;
  /** 0..1 darkening toward the corners, and how soft (fraction of the half-diagonal where it starts) */
  vignette: number;
  vignetteStart: number;
  /** amplitude of the one-8-bit-step dither added before the display encode, so deep blue does not band */
  dither: number;
}

export interface PostPlan {
  enabled: boolean;
  /** multisample count of the scene buffer (0 = none). The canvas' own antialiasing does not reach a render target. */
  msaa: number;
  bloom: BloomPlan | null;
  grade: GradePlan;
}

export const GRADE_OFF: GradePlan = {
  enabled: false, exposure: 1, saturation: 1, contrast: 1, shadowTint: [1, 1, 1], highlightTint: [1, 1, 1], split: 0, vignette: 0, vignetteStart: 0.5, dither: 0,
};

/** Tune by eye. `[A]` every number. */
export const BLOOM_MID: BloomPlan = {
  scale: 0.5, levels: 1, threshold: 0.84, knee: 0.14, chroma: [0.25, 0.55], strength: [0.6, 0], radius: 1.35,
};
export const BLOOM_HIGH: BloomPlan = {
  scale: 0.5, levels: 2, threshold: 0.84, knee: 0.14, chroma: [0.25, 0.55], strength: [0.5, 0.4], radius: 1.35,
};
export const GRADE_HIGH: GradePlan = {
  enabled: true,
  exposure: 1.0,
  saturation: 1.04,
  contrast: 1.05,
  shadowTint: [0.93, 1.0, 1.08],
  highlightTint: [1.05, 1.0, 0.94],
  split: 0.6,
  vignette: 0.3,
  vignetteStart: 0.55,
  dither: 1,
};

/** What a tier gets. `postprocessing` in quality.ts says the same thing (low off, mid and high on). Reduced motion changes nothing here: the pass is still. */
export function postPlanFor(tier: Tier, _reducedMotion = false): PostPlan {
  if (tier === 'low') return { enabled: false, msaa: 0, bloom: null, grade: GRADE_OFF };
  if (tier === 'mid') return { enabled: true, msaa: 2, bloom: BLOOM_MID, grade: GRADE_OFF };
  return { enabled: true, msaa: 4, bloom: BLOOM_HIGH, grade: GRADE_HIGH };
}

/** Passes the plan draws after the scene: bright, blur x2, [downsample, blur x2], composite. The scene's own draw calls are not in this. */
export function postPassCount(plan: PostPlan): number {
  if (!plan.enabled) return 0;
  if (!plan.bloom) return 1;
  return 1 + 2 + (plan.bloom.levels === 2 ? 3 : 0) + 1;
}

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The bright pass, in JS, as a reference for the shader (the shader is the same arithmetic). Input and output: the scene buffer's display-encoded RGB. */
export function bloomSource(rgb: Vec3, plan: BloomPlan): Vec3 {
  const mx = Math.max(rgb[0], rgb[1], rgb[2]);
  const mn = Math.min(rgb[0], rgb[1], rgb[2]);
  const bright = smoothstep(plan.threshold - plan.knee, plan.threshold + plan.knee, mx);
  const coloured = smoothstep(plan.chroma[0], plan.chroma[1], mx - mn);
  const k = bright * coloured;
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}

/** Five taps that stand for a nine-tap Gaussian (sigma 2): taps sit between texels so the hardware's bilinear filter does the pairing. */
export function blurTaps(): { offsets: number[]; weights: number[] } {
  const w = [0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162]; // the classic 9-tap, centre first
  const offsets = [0, (1 * w[1]! + 2 * w[2]!) / (w[1]! + w[2]!), (3 * w[3]! + 4 * w[4]!) / (w[3]! + w[4]!)];
  const weights = [w[0]!, w[1]! + w[2]!, w[3]! + w[4]!];
  return { offsets, weights };
}

/** The final grade, in JS, for tests and for tuning without a GPU. rgb display-encoded (the buffer's own space), uv 0..1. Returns the same space. */
export function applyGrade(rgb: Vec3, uv: [number, number], g: GradePlan, aspect = 1): Vec3 {
  if (!g.enabled) return [rgb[0], rgb[1], rgb[2]];
  let c: Vec3 = [rgb[0] * g.exposure, rgb[1] * g.exposure, rgb[2] * g.exposure];
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // split tone: shadows cool, highlights a trace warm, so warm light stays rare and so precious
  const sh = (1 - smoothstep(0.0, 0.35, lum)) * g.split;
  const hi = smoothstep(0.45, 1.0, lum) * g.split;
  c = c.map((v, i) => v * (1 + (g.shadowTint[i]! - 1) * sh) * (1 + (g.highlightTint[i]! - 1) * hi)) as Vec3;
  const l2 = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  c = c.map((v) => l2 + (v - l2) * g.saturation) as Vec3;
  c = c.map((v) => 0.46 + (v - 0.46) * g.contrast) as Vec3;
  const dx = (uv[0] - 0.5) * 2 * Math.min(1, aspect);
  const dy = (uv[1] - 0.5) * 2 * Math.min(1, 1 / aspect);
  const r = Math.hypot(dx, dy) / Math.SQRT2;
  const v = 1 - g.vignette * smoothstep(g.vignetteStart, 1.0, r);
  return c.map((x) => Math.max(0, x * v)) as Vec3;
}

/** Size of a bloom level's buffer for a scene buffer of w x h pixels (never under 2 px each way). */
export function levelSize(w: number, h: number, scale: number, level: number): { w: number; h: number } {
  const s = scale * Math.pow(0.5, level);
  return { w: Math.max(2, Math.round(w * s)), h: Math.max(2, Math.round(h * s)) };
}

/** Texture memory of the post buffers, in MB (RGBA16F scene buffer, plus a ping and a pong per bloom level). Render targets are not in the `?debug` texture estimate, so this is reported next to it. */
export function postMemoryMB(plan: PostPlan, w: number, h: number): number {
  if (!plan.enabled) return 0;
  const px = (a: number, b: number): number => a * b * 8; // RGBA16F: 8 bytes a pixel
  let bytes = px(w, h) * (1 + (plan.msaa > 0 ? plan.msaa : 0) * 0.5); // the resolve target plus the multisampled store (depth is not counted)
  if (plan.bloom) {
    for (let l = 0; l < plan.bloom.levels; l++) {
      const s = levelSize(w, h, plan.bloom.scale, l);
      bytes += px(s.w, s.h) * 2;
    }
  }
  return bytes / (1024 * 1024);
}
