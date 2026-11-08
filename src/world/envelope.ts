import * as THREE from 'three';
import { ENV, FLAP_HINGE, FLAME_AT, HOVER, LETTER_REST, buildCarrier, buildFlap, buildLetter, envelopePose, envelopeStats, type EnvelopePose } from './envelopeMath';
import { glowMaterial, toGeometry } from './meshBuild';

// Phase 27: the picture of the envelope: a paper lantern with the envelope hanging from two threads. Draw calls: the carrier (lantern, threads, envelope) 1, the flap 1, the letter 1,
// and one soft halo point round the flame 1 = 4. No textures, no lights, no words. The poses come from `envelopeMath.ts`; this file only moves meshes.
// Unlit vertex colours (like the cabin's lantern): the paper is already warm, and the halo (additive) is what the bloom turns into glow on the mid and high tiers.

export interface Envelope {
  root: THREE.Group;
  /** place the hover spot: the table's top in the world (the hover offset is added here) */
  setTable(x: number, topY: number, z: number): void;
  /** every frame: the machine's own numbers and a clock */
  set(arrive: number, open: number, tSec: number): void;
  /** the last pose handed to `set` */
  pose(): EnvelopePose;
  /** world position of the envelope's centre (for the picker, the focus ring and the test view's tap target) */
  centreWorld(out?: THREE.Vector3): THREE.Vector3;
  /** the envelope's touch target radius in metres (generous: the picker has its own minimum on screen) */
  readonly targetRadius: number;
  /** picker stand-in: it raycasts but never draws (no draw call); it rides the envelope */
  readonly proxy: THREE.Mesh;
  setView(heightPx: number, fovDeg: number, pixelRatio: number): void;
  setReducedMotion(on: boolean): void;
  stats(): { triangles: number; vertices: number; drawCalls: number };
  dispose(): void;
}

const HALO_VERT = /* glsl */ `
uniform float uProj;
uniform float uAlpha;
uniform float uSize;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 0.2);
  gl_PointSize = clamp(uProj * uSize / d, 2.0, 260.0);
  vAlpha = uAlpha;
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

export function createEnvelope(opts: { reducedMotion: boolean; pixelRatio?: number }): Envelope {
  let reduced = opts.reducedMotion;
  const root = new THREE.Group();
  root.name = 'envelope';
  // `rig` is what moves (position, roll, yaw, scale); `root` only holds the table's place
  const rig = new THREE.Group();
  rig.scale.setScalar(ENV.scale);
  root.add(rig);

  const mat = glowMaterial();
  mat.transparent = true;
  const carrierGeo = toGeometry(buildCarrier());
  const carrier = new THREE.Mesh(carrierGeo, mat);
  carrier.name = 'envelope-carrier';
  rig.add(carrier);

  const flapGeo = toGeometry(buildFlap());
  const flapPivot = new THREE.Group();
  flapPivot.position.set(FLAP_HINGE[0], FLAP_HINGE[1], FLAP_HINGE[2]);
  const flap = new THREE.Mesh(flapGeo, mat);
  flap.name = 'envelope-flap';
  flapPivot.add(flap);
  rig.add(flapPivot);

  const letterGeo = toGeometry(buildLetter());
  const letter = new THREE.Mesh(letterGeo, mat);
  letter.name = 'envelope-letter';
  letter.position.set(LETTER_REST[0], LETTER_REST[1], LETTER_REST[2]);
  rig.add(letter);

  // the halo: ONE point, additive, at the flame
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLAME_AT), 3));
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    uniforms: { uProj: { value: 600 }, uAlpha: { value: 0 }, uSize: { value: 0.9 * ENV.scale } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Points(haloGeo, haloMat);
  halo.name = 'envelope-halo';
  halo.frustumCulled = false;
  halo.renderOrder = 4;
  rig.add(halo);

  // picker stand-in: an invisible sphere at the envelope's centre (like the cake's), so the Phase 18 picker can ray-test it
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxyGeo = new THREE.SphereGeometry(0.15, 8, 6);
  const proxy = new THREE.Mesh(proxyGeo, proxyMat);
  proxy.name = 'envelope-proxy';
  rig.add(proxy);

  let table = new THREE.Vector3();
  let last: EnvelopePose = envelopePose(0, 0, 0, reduced);
  const e = new THREE.Euler();

  const api: Envelope = {
    root,
    setTable(x, topY, z) {
      table = new THREE.Vector3(x, topY, z);
      root.position.copy(table).add(new THREE.Vector3(HOVER[0], HOVER[1], HOVER[2]));
    },
    set(arrive, open, tSec) {
      const p = envelopePose(arrive, open, tSec, reduced);
      last = p;
      rig.visible = p.visible;
      if (!p.visible) return;
      rig.position.set(p.x, p.y, p.z);
      e.set(0, p.yaw, p.roll);
      rig.quaternion.setFromEuler(e);
      mat.opacity = p.alpha;
      flapPivot.rotation.x = -p.flap;
      letter.position.y = LETTER_REST[1] + p.letterY;
      haloMat.uniforms.uAlpha!.value = p.alpha * p.glow;
    },
    pose: () => last,
    centreWorld(out = new THREE.Vector3()) {
      return out.set(root.position.x + last.x, root.position.y + last.y, root.position.z + last.z);
    },
    targetRadius: 0.15 * ENV.scale,
    proxy,
    setView(heightPx, fovDeg, pr) {
      haloMat.uniforms.uProj!.value = (heightPx * pr) / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
    setReducedMotion(on) {
      reduced = on;
    },
    stats: () => envelopeStats(),
    dispose() {
      carrierGeo.dispose();
      flapGeo.dispose();
      letterGeo.dispose();
      mat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      proxyGeo.dispose();
      proxyMat.dispose();
      root.removeFromParent();
    },
  };
  return api;
}
