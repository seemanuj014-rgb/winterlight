import * as THREE from 'three';
import { STAR_COUNT, makeStars, dirFromAngles, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, type Tier } from './backdropMath';

// Phase 12: the sky. A gradient dome (one draw call) and twinkling stars (one draw call, a single Points object).
// Both follow the camera's position (see backdrop.ts), so the sky never parallaxes, only the mountains do.
// Palette from ART_DIRECTION: deep `#0d1b2e`, mid `#1c3556`, horizon glow `#6f86b8`.

export const SKY_RADIUS = 90;
const STAR_RADIUS = 88;

export interface Sky {
  dome: THREE.Mesh;
  stars: THREE.Points;
  /** seconds of sky time: drives the twinkle */
  update(tSec: number): void;
  setPixelRatio(pr: number): void;
  setTier(tier: Tier): void;
  /** how many stars are drawn right now */
  readonly starCount: number;
  dispose(): void;
}

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}
`;

const DOME_FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uMoonDir;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 d = normalize(vDir);
  float e = d.y; // elevation as sin
  // horizon glow -> mid -> deep: a long calm gradient (large flat fills are the style)
  float aMid = smoothstep(-0.05, 0.22, e);
  float aDeep = smoothstep(0.12, 0.72, e);
  vec3 col = mix(uHorizon, uMid, aMid);
  col = mix(col, uDeep, aDeep);
  // the horizon glow is a little brighter toward the moon, as if the snow far away is catching it
  float toMoon = max(dot(d, uMoonDir), 0.0);
  col += uHorizon * 0.10 * pow(toMoon, 6.0) * (1.0 - aDeep);
  // below the horizon the dome is only ever seen through gaps; keep it quiet
  col = mix(col, uMid * 0.8, smoothstep(0.0, -0.3, e) * 0.7);
  // a hair of noise (about one 8-bit step) so dark blue does not band on a phone screen
  float n = hash(gl_FragCoord.xy) - 0.5;
  col += n / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute float aSpeed;
attribute float aDepth;
attribute vec3 aTint;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
  float k = 1.0 - aDepth * (1.0 - tw);          // 1 - depth .. 1
  float elev = smoothstep(0.02, 0.28, normalize(position).y);
  vAlpha = k * elev;
  vTint = aTint;
  gl_PointSize = aSize * uPixelRatio * (0.8 + 0.2 * k);
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vTint;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.5, r);      // small bright core
  float halo = (1.0 - smoothstep(0.0, 1.0, r)) * 0.5; // soft round edge
  float a = (core + halo) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vTint, a);
  #include <colorspace_fragment>
}
`;

export interface SkyOptions {
  tier: Tier;
  reducedMotion: boolean;
  pixelRatio?: number;
}

export function createSky(opts: SkyOptions): Sky {
  // --- dome ---
  const moonDir = dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
  const domeMat = new THREE.ShaderMaterial({
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    uniforms: {
      uDeep: { value: new THREE.Color(0x0d1b2e) },
      uMid: { value: new THREE.Color(0x1c3556) },
      uHorizon: { value: new THREE.Color(0x6f86b8) },
      uMoonDir: { value: new THREE.Vector3(...moonDir) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 20), domeMat);
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  dome.name = 'sky-dome';

  // --- stars: a built-once set sized for the starting tier; a step-down only draws fewer ---
  const built = Math.min(STAR_COUNT[opts.tier], opts.reducedMotion ? Math.round(STAR_COUNT[opts.tier] * 0.6) : STAR_COUNT[opts.tier]);
  const s = makeStars(7, built);
  const pos = new Float32Array(s.count * 3);
  for (let i = 0; i < s.count * 3; i++) pos[i] = s.dir[i]! * STAR_RADIUS;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(s.size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(s.phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(s.speed, 1));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(s.depth, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(s.tint, 3));
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: opts.pixelRatio ?? 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const stars = new THREE.Points(geo, starMat);
  stars.renderOrder = -90;
  stars.frustumCulled = false;
  stars.name = 'stars';
  geo.setDrawRange(0, s.count);

  let drawn = s.count;
  return {
    dome,
    stars,
    update(tSec) {
      // reduced motion: the stars hold still at a pleasant moment (no twinkle)
      starMat.uniforms.uTime!.value = opts.reducedMotion ? 1.3 : tSec;
    },
    setPixelRatio(pr) {
      starMat.uniforms.uPixelRatio!.value = pr;
    },
    setTier(tier) {
      drawn = Math.min(s.count, STAR_COUNT[tier]);
      geo.setDrawRange(0, drawn);
    },
    get starCount() {
      return drawn;
    },
    dispose() {
      dome.geometry.dispose();
      domeMat.dispose();
      geo.dispose();
      starMat.dispose();
    },
  };
}
