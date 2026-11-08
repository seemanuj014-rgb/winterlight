import * as THREE from 'three';
import { PLUME_VERT, PLUME_FRAG } from './cabinShaders';
import { makePlume, plumeCount, type MeshData, type PlumeTier } from './cabinMath';

// Phase 14: the three.js side shared by the cabin and the nook: merged mesh data into a BufferGeometry (sRGB vertex colours converted once), and the smoke/steam Points.

export function toGeometry(md: MeshData, alpha = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = md.pos.length / 3;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(md.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(md.nrm), 3));
  const step = alpha ? 4 : 3;
  const col = new Float32Array(n * step);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.setRGB(md.col[i * step]!, md.col[i * step + 1]!, md.col[i * step + 2]!, THREE.SRGBColorSpace);
    col[i * step] = c.r;
    col[i * step + 1] = c.g;
    col[i * step + 2] = c.b;
    if (alpha) col[i * step + 3] = md.col[i * step + 3]!;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, step));
  g.setIndex(new THREE.BufferAttribute(n > 65000 ? new Uint32Array(md.idx) : new Uint16Array(md.idx), 1));
  return g;
}

/** Unlit light: window glass, lamp, lantern. Not tone mapped, so warm stays the AD hex. */
export function glowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
}

export interface PlumeSpec {
  base: Record<PlumeTier, number>;
  seed: number;
  origin: [number, number, number];
  color: number;
  alpha: number;
  life: number;
  height: number;
  spread: number;
  wind: number;
  size: number;
  grow: number;
}

export interface Plume {
  points: THREE.Points;
  update(tSec: number): void;
  setTier(t: PlumeTier): void;
  setReducedMotion(on: boolean): void;
  setPixelRatio(pr: number): void;
  readonly count: number;
  dispose(): void;
}

export function createPlume(spec: PlumeSpec, opts: { tier: PlumeTier; reducedMotion: boolean; pixelRatio?: number }): Plume {
  let tier = opts.tier;
  let reduced = opts.reducedMotion;
  const maxN = spec.base.high;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(makePlume(spec.seed, maxN), 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: spec.life },
      uHeight: { value: spec.height },
      uSpread: { value: spec.spread },
      uWind: { value: spec.wind },
      uSize: { value: spec.size },
      uGrow: { value: spec.grow },
      uSway: { value: 1 },
      uPixelRatio: { value: opts.pixelRatio ?? 1 },
      uAlpha: { value: spec.alpha },
      uOrigin: { value: new THREE.Vector3(...spec.origin) },
      uColor: { value: new THREE.Color(spec.color) },
    },
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // the shader places every puff
  points.renderOrder = 3;
  let count = 0;
  const apply = (): void => {
    count = plumeCount(spec.base, tier, reduced);
    geo.setDrawRange(0, count);
    mat.uniforms.uLife!.value = spec.life * (reduced ? 2.2 : 1); // slower, not frozen
    mat.uniforms.uSway!.value = reduced ? 0 : 1;
  };
  apply();
  return {
    points,
    update(t) {
      mat.uniforms.uTime!.value = t;
    },
    setTier(t) {
      // the watchdog only steps down
      const order: PlumeTier[] = ['low', 'mid', 'high'];
      if (order.indexOf(t) < order.indexOf(tier)) {
        tier = t;
        apply();
      }
    },
    setReducedMotion(on) {
      reduced = on;
      apply();
    },
    setPixelRatio(pr) {
      mat.uniforms.uPixelRatio!.value = pr;
    },
    get count() {
      return count;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      points.removeFromParent();
    },
  };
}
