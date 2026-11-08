import * as THREE from 'three';
import { GLITTER, glitterCount, makeGlitter, GLITTER_COUNT, type Tier } from './glitterMath';

// Phase 26: the snow-glitter burst. ONE Points object, ONE draw call. Every spark's place and brightness is a pure function of the seconds since the burst, worked out in the vertex
// shader from its launch numbers (`glitterMath.ts` has the same formulas for the tests), so nothing is uploaded per frame. Tiny soft sparks with a four-point twinkle cross, frost
// white with some warm and some ice blue. A smaller tier (or reduced motion) draws the first part of the buffer.

export interface GlitterBurst {
  points: THREE.Points;
  readonly count: number;
  /** where the burst goes off (world) */
  setOrigin(x: number, y: number, z: number): void;
  /** `sinceBurst` = seconds after the burst; negative or past the life = nothing drawn */
  update(sinceBurst: number): void;
  setPixelRatio(pr: number): void;
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute float aSize;
attribute float aPhase;
attribute float aTwinkle;
attribute float aTint;
attribute float aDelay;
uniform float uT;
uniform vec3 uOrigin;
uniform float uPixelRatio;
uniform float uCalm;
uniform float uDrag;
uniform float uGravity;
uniform float uLife;
varying float vAlpha;
varying float vTint;
void main() {
  float tt = uT - aDelay;
  vTint = aTint;
  if (tt <= 0.0 || tt >= uLife) {
    vAlpha = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float run = (1.0 - exp(-uDrag * tt)) / uDrag;
  vec3 p = uOrigin + aVel * run;
  p.y -= 0.5 * uGravity * tt * tt;
  float u = tt / uLife;
  float tw = mix(0.62 + 0.38 * sin(aTwinkle * tt * 6.2831853 + aPhase), 1.0, uCalm);
  vAlpha = clamp(min(1.0, tt / 0.12) * (1.0 - pow(u, 1.6)) * tw, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (0.7 + 0.3 * tw);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uFrost;
uniform vec3 uWarm;
uniform vec3 uIce;
varying float vAlpha;
varying float vTint;
void main() {
  if (vAlpha < 0.01) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  // a soft dot with a faint four-point cross through it
  float dot_ = smoothstep(1.0, 0.0, d);
  float cross_ = smoothstep(0.12, 0.0, min(abs(c.x), abs(c.y))) * smoothstep(1.0, 0.1, d) * 0.55;
  float a = (dot_ * dot_ + cross_) * vAlpha;
  if (a < 0.01) discard;
  vec3 col = vTint < 0.5 ? uFrost : (vTint < 1.5 ? uWarm : uIce);
  gl_FragColor = vec4(col, min(1.0, a));
  #include <colorspace_fragment>
}
`;

export function createGlitter(opts: { tier: Tier; reducedMotion: boolean; pixelRatio?: number }): GlitterBurst {
  let tier = opts.tier;
  let reduced = opts.reducedMotion;
  const g = makeGlitter(52, GLITTER_COUNT.high);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.count * 3), 3));
  geo.setAttribute('aVel', new THREE.BufferAttribute(g.vel, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(g.size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(g.phase, 1));
  geo.setAttribute('aTwinkle', new THREE.BufferAttribute(g.twinkle, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(g.tint, 1));
  geo.setAttribute('aDelay', new THREE.BufferAttribute(g.delay, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uT: { value: -1 },
      uOrigin: { value: new THREE.Vector3() },
      uPixelRatio: { value: opts.pixelRatio ?? 1 },
      uCalm: { value: reduced ? 1 : 0 },
      uDrag: { value: GLITTER.drag },
      uGravity: { value: GLITTER.gravity },
      uLife: { value: GLITTER.lifeS },
      uFrost: { value: new THREE.Color(GLITTER.frost) },
      uWarm: { value: new THREE.Color(GLITTER.warm) },
      uIce: { value: new THREE.Color(GLITTER.ice) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'glitter';
  points.frustumCulled = false;
  points.renderOrder = 5;
  let count = 0;
  const apply = (): void => {
    count = glitterCount(tier, reduced);
    geo.setDrawRange(0, count);
    mat.uniforms.uCalm!.value = reduced ? 1 : 0;
  };
  apply();
  return {
    points,
    get count() {
      return count;
    },
    setOrigin(x, y, z) {
      (mat.uniforms.uOrigin!.value as THREE.Vector3).set(x, y, z);
    },
    update(since) {
      mat.uniforms.uT!.value = Number.isFinite(since) ? since : -1;
    },
    setPixelRatio(pr) {
      mat.uniforms.uPixelRatio!.value = pr;
    },
    setTier(next) {
      tier = next;
      apply();
    },
    setReducedMotion(on) {
      reduced = on;
      apply();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      points.removeFromParent();
    },
  };
}
