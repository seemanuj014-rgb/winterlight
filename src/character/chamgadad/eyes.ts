// Phase 7: the two eyes and brows, as patches lying on the head's front surface, drawn by shaders/eye.frag.
// The pixels come from her drawing (tools/trace_face.py), so at the reference camera the eyes are where and what she drew.
// Nothing is added that she did not draw: no nose, whiskers, lashes or blush.
import * as THREE from 'three';
import palette from '../../../character/palette.json';
import faceJson from '../../../character/traced/chamgadad_ref_01_head_front.face.json';
import eyeLeftUrl from '../../../character/traced/chamgadad_ref_01_head_front.eye_left.png';
import eyeRightUrl from '../../../character/traced/chamgadad_ref_01_head_front.eye_right.png';
import browLeftUrl from '../../../character/traced/chamgadad_ref_01_head_front.brow_left.png';
import browRightUrl from '../../../character/traced/chamgadad_ref_01_head_front.brow_right.png';
import vert from './shaders/eye.vert?raw';
import frag from './shaders/eye.frag?raw';
import { sampleFrontZ, type BuiltHead } from './parts';
import { eyePlacement, patchGrid, type FaceJson, type EyePlacement } from './eyePlacement';

const C = palette.colors;
/** How far the patch floats in front of the head surface. The patch is a finer grid than the head mesh, so it needs a little clearance. */
export const EYE_LIFT = 0.012;

export interface EyeObject {
  side: 'left' | 'right';
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  placement: EyePlacement;
  /** Resolves when both of this eye's textures have loaded. */
  ready: Promise<void>;
}

function loadMask(url: string): { tex: THREE.Texture; ready: Promise<void> } {
  const tex = new THREE.Texture();
  // These are masks, not colours: no colour-space conversion, no mipmaps (the crop is not a power of two and is shown near 1:1).
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.premultiplyAlpha = false;
  const ready = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
      resolve();
    };
    img.onerror = () => reject(new Error(`eye mask failed to load: ${url}`));
    img.src = url;
  });
  return { tex, ready };
}

export function createEye(side: 'left' | 'right', head: BuiltHead): EyeObject {
  const json = (faceJson as unknown as FaceJson).eyes.find((e) => e.side === side);
  if (!json) throw new Error(`face.json has no ${side} eye`);
  const placement = eyePlacement(json);
  const grid = patchGrid(placement, 24);
  const verts = (grid.n + 1) * (grid.n + 1);
  const pos = new Float32Array(verts * 3);
  // z from the head's front surface; where the patch pokes past the head's edge, take the nearest covered value
  const zs: (number | null)[] = [];
  for (let v = 0; v < verts; v++) zs.push(sampleFrontZ(head.head, grid.xy[v * 2]!, grid.xy[v * 2 + 1]!));
  const known = zs.filter((z): z is number => z !== null);
  const fallback = known.length ? Math.min(...known) : 0;
  for (let v = 0; v < verts; v++) {
    pos[v * 3] = grid.xy[v * 2]!;
    pos[v * 3 + 1] = grid.xy[v * 2 + 1]!;
    pos[v * 3 + 2] = (zs[v] ?? fallback) + EYE_LIFT;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(grid.uv, 2));
  geo.setIndex(new THREE.BufferAttribute(grid.indices, 1));
  geo.computeBoundingSphere();

  const eye = loadMask(side === 'left' ? eyeLeftUrl : eyeRightUrl);
  const brow = loadMask(side === 'left' ? browLeftUrl : browRightUrl);
  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uEye: { value: eye.tex },
      uBrow: { value: brow.tex },
      uGaze: { value: new THREE.Vector2() },
      uLight: { value: new THREE.Vector2() },
      uBlink: { value: 0 },
      uBlack: { value: new THREE.Color(C.eye_black) },
      uWhite: { value: new THREE.Color(C.eye_highlight_white) },
      uTab: { value: new THREE.Color(C.eye_lower_pale_blue_tab) },
      uInk: { value: new THREE.Color(C.outline_ink) },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `eye-${side}`;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { side, mesh, material, placement, ready: Promise.all([eye.ready, brow.ready]).then(() => undefined) };
}

export function disposeEye(e: EyeObject): void {
  e.mesh.geometry.dispose();
  (e.material.uniforms.uEye!.value as THREE.Texture).dispose();
  (e.material.uniforms.uBrow!.value as THREE.Texture).dispose();
  e.material.dispose();
}
