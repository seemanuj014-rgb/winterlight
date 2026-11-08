import * as THREE from 'three';
import { MIST } from './lightingMath';
import {
  placePines, buildPineGeometry, buildShadows, pineMatrix, PINE_COUNT, SHADOW_TRIS_PER_PINE, PINE, PINE_SNOW, SNOW_SHADOW, GROUND_FOG, BLOB_SHADOW, FOG,
  type Tier, type Pines as PinePlacement, type PineGeometry,
} from './groundMath';
import { dirFromAngles, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG } from './backdropMath';
import { PINE_VERT, PINE_FRAG, SHADOW_VERT, SHADOW_FRAG } from './groundShaders';

// Phase 13: the pines. ONE InstancedMesh (every tree is the same 5-tier unit tree, moved, turned and scaled by its instance matrix) plus ONE mesh of soft
// blob shadows draped on the snow (PB: no real-time shadows). Snow lies on the top of every tier, scalloped; the crowns sway a little in the shader.
// No ink line: pines are background (AD). A lower tier or reduced motion only changes how many instances are drawn (the first N of the 220) and the sway.

export interface Pines {
  trees: THREE.InstancedMesh;
  shadows: THREE.Mesh;
  placement: PinePlacement;
  unit: PineGeometry;
  /** instances drawn right now */
  readonly count: number;
  update(tSec: number): void;
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

export function createPines(opts: { tier: Tier; reducedMotion: boolean }): Pines {
  let tier = opts.tier;
  let reduced = opts.reducedMotion;
  const placement = placePines(PINE_COUNT.high);
  const unit = buildPineGeometry();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(unit.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(unit.normal, 3));
  geo.setAttribute('aSnow', new THREE.BufferAttribute(unit.aSnow, 1));
  geo.setAttribute('aTier', new THREE.BufferAttribute(unit.aTier, 1));
  geo.setIndex(new THREE.BufferAttribute(unit.index, 1));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(placement.phase.slice(0, placement.count), 1));
  const moon = dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
  const moonDir = new THREE.Vector3(moon[0], moon[1], moon[2]);
  const mat = new THREE.ShaderMaterial({
    vertexShader: PINE_VERT,
    fragmentShader: PINE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSway: { value: reduced ? 0 : 1 },
      uPine: { value: new THREE.Color(PINE) },
      uSnowLit: { value: new THREE.Color(PINE_SNOW) },
      uSnowShadow: { value: new THREE.Color(SNOW_SHADOW) },
      uFog: { value: new THREE.Color(GROUND_FOG) },
      uMoonDir: { value: moonDir },
      uFogNear: { value: FOG.near },
      uFogFar: { value: FOG.far },
      uFogMax: { value: FOG.pineMax },
      uMist: { value: new THREE.Vector4(MIST.density, MIST.falloff, MIST.max, 0) },
      uMistColor: { value: new THREE.Color(MIST.color) },
    },
  });
  const trees = new THREE.InstancedMesh(geo, mat, placement.count);
  trees.name = 'pines';
  trees.frustumCulled = false; // the forest rings the eye; one cheap call, never culled
  for (let i = 0; i < placement.count; i++) pineMatrix(placement, i, trees.instanceMatrix.array as Float32Array, i * 16);
  trees.instanceMatrix.needsUpdate = true;

  const sh = buildShadows(placement);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(sh.position, 3));
  sgeo.setAttribute('aEdge', new THREE.BufferAttribute(sh.aEdge, 1));
  sgeo.setIndex(new THREE.BufferAttribute(sh.index, 1));
  const smat = new THREE.ShaderMaterial({
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(BLOB_SHADOW) },
      uFog: { value: new THREE.Color(GROUND_FOG) },
      uFogNear: { value: FOG.near },
      uFogFar: { value: FOG.far },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const shadows = new THREE.Mesh(sgeo, smat);
  shadows.name = 'pine-shadows';
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;

  let count = 0;
  const apply = (): void => {
    count = Math.min(PINE_COUNT[tier], placement.count);
    trees.count = count;
    sgeo.setDrawRange(0, count * SHADOW_TRIS_PER_PINE * 3);
    mat.uniforms.uSway!.value = reduced ? 0 : 1;
  };
  apply();
  return {
    trees,
    shadows,
    placement,
    unit,
    get count() {
      return count;
    },
    update(tSec) {
      mat.uniforms.uTime!.value = Number.isFinite(tSec) ? tSec : 0;
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
      sgeo.dispose();
      smat.dispose();
      trees.removeFromParent();
      shadows.removeFromParent();
    },
  };
}
