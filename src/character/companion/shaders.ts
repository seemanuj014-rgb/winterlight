// Phase 16: the face of the cat and the snow bunny, drawn procedurally (no textures) on small patches that lie on the head.
// Same eye language as Chamgadad's drawing, so they look drawn by the same hand: a big glossy near-black oval, a white rounded-triangle highlight
// on the viewer-left, a thin white arc along the top, a small pale-blue tab at the bottom edge, a grey shade inside the black that follows the gaze.
// A blink squashes the eye to a thin gently curved ink line (the same maths as hers). The nose is a small rounded triangle with an ink edge; it can twitch.
// These are strings only (no three import) so a test can read them. The numbers are mine `[A]`: they are ours to design, not from her drawing.

export const FACE_VERT = /* glsl */ `
attribute float aKind;          // 0 = eye, 1 = nose
uniform vec3 uNoseShift;        // head-local metres: the nose twitching
varying vec2 vUv;
varying float vKind;
void main() {
  vUv = uv;
  vKind = aKind;
  vec3 p = position;
  if (aKind > 0.5) p += uNoseShift;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const FACE_FRAG = /* glsl */ `
uniform float uBlink;   // 0 open .. 1 closed
uniform vec2 uGaze;     // -1..1, already limited by the caller
uniform vec3 uBlack;
uniform vec3 uWhite;
uniform vec3 uTab;
uniform vec3 uShade;
uniform vec3 uNose;
uniform vec3 uInk;
varying vec2 vUv;
varying float vKind;

// equilateral triangle, point up, radius r (inigo quilez), distance field
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  if (vKind > 0.5) {
    // the nose: a soft triangle pointing down, ink at the edge
    vec2 p = (vUv - 0.5) * 2.0;
    float d = sdTri(vec2(p.x, -p.y + 0.12), 0.62) - 0.2;
    float aa = max(fwidth(d), 0.001);
    float fill = 1.0 - smoothstep(-aa, aa, d);
    float inner = 1.0 - smoothstep(-aa, aa, d + 0.24);
    if (fill < 0.003) discard;
    gl_FragColor = vec4(mix(uInk, uNose, inner), fill);
    #include <colorspace_fragment>
    return;
  }
  // a blink squashes the eye about its middle into a thin, gently curved line
  float s = mix(1.0, 0.085, smoothstep(0.0, 1.0, uBlink));
  float bend = 0.10 * uBlink * (vUv.x - 0.5) * (vUv.x - 0.5) * 4.0;
  vec2 q = vec2(vUv.x, 0.5 + (vUv.y - 0.5 - bend) / s);
  float inside = step(0.0, q.y) * step(q.y, 1.0);
  vec2 p = (q - 0.5) * 2.0;

  float e = length(p / vec2(0.94, 0.97));
  float aa = max(fwidth(e), 0.002);
  float body = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, e)) * inside;

  // the grey shade inside the black slides with the gaze (the marks below stay where the light puts them)
  float sh = length((p - uGaze * vec2(0.16, 0.14) - vec2(0.06, -0.10)) / vec2(0.66, 0.72));
  vec3 col = mix(uBlack, uShade, (1.0 - smoothstep(0.15, 1.0, sh)) * 0.85);

  float fade = 1.0 - smoothstep(0.15, 0.6, uBlink);
  // white rounded triangle, upper left
  float th = sdTri((p - vec2(-0.27, 0.30)) * vec2(1.0, 1.0), 0.27) - 0.1;
  float taa = max(fwidth(th), 0.002);
  float tri = (1.0 - smoothstep(-taa, taa, th)) * fade;
  // thin arc along the top
  float ring = abs(length(p / vec2(0.94, 0.97)) - 0.80);
  float arcMask = smoothstep(0.35, 0.18, abs(p.x - 0.12)) * step(0.0, p.y - 0.28);
  float arc = (1.0 - smoothstep(0.02, 0.02 + 2.5 * taa, ring)) * arcMask * fade;
  // pale tab at the bottom edge
  vec2 tb = abs(p - vec2(0.0, -0.74)) - vec2(0.2, 0.07);
  float tabD = length(max(tb, 0.0)) + min(max(tb.x, tb.y), 0.0) - 0.04;
  float tab = (1.0 - smoothstep(-taa, taa, tabD)) * fade;

  col = mix(col, uTab, tab * body);
  col = mix(col, uWhite, max(tri, arc) * body);
  if (body < 0.003) discard;
  gl_FragColor = vec4(col, body);
  #include <colorspace_fragment>
}
`;
