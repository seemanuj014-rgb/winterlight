import * as THREE from 'three';
import { RAMP_PRESETS, buildRampTexels, type RampName, type RampSpec } from './ramp';
import { OUTLINE_DEFAULTS, createOutlineMaterial, prepareOutlineGeometry, type OutlineOptions } from './outline';

/**
 * Directional lights on toon materials should use this intensity: three.js divides diffuse light by PI,
 * so a light of PI puts the ramp's top step exactly on the base colour.
 */
export const TOON_LIGHT_INTENSITY = Math.PI;

export interface RimOptions {
  /** Her pale warm back-light. Palette: rim_light_warm_edge #d7d9d5. */
  color: THREE.ColorRepresentation;
  /** 0 = off, 1 = full replacement of the colour at the rim. */
  strength: number;
  /** World-space direction TOWARD the rim light. Default: behind and to the viewer's left. */
  direction: THREE.Vector3Like;
  /** Smoothstep edges on (1 - N.V): where the rim starts and is full. */
  edge: [number, number];
}

export const RIM_DEFAULTS: RimOptions = {
  color: '#d7d9d5',
  strength: 0.85,
  direction: { x: -0.8, y: 0.25, z: -0.5 },
  edge: [0.62, 0.9],
};

export interface ToonOptions {
  /** Base colour = the ramp's top step. Use palette values, never re-picked. */
  base: THREE.ColorRepresentation;
  ramp?: RampSpec | RampName;
  rim?: Partial<RimOptions> | false;
  /** Ink outline; false for background things that use colour and haze instead. */
  outline?: Partial<OutlineOptions> | false;
}

const rampCache = new Map<string, THREE.DataTexture>();
export function getRampTexture(ramp: RampSpec | RampName): THREE.DataTexture {
  const spec = typeof ramp === 'string' ? RAMP_PRESETS[ramp] : ramp;
  const key = JSON.stringify(spec);
  let tex = rampCache.get(key);
  if (!tex) {
    const width = 64;
    tex = new THREE.DataTexture(buildRampTexels(spec, width), width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    rampCache.set(key, tex);
  }
  return tex;
}

export const TOON_FRAGMENT_DECLS = /* glsl */ `
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform vec3 uRimDir;
uniform vec2 uRimEdge;
`;

export const TOON_RIM_CODE = /* glsl */ `
{
  vec3 wlV = normalize(vViewPosition);
  float wlEdge = 1.0 - clamp(dot(normal, wlV), 0.0, 1.0);
  vec3 wlL = normalize((viewMatrix * vec4(uRimDir, 0.0)).xyz);
  float wlRim = smoothstep(uRimEdge.x, uRimEdge.y, wlEdge) * smoothstep(-0.05, 0.45, dot(normal, wlL));
  outgoingLight = mix(outgoingLight, uRimColor, wlRim * uRimStrength);
}
`;

/** Makes three's toon gradient lookup return the ramp's RGB (a coloured ramp) instead of only .r. */
export function patchToonFragment(src: string, gradientChunk: string): string {
  const OLD = 'return vec3( texture2D( gradientMap, coord ).r );';
  if (!gradientChunk.includes(OLD) || !src.includes('#include <gradientmap_pars_fragment>') || !src.includes('#include <opaque_fragment>')) {
    throw new Error('toon: three.js MeshToonMaterial shader changed; update patchToonFragment');
  }
  const chunk = gradientChunk.replace(OLD, 'return texture2D( gradientMap, coord ).rgb;');
  return src
    .replace('#include <gradientmap_pars_fragment>', TOON_FRAGMENT_DECLS + chunk)
    .replace('#include <opaque_fragment>', TOON_RIM_CODE + '\n#include <opaque_fragment>');
}

export interface Toon {
  /** Shared by every mesh made from this toon. */
  readonly material: THREE.MeshToonMaterial;
  /** A mesh with this look and, unless outline is false, its ink-line child mesh. */
  mesh(geometry: THREE.BufferGeometry): THREE.Mesh;
  dispose(): void;
}

/**
 * The one way later phases make things look drawn:
 *   const toon = makeToon({ base: '#a7b9c3' });
 *   scene.add(toon.mesh(geometry));
 * Outlined meshes cost two draw calls (surface + hull); count that against PERF_BUDGET.
 */
export function makeToon(opts: ToonOptions): Toon {
  const rimOpts = opts.rim === false ? { ...RIM_DEFAULTS, strength: 0 } : { ...RIM_DEFAULTS, ...opts.rim };
  const material = new THREE.MeshToonMaterial({ color: opts.base, gradientMap: getRampTexture(opts.ramp ?? 'soft4') });
  const u = {
    uRimColor: { value: new THREE.Color(rimOpts.color) },
    uRimStrength: { value: rimOpts.strength },
    uRimDir: { value: new THREE.Vector3(rimOpts.direction.x, rimOpts.direction.y, rimOpts.direction.z).normalize() },
    uRimEdge: { value: new THREE.Vector2(rimOpts.edge[0], rimOpts.edge[1]) },
  };
  material.userData.toonUniforms = u;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = patchToonFragment(shader.fragmentShader, THREE.ShaderChunk.gradientmap_pars_fragment);
  };
  material.customProgramCacheKey = () => 'winterlight-toon-1';

  const outlineMats: THREE.Material[] = [];
  return {
    material,
    mesh(geometry) {
      const mesh = new THREE.Mesh(geometry, material);
      if (opts.outline !== false) {
        const { radius } = prepareOutlineGeometry(geometry);
        const om = createOutlineMaterial(radius, { ...OUTLINE_DEFAULTS, ...opts.outline });
        outlineMats.push(om);
        const hull = new THREE.Mesh(geometry, om);
        hull.name = 'ink-outline';
        hull.frustumCulled = false; // the hull reaches past the surface's bounding sphere
        mesh.add(hull);
        mesh.userData.outline = hull;
      }
      return mesh;
    },
    dispose() {
      material.dispose();
      for (const m of outlineMats) m.dispose();
    },
  };
}
