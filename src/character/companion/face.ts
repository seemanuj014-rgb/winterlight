// Phase 16: the face patches (two eyes and a nose) of a companion. One mesh, one draw call, lying on the head's ellipsoid.
import * as THREE from 'three';
import palette from '../../../character/palette.json';
import { FACE_FRAG, FACE_VERT } from './shaders';
import type { V3 } from './parts';

const C = palette.colors;
/** How far the patch floats in front of the head surface (metres). */
export const FACE_LIFT = 0.0025;
/** Largest shift of the shade inside the black, as a fraction of the eye patch; the shader scales it again. */
export const GAZE_LIMIT = 1;

export interface HeadEllipsoid {
  c: V3;
  r: V3;
}
export interface FacePatch {
  kind: 0 | 1; // 0 eye, 1 nose
  /** Centre on the front of the head, head frame, metres. */
  x: number;
  y: number;
  /** Size, metres. */
  w: number;
  h: number;
}

/** z of the head's front surface at (x, y), clamped so a patch that pokes past the edge keeps a sensible value. */
export function frontZ(head: HeadEllipsoid, x: number, y: number): number {
  const u = (x - head.c[0]) / head.r[0];
  const v = (y - head.c[1]) / head.r[1];
  return head.c[2] + head.r[2] * Math.sqrt(Math.max(0.04, 1 - u * u - v * v));
}

export function buildFaceGeometry(head: HeadEllipsoid, patches: FacePatch[], n = 6): THREE.BufferGeometry {
  const per = (n + 1) * (n + 1);
  const pos = new Float32Array(patches.length * per * 3);
  const uv = new Float32Array(patches.length * per * 2);
  const kind = new Float32Array(patches.length * per);
  const index: number[] = [];
  patches.forEach((p, pi) => {
    const base = pi * per;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const k = base + j * (n + 1) + i;
        const u = i / n;
        const v = j / n;
        const x = p.x + (u - 0.5) * p.w;
        const y = p.y + (v - 0.5) * p.h;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = frontZ(head, x, y) + FACE_LIFT;
        uv[k * 2] = u;
        uv[k * 2 + 1] = v;
        kind[k] = p.kind;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        index.push(a, b, d, a, d, c); // counter-clockwise seen from +z (the front)
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

export interface FaceOptions {
  /** The grey shade inside the black (a dark tone of the animal's own hue). */
  shade: THREE.ColorRepresentation;
  nose: THREE.ColorRepresentation;
}

export interface CompanionFace {
  mesh: THREE.Mesh;
  /** 0 open .. 1 closed. */
  setBlink(amount: number): void;
  /** -1..1 each. */
  setGaze(x: number, y: number): void;
  /** Head-local metres. */
  setNoseShift(x: number, y: number, z?: number): void;
  readonly blink: number;
  dispose(): void;
}

export function createCompanionFace(head: HeadEllipsoid, patches: FacePatch[], opts: FaceOptions): CompanionFace {
  const geo = buildFaceGeometry(head, patches);
  const u = {
    uBlink: { value: 0 },
    uGaze: { value: new THREE.Vector2() },
    uNoseShift: { value: new THREE.Vector3() },
    uBlack: { value: new THREE.Color(C.eye_black) },
    uWhite: { value: new THREE.Color(C.eye_highlight_white) },
    uTab: { value: new THREE.Color(C.eye_lower_pale_blue_tab) },
    uShade: { value: new THREE.Color(opts.shade) },
    uNose: { value: new THREE.Color(opts.nose) },
    uInk: { value: new THREE.Color(C.outline_ink) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: FACE_VERT,
    fragmentShader: FACE_FRAG,
    uniforms: u,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'face';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return {
    mesh,
    setBlink(a) {
      u.uBlink.value = Math.min(1, Math.max(0, a));
    },
    setGaze(x, y) {
      u.uGaze.value.set(Math.min(1, Math.max(-1, x)), Math.min(1, Math.max(-1, y)));
    },
    setNoseShift(x, y, z = 0) {
      u.uNoseShift.value.set(x, y, z);
    },
    get blink() {
      return u.uBlink.value;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
