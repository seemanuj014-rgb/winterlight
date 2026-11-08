// Phase 14: the shader for chimney smoke and cup steam. Plain strings, no three import. One shader for both: a stateless puff (a pure function of time), like the
// snow, so there is no per-frame buffer upload. Each puff has three seeds in `position` (age offset, phase, spread). No texture, no ink.
// three.js adds modelMatrix, viewMatrix, projectionMatrix and `position` in front of this.

export const PLUME_VERT = /* glsl */ `
uniform float uTime;        // seconds
uniform float uLife;        // seconds a puff takes to rise and fade
uniform float uHeight;      // metres it rises
uniform float uSpread;      // metres it wanders sideways at the top
uniform float uWind;        // metres the top is carried along +x
uniform float uSize;        // pixels at 8 metres, at pixel ratio 1
uniform float uGrow;        // how much bigger a puff is at the end of its life
uniform float uSway;        // 0 or 1
uniform float uPixelRatio;
uniform float uAlpha;
uniform vec3 uOrigin;       // where puffs are born (object space)
varying float vAlpha;
void main() {
  float age = fract(uTime / uLife + position.x);
  float wob = sin(uTime * 0.7 + position.y * 6.2832 + age * 3.0) * uSway;
  vec3 p = uOrigin;
  p.y += age * uHeight;
  p.x += uWind * age * age + wob * uSpread * age + (position.z - 0.5) * uSpread * 0.5 * age;
  p.z += cos(uTime * 0.6 + position.y * 6.2832) * uSway * uSpread * 0.5 * age + (position.y - 0.5) * uSpread * 0.3 * age;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.1);
  gl_PointSize = clamp(uSize * (0.45 + uGrow * age) * uPixelRatio * (8.0 / depth), 1.0, 90.0 * uPixelRatio);
  // fades in over the first tenth of its life and out over the last half; a puff right at the lens goes away
  vAlpha = uAlpha * smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.45, 1.0, age)) * smoothstep(0.3, 1.5, depth);
}
`;

export const PLUME_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.1, d) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;
