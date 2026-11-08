// Phase 15: the post pass shaders. Plain strings, no three import. They read no texture except the render targets of the pass itself (no noise or lookup textures).
// Every pass draws ONE big triangle that covers the screen (3 vertices; no quad seam, no second triangle).
// three.js adds `position`, the matrices and the colour-space functions in front of these. The scene arrives in LINEAR light (a half-float target);
// the scene arrives ALREADY ENCODED for the display (see post.ts for why: soft things must blend in the same space as on the low tier), so nothing here converts colour space.

export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5; // the triangle's corners are (-1,-1) (3,-1) (-1,3): the part inside the screen spans 0..1
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Bright pass + downsample: four taps round the pixel (a 4x4 footprint of the full buffer), each one filtered BEFORE it is averaged, so a single hot pixel cannot flare. */
export const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;      // one texel of the SOURCE
uniform float uThreshold;
uniform float uKnee;
uniform vec2 uChroma;
varying vec2 vUv;
vec3 pick(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float bright = smoothstep(uThreshold - uKnee, uThreshold + uKnee, mx);
  float coloured = smoothstep(uChroma.x, uChroma.y, mx - mn);
  return c * bright * coloured;
}
void main() {
  vec3 a = pick(texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  vec3 b = pick(texture2D(tSource, vUv + uTexel * vec2( 1.0, -1.0)).rgb);
  vec3 c = pick(texture2D(tSource, vUv + uTexel * vec2(-1.0,  1.0)).rgb);
  vec3 d = pick(texture2D(tSource, vUv + uTexel * vec2( 1.0,  1.0)).rgb);
  gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
}
`;

/** A plain 2x2 average down to the next level (the second, wider bloom level on the high tier). */
export const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(tSource, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  vec3 b = texture2D(tSource, vUv + uTexel * vec2( 0.5, -0.5)).rgb;
  vec3 c = texture2D(tSource, vUv + uTexel * vec2(-0.5,  0.5)).rgb;
  vec3 d = texture2D(tSource, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
}
`;

/** One direction of a separable Gaussian: five bilinear taps standing for nine. */
export const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uStep;       // direction * radius * texel of this level
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(tSource, vUv).rgb * 0.2270270270;
  sum += (texture2D(tSource, vUv + uStep * 1.3846153846).rgb + texture2D(tSource, vUv - uStep * 1.3846153846).rgb) * 0.3162162162;
  sum += (texture2D(tSource, vUv + uStep * 3.2307692308).rgb + texture2D(tSource, vUv - uStep * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}
`;

/** Scene + bloom, then the grade (the values are display-encoded already, so the grade pivots on 0.46, the encoded mid grey). The grade block is skipped by a uniform when the tier has none (mid). */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform vec2 uBloom;       // strength of level 0 and level 1 (0 = not drawn)
uniform float uGrade;      // 0 = no grade
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uSplit;
uniform float uVignette;
uniform float uVignetteStart;
uniform vec2 uAspect;      // min(1, aspect), min(1, 1/aspect)
uniform float uDither;
varying vec2 vUv;
float hash12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  if (uBloom.x > 0.0) col += texture2D(tBloom0, vUv).rgb * uBloom.x;
  if (uBloom.y > 0.0) col += texture2D(tBloom1, vUv).rgb * uBloom.y;
  if (uGrade > 0.5) {
    col *= uExposure;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float sh = (1.0 - smoothstep(0.0, 0.35, lum)) * uSplit;
    float hi = smoothstep(0.45, 1.0, lum) * uSplit;
    col *= (vec3(1.0) + (uShadowTint - 1.0) * sh) * (vec3(1.0) + (uHighlightTint - 1.0) * hi);
    float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = vec3(l2) + (col - vec3(l2)) * uSaturation;
    col = vec3(0.46) + (col - vec3(0.46)) * uContrast;
    vec2 d = (vUv - 0.5) * 2.0 * uAspect;
    float r = length(d) * 0.70710678;
    col *= 1.0 - uVignette * smoothstep(uVignetteStart, 1.0, r);
    col = max(col, vec3(0.0));
  }
  col += (hash12(gl_FragCoord.xy) - 0.5) * (uDither / 255.0);
  gl_FragColor = vec4(col, 1.0);
}
`;
