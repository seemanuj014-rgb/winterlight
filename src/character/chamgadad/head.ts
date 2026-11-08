// Phase 6: Chamgadad's head, ears and neck, assembled and dressed in the toon look.
// Geometry: parts.ts (pure, tested) from her traced outlines. Look: makeToon with colours from character/palette.json.
// Not here: eyes, brows, mouth (Phase 7), body below the chest (Phase 9). The back and sides are inferred [A].
import * as THREE from 'three';
import { makeToon, TOON_LIGHT_INTENSITY, type Toon } from '../../render/toon/material';
import palette from '../../../character/palette.json';
import partsJson from '../../../character/traced/chamgadad_ref_01_head_front.parts.json';
import { buildHeadParts, outlineWidthFrac, type BuiltHead, type PartsJson } from './parts';
import { createEar, geometryFromMesh, type EarObject } from './ears';

const C = palette.colors;

export interface ChamgadadHead {
  group: THREE.Group;
  head: THREE.Mesh;
  neck: THREE.Mesh;
  earUpright: EarObject;
  earAngled: EarObject;
  built: BuiltHead;
  dispose(): void;
}

export function createChamgadadHead(): ChamgadadHead {
  const built = buildHeadParts(partsJson as unknown as PartsJson);
  const toons: Toon[] = [];
  const group = new THREE.Group();
  group.name = 'chamgadad-head';

  const headToon = makeToon({ base: C.body_base, outline: { widthFrac: outlineWidthFrac(built.head) } });
  const neckToon = makeToon({ base: C.body_chest, outline: { widthFrac: outlineWidthFrac(built.neck) } });
  toons.push(headToon, neckToon);
  const zero = [0, 0, 0] as const;
  const head = headToon.mesh(geometryFromMesh(built.head, zero));
  head.name = 'head';
  const neck = neckToon.mesh(geometryFromMesh(built.neck, zero));
  neck.name = 'neck';

  const earUpright = createEar(built.earUpright, { flap: C.ear_back_shadow_teal, bowl: C.ear_front_pale_blue, patch: C.ear_inner_lavender });
  const earAngled = createEar(built.earAngled, { flap: C.ear_back_shadow_teal, bowl: C.ear_right_pale_blue, patch: C.ear_inner_lavender });
  toons.push(...earUpright.toons, ...earAngled.toons);
  earUpright.group.name = 'ear-upright';
  earAngled.group.name = 'ear-angled';

  group.add(neck, head, earUpright.group, earAngled.group);
  return {
    group, head, neck, earUpright, earAngled, built,
    dispose() {
      for (const t of toons) t.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
  };
}

/** The key light the toon ramp expects: white, intensity PI, from the front right and above (as in the Phase 3 rig). */
export function createHeadKeyLight(): THREE.DirectionalLight {
  const key = new THREE.DirectionalLight('#ffffff', TOON_LIGHT_INTENSITY);
  key.position.set(3, 4, 5);
  return key;
}
