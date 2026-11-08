// Phase 13: the shader source for the ground, the snowfall, the pines and their blob shadows. Plain strings, no three import, so tests can read them without the renderer. three.js adds the usual uniforms and attributes (modelMatrix, viewMatrix,
// projectionMatrix, cameraPosition, position, normal, instanceMatrix) in front of these. None of them read a texture; none draws an ink line
// (AD: the background drops the outline; the key props, Phase 14, get it).

import { HEIGHT_MIST_GLSL } from './lightingMath';

/** shared: 0..1 hash, and a one-8-bit-step dither so dark blue does not band on a phone screen */
const COMMON = /* glsl */ `
float hash12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float hash22x(vec2 p) { return fract(sin(dot(p, vec2(39.346, 11.135))) * 24634.6345); }
float hash22y(vec2 p) { return fract(sin(dot(p, vec2(73.156, 52.235))) * 31337.1337); }
uniform vec3 uMistColor;
${HEIGHT_MIST_GLSL}
// three soft steps, like the toon ramp of the characters: dark, middle, light, with soft edges
float ramp3(float x) {
  return 0.34 * smoothstep(0.14, 0.30, x) + 0.33 * smoothstep(0.42, 0.58, x) + 0.33 * smoothstep(0.70, 0.86, x);
}
`;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export const TERRAIN_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShadow;
uniform vec3 uFog;
uniform vec3 uMoonDir;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogMax;
uniform float uTime;       // 0 when motion is reduced: the glints stay where they are
uniform float uSparkle;    // 0..1 by tier
varying vec3 vWorld;
varying vec3 vNormal;
${COMMON}
void main() {
  vec3 N = normalize(vNormal);
  float ndl = dot(N, uMoonDir);
  // the moon stands ahead and a little left: drifts that face it catch the light, the sides that face us sit in blue shade
  float t = ramp3(smoothstep(0.10, 0.62, ndl));
  vec3 col = mix(uShadow, uLit, t);

  float dist = length(vWorld - cameraPosition);

  // glitter: one soft dot in a few cells of a fine world-space grid, blinking slowly; fades out before it can alias
  float cellSize = 0.075;
  vec2 g = vWorld.xz / cellSize;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash12(id);
  float on = step(0.972, h);
  vec2 off = (vec2(hash22x(id), hash22y(id)) - 0.5) * 0.5;
  float d = length(f - off);
  float dotA = smoothstep(0.2, 0.0, d);
  float blink = 0.5 + 0.5 * sin(uTime * (1.2 + 2.6 * hash22x(id + 3.1)) + h * 90.0);
  blink = smoothstep(0.35, 0.95, blink);
  float near = smoothstep(17.0, 4.0, dist);
  float glint = on * dotA * blink * near * uSparkle * (0.35 + 0.65 * t);
  col += vec3(0.88, 0.96, 1.0) * glint * 0.9;

  // distance: the snow cools and melts into the haze at the foot of the nearest mountains
  float fog = smoothstep(uFogNear, uFogFar, dist) * uFogMax;
  col = mix(col, uFog, fog);
  // Phase 15: a low cool mist on top of the distance haze, thick at the snow and thin above head height
  col = mix(col, uMistColor, heightMist(vWorld, cameraPosition));

  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Snowfall: every flake's place is a pure function of time, so there is no per-frame upload, no state and no CPU work per flake
// ---------------------------------------------------------------------------

export const SNOW_VERT = /* glsl */ `
attribute float aSpeed;
attribute float aSize;
attribute float aPhase;
attribute float aWindK;
uniform float uTime;        // seconds
uniform float uFall;        // fall speed scale (reduced motion: slower)
uniform float uWind;        // metres the air has been carried sideways since t = 0
uniform float uSway;        // 0 or 1
uniform vec3 uBox;          // width, depth, height of the box of air
uniform vec3 uCenter;       // where the middle of the box is (follows the camera)
uniform float uPixelRatio;
varying float vAlpha;
void main() {
  vec3 p = position; // the flake's place in the box, 0..1 on each axis (three.js supplies position)
  float sway = sin(uTime * (0.6 + aWindK * 0.5) + aPhase) * 0.3 * uSway;
  // fall, wind and sway, wrapped round the box; the box follows the camera so the air is everywhere she looks
  float py = fract(p.y - uTime * uFall * aSpeed / uBox.y);
  float px = fract(p.x + (uWind * aWindK + sway - uCenter.x) / uBox.x);
  float pz = fract(p.z + (sway * 0.6 - uCenter.z) / uBox.z);
  vec3 world = vec3(uCenter.x + (px - 0.5) * uBox.x, py * uBox.y, uCenter.z + (pz - 0.5) * uBox.z);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.1);
  // size shrinks with distance; a flake right at the lens is large, faint and out of focus
  float px_size = aSize * uPixelRatio * clamp(9.0 / depth, 0.35, 2.4);
  gl_PointSize = clamp(px_size, 1.0, 14.0 * uPixelRatio);
  float nearFade = smoothstep(0.4, 2.2, depth);
  float farFade = smoothstep(46.0, 24.0, depth);
  float topFade = smoothstep(uBox.y, uBox.y - 2.0, world.y);
  float botFade = smoothstep(0.0, 0.8, world.y);
  vAlpha = nearFade * farFade * topFade * botFade * (0.45 + 0.4 * clamp(depth / 6.0, 0.0, 1.0));
}
`;

export const SNOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.25, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Pines: one instanced mesh. Toon ramp from the moon, snow on the upper face of every tier with a scalloped edge, gentle sway, haze with distance
// ---------------------------------------------------------------------------

export const PINE_VERT = /* glsl */ `
attribute float aSnow;
attribute float aTier;
attribute float aPhase;     // per instance
uniform float uTime;
uniform float uSway;        // 0 under reduced motion
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vWorld;
varying float vSnow;
varying float vTier;
void main() {
  vec3 p = position;
  // the crown leans and settles; the foot does not move (y squared), and no two trees agree
  float bend = (sin(uTime * 0.8 + aPhase) * 0.6 + sin(uTime * 1.7 + aPhase * 2.3) * 0.25) * uSway * p.y * p.y;
  p.x += bend * 0.02;
  p.z += bend * 0.008;
  vLocal = position;
  vSnow = aSnow;
  vTier = aTier;
  // the instance matrix is rotation times scale: undo the scale before turning the normal
  vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  mat3 R = mat3(instanceMatrix[0].xyz / s.x, instanceMatrix[1].xyz / s.y, instanceMatrix[2].xyz / s.z);
  vNormal = normalize(mat3(modelMatrix) * (R * (normal / s)));
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const PINE_FRAG = /* glsl */ `
uniform vec3 uPine;
uniform vec3 uSnowLit;
uniform vec3 uSnowShadow;
uniform vec3 uFog;
uniform vec3 uMoonDir;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogMax;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vWorld;
varying float vSnow;
varying float vTier;
${COMMON}
void main() {
  vec3 N = normalize(vNormal);
  float ndl = dot(N, uMoonDir);
  float t = ramp3(smoothstep(-0.10, 0.60, ndl));
  // the dark needles: a deep green-grey that never goes black, so the trees still read against the night
  vec3 needles = uPine * mix(0.62, 1.55, t);
  // snow on the top of every tier; its lower edge scallops (a few slow waves round the tree, different on every tier)
  float ang = atan(vLocal.z, vLocal.x);
  float edge = 0.52 + 0.2 * sin(ang * 3.0 + vTier * 9.0) + 0.1 * sin(ang * 7.0 + vTier * 4.0);
  float snow = smoothstep(edge - 0.07, edge + 0.07, vSnow) * step(0.02, N.y + 0.12);
  vec3 snowCol = mix(uSnowShadow, uSnowLit, t);
  vec3 col = mix(needles, snowCol, snow);
  float dist = length(vWorld - cameraPosition);
  float fog = smoothstep(uFogNear, uFogFar, dist) * uFogMax;
  col = mix(col, uFog, fog);
  // Phase 15: a low cool mist on top of the distance haze, thick at the snow and thin above head height
  col = mix(col, uMistColor, heightMist(vWorld, cameraPosition));
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Blob shadows
// ---------------------------------------------------------------------------

export const SHADOW_VERT = /* glsl */ `
attribute float aEdge;
varying float vEdge;
varying vec3 vWorld;
void main() {
  vEdge = aEdge;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SHADOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
varying float vEdge;
varying vec3 vWorld;
void main() {
  float a = pow(1.0 - clamp(vEdge, 0.0, 1.0), 1.6) * 0.5;
  float dist = length(vWorld - cameraPosition);
  a *= 1.0 - smoothstep(uFogNear, uFogFar, dist) * 0.8;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;
