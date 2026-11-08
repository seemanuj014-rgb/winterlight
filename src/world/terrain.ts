import * as THREE from 'three';
import { MIST } from './lightingMath';
import { buildTerrain, SNOW_LIT, SNOW_SHADOW, GROUND_FOG, FOG, SPARKLE_STRENGTH, type Tier, type TerrainMesh } from './groundMath';
import { dirFromAngles, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG } from './backdropMath';
import { TERRAIN_VERT, TERRAIN_FRAG } from './groundShaders';

// Phase 13: the snow ground. One mesh, one draw call, about 9.5k triangles, no texture: a rolling polar grid round the eye (fine near, coarse far),
// shaded in the toon steps by the moon, with surface glitter in the shader and a haze that melts the far snow into the foot of the mountains.

export interface Terrain {
  mesh: THREE.Mesh;
  built: TerrainMesh;
  update(tSec: number): void;
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

export function createTerrain(opts: { tier: Tier; reducedMotion: boolean }): Terrain {
  let reduced = opts.reducedMotion;
  const built = buildTerrain();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(built.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(built.normal, 3));
  geo.setIndex(new THREE.BufferAttribute(built.index, 1));
  const moon = dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
  const mat = new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    uniforms: {
      uLit: { value: new THREE.Color(SNOW_LIT) },
      uShadow: { value: new THREE.Color(SNOW_SHADOW) },
      uFog: { value: new THREE.Color(GROUND_FOG) },
      uMoonDir: { value: new THREE.Vector3(moon[0], moon[1], moon[2]) },
      uFogNear: { value: FOG.near },
      uFogFar: { value: FOG.far },
      uFogMax: { value: FOG.terrainMax },
      uMist: { value: new THREE.Vector4(MIST.density, MIST.falloff, MIST.max, 0) },
      uMistColor: { value: new THREE.Color(MIST.color) },
      uTime: { value: 0 },
      uSparkle: { value: SPARKLE_STRENGTH[opts.tier] },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.frustumCulled = false; // the eye stands in the middle of it
  return {
    mesh,
    built,
    update(tSec) {
      mat.uniforms.uTime!.value = reduced || !Number.isFinite(tSec) ? 0 : tSec;
    },
    setTier(tier) {
      mat.uniforms.uSparkle!.value = SPARKLE_STRENGTH[tier];
    },
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}
