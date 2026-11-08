// Phase 7: one eye, drawn on a patch that lies on the head. Four layers measured from her drawing (tools/trace_face.py):
//   uEye.r  the eye's body (near-black disc, soft alpha)     uEye.g  the white marks (rounded triangle + thin top arc)
//   uEye.b  the pale-blue tab at the bottom                  uEye.a  the grey shade inside the black
//   uBrow   the brow ink
// The marks are the light's, not the eye's: they are sampled at a spot that only the light moves (uLight), so when the eye looks
// elsewhere the shade inside the black slides (a few pixels, clipped by the disc) and the marks stay where they are.
uniform sampler2D uEye;
uniform sampler2D uBrow;
uniform vec2 uGaze;      // uv shift of the shade, already limited by the caller
uniform vec2 uLight;     // uv shift of the marks (the head turning under a fixed light)
uniform float uBlink;    // 0 open .. 1 closed
uniform vec3 uBlack;     // linear colours from character/palette.json
uniform vec3 uWhite;
uniform vec3 uTab;
uniform vec3 uInk;
varying vec2 vUv;

void main() {
  // A blink squashes the eye about its middle into a thin, gently curved line (her ink weight); the brow stays.
  float s = mix(1.0, 0.085, smoothstep(0.0, 1.0, uBlink));
  float bend = 0.10 * uBlink * (vUv.x - 0.5) * (vUv.x - 0.5) * 4.0;
  vec2 q = vec2(vUv.x, 0.5 + (vUv.y - 0.5 - bend) / s);
  float inside = step(0.0, q.y) * step(q.y, 1.0);

  vec4 body = texture2D(uEye, q) * inside; // the disc itself never moves: the eye cannot leave the head
  float shade = texture2D(uEye, q - uGaze).a * inside;
  vec4 marks = texture2D(uEye, q - uLight) * inside;
  float fade = 1.0 - smoothstep(0.15, 0.6, uBlink);

  vec3 tone = max(uBlack, vec3(pow(shade, 2.2)));
  vec3 col = tone;
  float a = body.r;
  float tab = marks.b * fade;
  float white = marks.g * fade;
  col = mix(col, uTab, tab);
  a = max(a, tab);
  col = mix(col, uWhite, white);
  a = max(a, white);

  float brow = texture2D(uBrow, vUv).r;
  col = mix(col, uInk, brow);
  a = max(a, brow);

  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
