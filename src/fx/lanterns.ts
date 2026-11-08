import * as THREE from 'three';
import { lanternCount, lanternPose, makeLanterns, LANTERN_COUNT, type Lantern, type Tier } from './lanternMath';

// Phase 26: the paper lanterns. ONE InstancedMesh (one draw call) for the paper, ONE Points object (one draw call, one point per lantern) for the soft halo round each flame.
// The poses come from `lanternMath.ts` (a pure function of time), written into the instance matrices each frame: at most 18 lanterns, so that is a few hundred multiplies.
// The paper is a six-sided, slightly tapered tube, brighter near its foot (the flame is inside), warm amber, emissive (no lights, no texture). The halo is an additive soft dot
// that the bloom of the mid and high tiers turns into a real glow; at the low tier (no post) the dot alone does the job.

export interface Lanterns {
  root: THREE.Group;
  /** lanterns drawn right now */
  readonly count: number;
  /** where the table's top is in the world: the lanterns lift off from here */
  setOrigin(x: number, y: number, z: number): void;
  /** `tSec` = seconds after the START of the release (the hush included) */
  update(tSec: number): void;
  setView(heightPx: number, fovDeg: number, pixelRatio: number): void;
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  stats(): { drawCalls: number; instances: number; particles: number; triangles: number };
  dispose(): void;
}

const PAPER_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aGlow;
attribute float aWarm;
varying float vAlpha;
varying float vGlow;
varying float vWarm;
varying float vY;
varying vec3 vN;
void main() {
  vAlpha = aAlpha;
  vGlow = aGlow;
  vWarm = aWarm;
  vY = position.y / 0.3 + 0.5;
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const PAPER_FRAG = /* glsl */ `
varying float vAlpha;
varying float vGlow;
varying float vWarm;
varying float vY;
varying vec3 vN;
void main() {
  if (vAlpha < 0.01) discard;
  vec3 pale = vec3(1.0, 0.80, 0.52);
  vec3 deep = vec3(1.0, 0.62, 0.30);
  vec3 hot = vec3(1.0, 0.93, 0.74);
  vec3 paper = mix(pale, deep, vWarm);
  // the flame is inside, low: the foot of the paper is hottest, the shoulder cooler; the edge turned away from us is a little darker (paper, not a bulb)
  float inside = pow(1.0 - clamp(vY, 0.0, 1.0), 1.4);
  float facing = abs(normalize(vN).z);
  vec3 col = paper * (0.55 + 0.35 * facing) + hot * inside * 0.55 * vGlow;
  col *= 0.25 + 0.95 * vGlow;
  gl_FragColor = vec4(col, vAlpha);
  #include <colorspace_fragment>
}
`;
const HALO_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aGlow;
attribute float aSize;
uniform float uProj;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 0.2);
  gl_PointSize = clamp(uProj * aSize / d, 2.0, 220.0);
  vAlpha = aAlpha * aGlow;
}
`;
const HALO_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = pow(smoothstep(1.0, 0.0, d), 2.2) * vAlpha * 0.5;
  if (a < 0.004) discard;
  gl_FragColor = vec4(1.0, 0.72, 0.38, a);
  #include <colorspace_fragment>
}
`;

