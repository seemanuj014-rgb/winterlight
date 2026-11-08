// Phase 25: the flames and the smoke wisps, as one Points object (one draw call). Plain strings, no three import. A flame is a teardrop cut out of a point sprite by the
// fragment shader (warm core #ffd9a0 into the edge #ffb86b, AD), leaning with the breath and flickering on its own; a wisp is a soft grey puff that rises after a flame is out.
// Per point: `aKind` 0 flame / 1 wisp, `aSeed`, `aFlame` 0..1 (how alight), `aBend` 0..1 (how hard the breath leans it), `aAge` seconds since the smoke began (-1 = none).
export const FLAME_VERT = /* glsl */ `
attribute float aKind;
attribute float aSeed;
attribute float aFlame;
attribute float aBend;
attribute float aAge;
uniform float uTime;
uniform float uProj;        // pixels per metre at one metre: viewHeightPx / (2 tan(fov / 2)), already times the pixel ratio
uniform float uHeight;      // flame height in metres
uniform float uSprite;      // sprite size in flame heights
uniform float uShow;        // 0..1 the whole thing fades in with the cake
uniform float uCalm;        // 1 = reduced motion: a steady flame
uniform float uWispLife;
uniform float uWispRise;
varying float vKind;
varying float vAlpha;
varying float vBend;
varying float vSeed;
varying float vFlame;
void main() {
  vKind = aKind;
  vBend = aBend;
  vSeed = aSeed;
  vFlame = aFlame;
  vec3 p = position;
  float sizeM;
  if (aKind < 0.5) {
    float fl = 1.0 + (1.0 - 0.85 * uCalm) * (0.07 * sin(uTime * 13.0 + aSeed * 40.0) + 0.05 * sin(uTime * 23.0 + aSeed * 17.0) + 0.1 * aBend * sin(uTime * 41.0 + aSeed * 9.0));
    float lean = 1.0 - 0.35 * aBend;
    sizeM = uHeight * uSprite * (0.35 + 0.65 * aFlame) * fl * lean;
    // the sprite's middle sits at the flame's middle; the flame is the lower-middle part of the sprite
    p.y += uHeight * 0.45 * lean * (0.4 + 0.6 * aFlame);
    vAlpha = aFlame * uShow;
  } else {
    float life = max(uWispLife, 0.1);
    float a = aAge < 0.0 ? 1.0 : clamp(aAge / life, 0.0, 1.0);
    sizeM = 0.02 + 0.06 * a;
    p.y += uWispRise * a + 0.012;
    p.x += sin(uTime * 0.9 + aSeed * 30.0 + a * 4.0) * 0.02 * a * (1.0 - 0.7 * uCalm);
    vAlpha = aAge < 0.0 ? 0.0 : 0.38 * smoothstep(0.0, 0.12, a) * (1.0 - smoothstep(0.35, 1.0, a)) * uShow;
  }
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(sizeM * uProj / max(-mv.z, 0.2), 1.0, 160.0);
}
`;

export const FLAME_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uEdge;
uniform vec3 uWisp;
uniform float uTime;
uniform float uCalm;
varying float vKind;
varying float vAlpha;
varying float vBend;
varying float vSeed;
varying float vFlame;
void main() {
  vec2 c = gl_PointCoord;
  float xx = (c.x - 0.5) * 2.0;
  if (vKind > 0.5) {
    float d = length(vec2(xx, (0.5 - c.y) * 2.0));
    float a = smoothstep(1.0, 0.05, d) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uWisp, a);
    #include <colorspace_fragment>
    return;
  }
  // flame: t runs 0 at the foot to 1 at the tip across the middle of the sprite
  float yy = 1.0 - c.y;
  float t = (yy - 0.3) / 0.4;
  if (t < -0.15 || t > 1.05) discard;
  float tt = clamp(t, 0.0, 1.0);
  float sway = sin(uTime * 7.0 + vSeed * 31.0) * 0.03 * (1.0 - uCalm);
  float sx = (vBend * 0.34 + sway) * tt * tt;
  float w = 0.17 * pow(sin(3.14159 * pow(tt, 0.65) + 0.0001), 0.8) * (1.0 - 0.25 * tt) + 0.02 * (1.0 - tt);
  float d = abs(xx - sx);
  float mask = smoothstep(w, w * 0.55, d) * smoothstep(-0.15, 0.05, t) * smoothstep(1.05, 0.9, t);
  float coreK = smoothstep(w * 0.8, 0.0, d) * (1.0 - 0.55 * tt);
  vec3 col = mix(uEdge, uCore, coreK);
  float a = mask * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
