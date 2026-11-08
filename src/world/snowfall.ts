import * as THREE from 'three';
import { makeFlakes, snowCount, windDisplacement, SNOW_BOX, SNOW_BOX_AHEAD, SNOW_COUNT, REDUCED_FALL_SCALE, SNOW_LIT, type Tier } from './groundMath';
import { SNOW_VERT, SNOW_FRAG } from './groundShaders';

// Phase 13: the snowfall. ONE Points object, ONE draw call. Every flake's place is a pure function of time in the vertex shader (fall, a slow wind with
// gusts, a little sway, wrapped round a box of air that follows the camera), so nothing is uploaded per frame. The flakes are in random order, so a
// smaller count (a lower tier, reduced motion) just draws the first part of the buffer. Soft round dots, no texture.

export interface Snowfall {
  points: THREE.Points;
  /** flakes drawn right now */
  readonly count: number;
  update(tSec: number, camera: THREE.Camera): void;
  setPixelRatio(pr: number): void;
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

export function createSnowfall(opts: { tier: Tier; reducedMotion: boolean; pixelRatio?: number }): Snowfall {
  let tier = opts.tier;
  let reduced = opts.reducedMotion;
  const flakes = makeFlakes(31, SNOW_COUNT.high);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(flakes.base, 3)); // the place in the box, 0..1
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(flakes.speed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(flakes.size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(flakes.phase, 1));
  geo.setAttribute('aWindK', new THREE.BufferAttribute(flakes.windK, 1));
  const box = SNOW_BOX[tier];
  const mat = new THREE.ShaderMaterial({
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFall: { value: reduced ? REDUCED_FALL_SCALE : 1 },
      uWind: { value: 0 },
      uSway: { value: reduced ? 0 : 1 },
      uBox: { value: new THREE.Vector3(box.w, box.h, box.d) }, // x width, y height, z depth (the shader reads .y as the height)
      uCenter: { value: new THREE.Vector3() },
      uPixelRatio: { value: opts.pixelRatio ?? 1 },
      uColor: { value: new THREE.Color(SNOW_LIT) },
    },
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'snowfall';
  points.frustumCulled = false; // the shader places every flake; the buffer's own bounds mean nothing
  points.renderOrder = 2;
  let count = 0;
  const apply = (): void => {
    count = snowCount(tier, reduced);
    geo.setDrawRange(0, count);
    const b = SNOW_BOX[tier];
    (mat.uniforms.uBox!.value as THREE.Vector3).set(b.w, b.h, b.d);
    mat.uniforms.uFall!.value = reduced ? REDUCED_FALL_SCALE : 1;
    mat.uniforms.uSway!.value = reduced ? 0 : 1;
  };
  apply();
  return {
    points,
    get count() {
      return count;
    },
    update(tSec, camera) {
      const t = Number.isFinite(tSec) ? tSec : 0;
      mat.uniforms.uTime!.value = t;
      mat.uniforms.uWind!.value = windDisplacement(t, reduced);
      // the box of air: round the camera, a little ahead of it along where it looks (flat on the ground plane)
      const c = mat.uniforms.uCenter!.value as THREE.Vector3;
      const b = SNOW_BOX[tier];
      c.set(camera.position.x, 0, camera.position.z - b.d * SNOW_BOX_AHEAD);
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
