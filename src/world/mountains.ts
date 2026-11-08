import * as THREE from 'three';
import { MOUNTAIN_LAYERS, LAYER_COLUMNS, LAYER_HALF_WIDTH, makeRidge, type MountainLayer } from './backdropMath';

// Phase 12: three or four layers of mountains (four here), far to near. No ink line: colour, value and haze do the work (AD).
// Each layer is one strip mesh (ridge, mid row, foot) with a small shader: a haze fade up from its foot, a moon-lit snow tone on faces
// that look left toward the moon, and a quiet lighter rim on the crest. 4 draw calls, about 1.8k triangles in all.

/** the foot of every layer, well below the horizon so the mountains never show a gap (the snow ground, Phase 13, hides it) */
export const FOOT_Y = -30;

const VERT = /* glsl */ `
attribute float aRow;   // 1 at the ridge, 0.5 mid row, 0 at the foot
attribute float aLight; // -1..1, facing the moon
varying float vRow;
varying float vLight;
varying float vY;
void main() {
  vRow = aRow;
  vLight = aLight;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vY = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uHaze;
uniform vec3 uSnow;
uniform float uHazeAmount;
uniform float uSnowAmount;
varying float vRow;
varying float vLight;
varying float vY;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  // haze: thick at the foot, thinning toward the crest but never gone (it is what makes the layers read as distance)
  float up = smoothstep(0.0, 1.0, vRow);
  float haze = mix(1.0, 1.0 - uHazeAmount, up);
  vec3 col = mix(uBody, uHaze, haze);
  // moon-lit snow on the high faces that look left (calm, not noisy: one soft step)
  float lit = smoothstep(0.72, 1.0, vRow) * smoothstep(0.0, 0.9, vLight);
  col = mix(col, uSnow, lit * uSnowAmount);
  // faces turned away from the moon sink a touch
  col *= 1.0 - 0.10 * smoothstep(0.0, -0.8, vLight) * up;
  // a quiet pale rim along the crest
  col = mix(col, uSnow, smoothstep(0.93, 1.0, vRow) * 0.14 * uSnowAmount);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export interface Mountains {
  /** children are the layers, far to near; each is shifted sideways by the backdrop for the slow parallax */
  group: THREE.Group;
  layers: { layer: MountainLayer; mesh: THREE.Mesh }[];
  triangles: number;
  dispose(): void;
}

function buildLayer(layer: MountainLayer): { mesh: THREE.Mesh; triangles: number } {
  const ridge = makeRidge(layer, LAYER_COLUMNS);
  const cols = LAYER_COLUMNS + 1;
  const pos = new Float32Array(cols * 3 * 3);
  const row = new Float32Array(cols * 3);
  const light = new Float32Array(cols * 3);
  const R = layer.dist;
  for (let i = 0; i < cols; i++) {
    // the ranges end at +-80 degrees; seen from a camera that turns (the director's walk) the end would be a cliff with sky behind it, so the last quarter of the arc
    // settles down to the foothills instead (nothing changes within +-57 degrees, where every still view and the stage look)
    const th0 = ridge.x[i]! / R;
    const edge = Math.min(1, Math.max(0, (Math.abs(th0) - 1.0) / (LAYER_HALF_WIDTH - 1.0)));
    const taper = 1 - edge * edge * (3 - 2 * edge);
    const top = 2 + (ridge.y[i]! - 2) * taper; // low foothills (2 m) at the very end, not a wall
    // the mid row sits at 45 percent of the ridge's height above the ground (y = 0): the haze is thickest below it
    const rows: [number, number][] = [
      [top, 1],
      [top * 0.45, 0.5],
      [FOOT_Y, 0],
    ];
    rows.forEach(([y, r], k) => {
      const v = k * cols + i;
      const th = ridge.x[i]! / R; // the layer is a curved wall round the eye
      pos[v * 3] = Math.sin(th) * R;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = -Math.cos(th) * R;
      row[v] = r;
      light[v] = ridge.light[i]!;
    });
  }
  const idx: number[] = [];
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = k * cols + i;
      const b = a + 1;
      const c = (k + 1) * cols + i;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRow', new THREE.BufferAttribute(row, 1));
  geo.setAttribute('aLight', new THREE.BufferAttribute(light, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uBody: { value: new THREE.Color(layer.body) },
      uHaze: { value: new THREE.Color(layer.haze) },
      uSnow: { value: new THREE.Color(0xe8f1f8) }, // AD: snow lit
      uHazeAmount: { value: layer.hazeAmount },
      uSnowAmount: { value: layer.snow },
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `mountains-${layer.name}`;
  mesh.frustumCulled = false; // the strip is huge and the drift moves it; it is cheap, so never cull it
  return { mesh, triangles: idx.length / 3 };
}

export function createMountains(): Mountains {
  const group = new THREE.Group();
  group.name = 'mountains';
  const layers: Mountains['layers'] = [];
  let triangles = 0;
  for (const layer of MOUNTAIN_LAYERS) {
    const { mesh, triangles: t } = buildLayer(layer);
    group.add(mesh);
    layers.push({ layer, mesh });
    triangles += t;
  }
  return {
    group,
    layers,
    triangles,
    dispose() {
      for (const { mesh } of layers) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
  };
}