export function createLanterns(opts: { tier: Tier; reducedMotion: boolean; pixelRatio?: number }): Lanterns {
  let tier = opts.tier;
  let reduced = opts.reducedMotion;
  const max = LANTERN_COUNT.high;
  const data: Lantern[] = makeLanterns(26, max);
  const root = new THREE.Group();
  root.name = 'lanterns';

  // paper: a tapered six-sided tube, open at the foot, 0.3 m tall
  const paperGeo = new THREE.CylinderGeometry(0.115, 0.085, 0.3, 6, 1, false);
  const alpha = new Float32Array(max);
  const glow = new Float32Array(max);
  const warm = new Float32Array(max);
  for (let i = 0; i < max; i++) warm[i] = data[i]!.warm;
  const aAlpha = new THREE.InstancedBufferAttribute(alpha, 1);
  const aGlow = new THREE.InstancedBufferAttribute(glow, 1);
  paperGeo.setAttribute('aAlpha', aAlpha);
  paperGeo.setAttribute('aGlow', aGlow);
  paperGeo.setAttribute('aWarm', new THREE.InstancedBufferAttribute(warm, 1));
  const paperMat = new THREE.ShaderMaterial({ vertexShader: PAPER_VERT, fragmentShader: PAPER_FRAG, transparent: true, depthWrite: false });
  const paper = new THREE.InstancedMesh(paperGeo, paperMat, max);
  paper.name = 'lantern-paper';
  paper.frustumCulled = false; // they move far from the mesh's own bounds
  paper.renderOrder = 3;
  paper.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(paper);

  // halo: one point per lantern
  const haloPos = new Float32Array(max * 3);
  const haloAlpha = new Float32Array(max);
  const haloGlow = new Float32Array(max);
  const haloSize = new Float32Array(max).fill(0.9);
  const haloGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(haloPos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  haloGeo.setAttribute('position', posAttr);
  const hA = new THREE.BufferAttribute(haloAlpha, 1);
  const hG = new THREE.BufferAttribute(haloGlow, 1);
  hA.setUsage(THREE.DynamicDrawUsage);
  hG.setUsage(THREE.DynamicDrawUsage);
  haloGeo.setAttribute('aAlpha', hA);
  haloGeo.setAttribute('aGlow', hG);
  haloGeo.setAttribute('aSize', new THREE.BufferAttribute(haloSize, 1));
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    uniforms: { uProj: { value: 600 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Points(haloGeo, haloMat);
  halo.name = 'lantern-halo';
  halo.frustumCulled = false;
  halo.renderOrder = 4;
  root.add(halo);

  let origin = new THREE.Vector3();
  let count = lanternCount(tier, reduced);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const apply = (): void => {
    count = lanternCount(tier, reduced);
    paper.count = count;
    haloGeo.setDrawRange(0, count);
  };
  apply();
  paper.count = count;

  return {
    root,
    get count() {
      return count;
    },
    setOrigin(x, y, z) {
      origin = new THREE.Vector3(x, y, z);
    },
    update(tSec) {
      for (let i = 0; i < count; i++) {
        const pose = lanternPose(data[i]!, tSec, reduced, 0);
        if (!pose.visible) {
          s.set(0, 0, 0);
          p.set(0, -100, 0);
          m.compose(p, q.identity(), s);
          alpha[i] = 0;
          glow[i] = 0;
          haloAlpha[i] = 0;
          haloGlow[i] = 0;
        } else {
          p.set(origin.x + pose.x, origin.y + pose.y, origin.z + pose.z);
          e.set(pose.pitch, 0, pose.roll);
          q.setFromEuler(e);
          s.setScalar(pose.scale);
          m.compose(p, q, s);
          alpha[i] = pose.alpha;
          glow[i] = pose.glow;
          haloAlpha[i] = pose.alpha;
          haloGlow[i] = pose.glow;
          // the halo sits at the flame, a little above the foot of the paper
          haloPos[i * 3] = p.x;
          haloPos[i * 3 + 1] = p.y - 0.06 * pose.scale;
          haloPos[i * 3 + 2] = p.z;
          haloSize[i] = 0.9 * pose.scale;
        }
        if (!pose.visible) {
          haloPos[i * 3] = 0;
          haloPos[i * 3 + 1] = -100;
          haloPos[i * 3 + 2] = 0;
        }
        paper.setMatrixAt(i, m);
      }
      paper.instanceMatrix.needsUpdate = true;
      aAlpha.needsUpdate = true;
      aGlow.needsUpdate = true;
      posAttr.needsUpdate = true;
      hA.needsUpdate = true;
      hG.needsUpdate = true;
      (haloGeo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    },
    setView(heightPx, fovDeg, pr) {
      haloMat.uniforms.uProj!.value = (heightPx * pr) / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
    setTier(next) {
      tier = next;
      apply();
    },
    setReducedMotion(on) {
      reduced = on;
      apply();
    },
    stats() {
      return { drawCalls: 2, instances: count, particles: count, triangles: count * 12 + 0 };
    },
    dispose() {
      paperGeo.dispose();
      paperMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      root.removeFromParent();
    },
  };
}
