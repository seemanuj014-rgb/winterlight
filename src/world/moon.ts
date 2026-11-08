import * as THREE from 'three';
import { dirFromAngles, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, MOON_RADIUS_DEG } from './backdropMath';

// Phase 12: the moon. One quad on the sky (one draw call): a flat pale disc with two soft shaded patches (drawn, not photographic)
// and a wide gentle halo. Key light of the whole card, so it stands left and behind, like the rim light of the toon ramp.
// It is a named mesh so the "tap it five times" secret (Phase 30) can find it.

export const MOON_DISTANCE = 86;
const HALO_SCALE = 5.5; // quad half-size as a multiple of the disc radius

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0; // -1..1 across the quad
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uDisc;
uniform vec3 uShade;
uniform vec3 uHalo;
uniform float uScale;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = vUv * uScale; // 1.0 = the disc's edge
  float r = length(p);
  float edge = 1.0 - smoothstep(0.985, 1.0, r);
  // two soft patches, low contrast, placed by hand (upper right and lower left, like a sleepy face looking away)
  float m1 = 1.0 - smoothstep(0.0, 0.36, length(p - vec2(0.32, 0.28)));
  float m2 = 1.0 - smoothstep(0.0, 0.26, length(p - vec2(-0.30, -0.34)));
  float m3 = 1.0 - smoothstep(0.0, 0.18, length(p - vec2(0.05, -0.55)));
  vec3 disc = mix(uDisc, uShade, clamp(m1 * 0.55 + m2 * 0.45 + m3 * 0.35, 0.0, 0.6));
  // a slightly cooler limb, lit from the left
  disc = mix(disc, uDisc, 0.25 * smoothstep(-1.0, 0.2, -p.x));
  // halo: wide and soft, strongest next to the disc
  float h = pow(max(1.0 - smoothstep(1.0, uScale, r), 0.0), 2.4);
  float haloA = h * 0.30;
  vec3 col = mix(uHalo, disc, edge);
  float a = max(edge, haloA);
  a *= 1.0 - smoothstep(uScale * 0.9, uScale, r);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export interface Moon {
  mesh: THREE.Mesh;
  dispose(): void;
}

export function createMoon(): Moon {
  const radius = Math.tan((MOON_RADIUS_DEG * Math.PI) / 180) * MOON_DISTANCE;
  const half = radius * HALO_SCALE;
  const geo = new THREE.PlaneGeometry(half * 2, half * 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uDisc: { value: new THREE.Color(0xe4edf6) },
      uShade: { value: new THREE.Color(0xc4d2e4) },
      uHalo: { value: new THREE.Color(0x9fb6dc) },
      uScale: { value: HALO_SCALE },
    },
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'moon';
  mesh.renderOrder = -80;
  mesh.frustumCulled = false;
  const d = dirFromAngles(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
  mesh.position.set(d[0] * MOON_DISTANCE, d[1] * MOON_DISTANCE, d[2] * MOON_DISTANCE);
  mesh.lookAt(0, 0, 0); // faces the eye (the sky group is centred on the camera)
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
