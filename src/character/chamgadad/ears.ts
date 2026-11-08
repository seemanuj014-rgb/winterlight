// Phase 6: the two ears as three objects. Each ear is a Group placed at its traced base (the pivot), so Phase 8 can rotate it:
//   flap  the whole ear seen from behind where it folds over, teal-grey (palette ear_back_shadow_teal), sits behind;
//   bowl  the pale-blue inner face inside the fold stroke, with the soft lavender patch; its ink-line rim IS her fold line.
// Colours come from character/palette.json, never re-picked. The lavender patch is per-vertex colour (soft edge, like the drawing).
import * as THREE from 'three';
import { makeToon, type Toon } from '../../render/toon/material';
import type { InflatedMesh } from './inflate';
import { outlineWidthFrac, patchWeight, type BuiltEar } from './parts';

export interface EarColors {
  /** Ear back (the folded-over side). */
  flap: string;
  /** Inner face. */
  bowl: string;
  /** The patch near the base. */
  patch: string;
}

export interface EarObject {
  group: THREE.Group;
  flapMesh: THREE.Mesh;
  bowlMesh: THREE.Mesh;
  /** World position of the pivot (the group is placed here; its children are offset by minus this). */
  pivot: THREE.Vector3;
  toons: Toon[];
}

export function geometryFromMesh(m: InflatedMesh, offset: readonly [number, number, number], colors?: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = Float32Array.from(m.positions);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = pos[i]! - offset[0];
    pos[i + 1] = pos[i + 1]! - offset[1];
    pos[i + 2] = pos[i + 2]! - offset[2];
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  if (colors) g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Per-vertex colour: the ear's pale blue, fading softly into lavender where the drawn patch is. Linear colour, like material.color. */
export function bowlVertexColors(bowl: InflatedMesh, ear: BuiltEar, colors: EarColors): Float32Array {
  const base = new THREE.Color(colors.bowl);
  const lav = new THREE.Color(colors.patch);
  const out = new Float32Array((bowl.positions.length / 3) * 3);
  for (let v = 0; v < bowl.positions.length / 3; v++) {
    const w = ear.patch ? patchWeight(bowl.positions[v * 3]!, bowl.positions[v * 3 + 1]!, ear.patch) : 0;
    out[v * 3] = base.r + (lav.r - base.r) * w;
    out[v * 3 + 1] = base.g + (lav.g - base.g) * w;
    out[v * 3 + 2] = base.b + (lav.b - base.b) * w;
  }
  return out;
}

export function createEar(ear: BuiltEar, colors: EarColors): EarObject {
  const pivot = new THREE.Vector3(...ear.pivot);
  const off = ear.pivot;
  const flapToon = makeToon({ base: colors.flap, outline: { widthFrac: outlineWidthFrac(ear.flap) } });
  // The bowl's own colour is in its vertices, so the material colour is white and vertexColors multiplies it by them.
  const bowlToon = makeToon({ base: '#ffffff', outline: { widthFrac: outlineWidthFrac(ear.bowl) } });
  bowlToon.material.vertexColors = true;
  bowlToon.material.needsUpdate = true;

  const flapMesh = flapToon.mesh(geometryFromMesh(ear.flap, off));
  flapMesh.name = 'ear-flap';
  const bowlMesh = bowlToon.mesh(geometryFromMesh(ear.bowl, off, bowlVertexColors(ear.bowl, ear, colors)));
  bowlMesh.name = 'ear-bowl';
  const group = new THREE.Group();
  group.name = 'ear';
  group.position.copy(pivot);
  group.add(flapMesh, bowlMesh);
  return { group, flapMesh, bowlMesh, pivot, toons: [flapToon, bowlToon] };
}
