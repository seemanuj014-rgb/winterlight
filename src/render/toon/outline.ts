import * as THREE from 'three';
import { buildOutlineNormals } from './weld';
import { makeNoiseTexels } from './noise';

/**
 * Her ink line as an inverted hull: a second copy of the mesh, pushed outward along smooth normals,
 * drawn back-face only in ink black. Width varies per vertex:
 *   - base width is a fraction of the mesh's bounding radius, so it scales like a drawing does;
 *   - thinner on top, heavier underneath (judged in view space, like a pen on a page);
 *   - slow width noise and a little positional wobble from a baked noise texture;
 *   - thinner at tips and sharp corners (taper);
 *   - never thinner than `minPx` on screen, so small objects keep a visible line.
 * Skinned and morphing meshes are NOT handled yet (Phase 6/10 extend this).
 */
export interface OutlineOptions {
  /** Ink colour. Her drawing: #010102. */
  color: THREE.ColorRepresentation;
  /** Base width as a fraction of bounding radius. */
  widthFrac: number;
  /** Width multiplier at the top of the screen-space silhouette. */
  top: number;
  /** Width multiplier at the bottom. */
  bottom: number;
  /** Width noise amount, 0..1 (0.3 = plus or minus 30 percent). */
  variation: number;
  /** In-plane wobble as a fraction of local width. */
  wobble: number;
  /** Minimum line width in physical pixels. */
  minPx: number;
  /** Noise tiles per bounding diameter. */
  noiseFreq: number;
  /** Noise offset; different seeds give different hands. Default: a running counter. */
  seed?: number;
}

/**
 * Defaults come from measuring her drawing (chamgadad_ref_01, 1080 px). Ink thickness along the outer
 * contour: median about 10.8 px, 10th to 90th percentile about 5 to 14 px. Her head (the thing a
 * primitive stands in for) has a radius of about 240 px, so the median line is about 0.045 of the
 * radius and the range about 0.02 to 0.06. The whole cropped figure is NOT a good reference size
 * (its bounding radius is about 568 px only because the body runs off the page), so later phases pass
 * `widthFrac` per part, relative to that part's own radius. Top versus underside showed only a mild
 * difference (about 10.8 vs 12.6 px median), so the top/bottom split is modest. The measurement is
 * rough (traced contour, cropped drawing): a starting point, tuned by eye in Phase 6 and 11. [A]
 */
export const OUTLINE_DEFAULTS: OutlineOptions = {
  color: '#010102',
  widthFrac: 0.042,
  top: 0.75,
  bottom: 1.2,
  variation: 0.3,
  wobble: 0.35,
  minPx: 1.1,
  noiseFreq: 0.5,
};

// Shared by every outline material.
const shared = {
  uNoise: { value: null as THREE.DataTexture | null },
  uViewportH: { value: 800 },
};

let noiseTexture: THREE.DataTexture | null = null;
export function getNoiseTexture(): THREE.DataTexture {
  if (!noiseTexture) {
    const size = 128;
    noiseTexture = new THREE.DataTexture(makeNoiseTexels(size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
    noiseTexture.magFilter = noiseTexture.minFilter = THREE.LinearFilter;
    noiseTexture.generateMipmaps = false;
    noiseTexture.needsUpdate = true;
  }
  return noiseTexture;
}

/** Tell the outlines how tall the drawing buffer is in physical pixels (stage height x pixel ratio). */
export function setToonViewport(heightPx: number): void {
  shared.uViewportH.value = Math.max(1, heightPx);
}

let seedCounter = 1;

export interface PreparedGeometry {
  radius: number;
}

/** Adds the `aOutline` attribute (smooth normal + taper) once per geometry; returns the bounding radius. */
export function prepareOutlineGeometry(geometry: THREE.BufferGeometry): PreparedGeometry {
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius || 1;
  if (!geometry.getAttribute('aOutline')) {
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const data = buildOutlineNormals(pos.array, nor.array, radius * 1e-4);
    geometry.setAttribute('aOutline', new THREE.BufferAttribute(data, 4));
  }
  return { radius };
}

export const OUTLINE_VERTEX_DECLS = /* glsl */ `
attribute vec4 aOutline;
uniform sampler2D uNoise;
uniform float uViewportH;
uniform float uWidth;      // object-space width (bounding radius x widthFrac)
uniform float uTop;
uniform float uBottom;
uniform float uVariation;
uniform float uWobble;
uniform float uMinPx;
uniform float uNoiseScale;
uniform float uSeed;
`;

export const OUTLINE_VERTEX_BODY = /* glsl */ `
{
  vec3 wlNView = normalize(normalMatrix * aOutline.xyz);
  vec2 wlUv = transformed.xy * uNoiseScale + transformed.zx * (uNoiseScale * 0.61) + vec2(uSeed, uSeed * 1.7);
  vec4 wlNz = texture2D(uNoise, wlUv);
  float wlUnder = smoothstep(0.55, -0.55, wlNView.y);          // 0 at the top of the screen, 1 underneath
  float wlWeight = mix(uTop, uBottom, wlUnder);
  float wlVar = 1.0 + (wlNz.r - 0.5) * 2.0 * uVariation;
  float wlScale = length(modelViewMatrix[0].xyz);               // object scale (uniform) to view units
  float wlW = uWidth * wlScale * wlWeight * wlVar * aOutline.w;
  float wlClipW = projectionMatrix[2][3] * mvPosition.z + projectionMatrix[3][3];   // -z for perspective, 1 for orthographic
  float wlPx = 2.0 * wlClipW / (projectionMatrix[1][1] * uViewportH);
  wlW = max(wlW, uMinPx * wlPx * mix(0.85, 1.2, wlNz.r));
  mvPosition.xyz += wlNView * wlW;
  mvPosition.xy += (wlNz.gb - 0.5) * 2.0 * uWobble * wlW;
  mvPosition.z -= wlW * 0.5;                                    // tuck the hull slightly behind the surface
  gl_Position = projectionMatrix * mvPosition;
}
`;

export function patchOutlineVertex(src: string): string {
  if (!src.includes('#include <common>') || !src.includes('#include <project_vertex>')) {
    throw new Error('outline: three.js MeshBasicMaterial vertex shader changed; update patchOutlineVertex');
  }
  return src
    .replace('#include <common>', '#include <common>\n' + OUTLINE_VERTEX_DECLS)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + OUTLINE_VERTEX_BODY);
}

export function createOutlineMaterial(radius: number, options: Partial<OutlineOptions> = {}): THREE.MeshBasicMaterial {
  const o = { ...OUTLINE_DEFAULTS, ...options };
  const mat = new THREE.MeshBasicMaterial({ color: o.color, side: THREE.BackSide, fog: false, toneMapped: false });
  shared.uNoise.value = getNoiseTexture();
  const u = {
    uNoise: shared.uNoise,
    uViewportH: shared.uViewportH,
    uWidth: { value: o.widthFrac * radius },
    uTop: { value: o.top },
    uBottom: { value: o.bottom },
    uVariation: { value: o.variation },
    uWobble: { value: o.wobble },
    uMinPx: { value: o.minPx },
    uNoiseScale: { value: o.noiseFreq / (2 * radius) },
    uSeed: { value: ((o.seed ?? seedCounter++) * 0.3719) % 1 },
  };
  mat.userData.outlineUniforms = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = patchOutlineVertex(shader.vertexShader);
  };
  mat.customProgramCacheKey = () => 'winterlight-outline-2';
  return mat;
}
