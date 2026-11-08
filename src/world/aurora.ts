import * as THREE from 'three';
import { AURORA, type Tier } from './backdropMath';

// Phase 12: the aurora. ONE mesh, one draw call: a gently curved strip on the sky behind the mountains, with a fragment shader that draws a
// soft curtain (teal at its foot, violet higher, a rare drifting touch of pink). It is a flat painted ribbon, not a volume, and it is soft on
// purpose; bloom (Phase 15) will lift only its brightest parts. Colours from ART_DIRECTION: teal `#58e0c0`, violet `#9a86ff`, pink `#f0a0d0`.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform int uOctaves;
uniform vec3 uTeal;
uniform vec3 uViolet;
uniform vec3 uPink;
varying vec2 vUv; // x: along the sky (0..1), y: up the curtain (0..1)

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    if (i >= uOctaves) break;
    s += a * vnoise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}

void main() {
  float x = vUv.x;
  float y = vUv.y;
  float t = uTime;

  // the curtain's lower edge wanders slowly along the sky; its body rises from it
  float wander = 0.30 + 0.12 * sin(x * 5.0 + t * 0.07) + 0.07 * sin(x * 11.0 - t * 0.11) + 0.06 * (fbm(vec2(x * 3.0, t * 0.03)) - 0.5);
  float up = (y - wander) / 0.5;                 // 0 at the foot, 1 half a strip higher
  float body = smoothstep(-0.07, 0.07, up) * (1.0 - smoothstep(0.35, 1.25, up));

  // vertical rays: stripes along the curtain that slide very slowly and breathe
  float rays = fbm(vec2(x * 42.0 + t * 0.05, t * 0.04));
  rays = 0.5 + 1.1 * smoothstep(0.2, 0.85, rays);
  float breathe = 0.78 + 0.22 * sin(t * 0.19 + x * 7.0);
  // brightest at the foot, fading as it climbs; and the curtain thins out toward both ends of the strip
  float fade = pow(clamp(1.0 - max(up, 0.0) * 0.8, 0.0, 1.0), 1.4);
  float ends = smoothstep(0.0, 0.2, x) * (1.0 - smoothstep(0.8, 1.0, x));
  float intensity = body * rays * breathe * fade * ends;

  // colour: teal low, violet high, and a rare pink patch that drifts along the strip
  vec3 col = mix(uTeal, uViolet, smoothstep(0.1, 0.9, up));
  float pinkAt = 0.5 + 0.35 * sin(t * 0.021);
  float pinkMask = exp(-pow((x - pinkAt) * 7.0, 2.0)) * smoothstep(0.35, 0.9, up);
  col = mix(col, uPink, pinkMask * 0.7);
  // a faint second, higher and fainter veil so the sky is not just one band
  float veil = smoothstep(0.55, 0.9, y) * (1.0 - smoothstep(0.9, 1.0, y)) * fbm(vec2(x * 6.0 - t * 0.02, y * 4.0)) * 0.28 * ends;

  float a = clamp(intensity * 0.95 + veil, 0.0, 1.0) * uStrength;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export interface Aurora {
  mesh: THREE.Mesh;
  update(tSec: number): void;
  setTier(tier: Tier): void;
  /** Phase 28: the finale makes it bigger and brighter. `gain` multiplies its strength (1 = as always); the tier's own strength stays the base. */
  setGain(gain: number): void;
  dispose(): void;
}

export interface AuroraOptions {
  tier: Tier;
  reducedMotion: boolean;
}

/** A frozen moment that looks good, used under reduced motion (seconds of aurora time). */
const FROZEN_T = 37;

export function createAurora(opts: AuroraOptions): Aurora {
  let tierNow: Tier = opts.tier;
  let gain = 1;
  // a curved strip: an arc of a cylinder centred on the eye, so it is the same distance from the eye everywhere
  const seg = AURORA.segments;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const b = (AURORA.bottomDeg * Math.PI) / 180;
  const tp = (AURORA.topDeg * Math.PI) / 180;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const az = ((AURORA.azimuthDeg + (u * 2 - 1) * AURORA.halfAzimuthDeg) * Math.PI) / 180;
    for (let k = 0; k < 2; k++) {
      const el = k === 0 ? b : tp;
      // on a sphere of radius `dist`, so the strip bends with the dome
      const r = AURORA.dist;
      pos.push(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, -Math.cos(az) * Math.cos(el) * r);
      uv.push(u, k);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: FROZEN_T },
      uStrength: { value: AURORA.strength[opts.tier] },
      uOctaves: { value: AURORA.octaves[opts.tier] },
      uTeal: { value: new THREE.Color(AURORA.teal) },
      uViolet: { value: new THREE.Color(AURORA.violet) },
      uPink: { value: new THREE.Color(AURORA.pink) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'aurora';
  mesh.renderOrder = -85;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(tSec) {
      mat.uniforms.uTime!.value = opts.reducedMotion ? FROZEN_T : FROZEN_T + tSec * AURORA.speed;
    },
    setTier(tier) {
      tierNow = tier;
      mat.uniforms.uStrength!.value = AURORA.strength[tier] * gain;
      mat.uniforms.uOctaves!.value = AURORA.octaves[tier];
    },
    setGain(g) {
      gain = Number.isFinite(g) ? Math.min(4, Math.max(0, g)) : 1;
      mat.uniforms.uStrength!.value = AURORA.strength[tierNow] * gain;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
