// Phase 9: the whole Chamgadad. The head group from Phase 6 (head, ears, neck, in her drawing's own coordinates) plus a torso, two arms,
// two legs and a tail below it, joined at the bottom of her drawn neck. Poses (pose.ts) are applied with applyPose().
// The head is never changed here: at rest (pose 'sit') the head, ears and neck are exactly where Phase 6 put them.
import * as THREE from 'three';
import { makeToon, type Toon } from '../../render/toon/material';
import palette from '../../../character/palette.json';
import partsJson from '../../../character/traced/chamgadad_ref_01_head_front.parts.json';
import { createChamgadadHead, type ChamgadadHead } from './head';
import { geometryFromMesh } from './ears';
import { outlineWidthFrac, type PartsJson } from './parts';
import { buildBodyParts, type BuiltBody } from './bodyParts';
import { createLimbs, type Limbs } from './limbs';
import { POSES, type Pose, type PoseName } from './pose';

const C = palette.colors;

export interface Chamgadad {
  /** Everything. Place and turn this one. */
  group: THREE.Group;
  head: ChamgadadHead;
  built: BuiltBody;
  limbs: Limbs;
  torso: THREE.Mesh;
  /** The pivot groups a pose drives. */
  parts: { root: THREE.Group; neck: THREE.Group; torso: THREE.Group; armL: THREE.Group; armR: THREE.Group; legL: THREE.Group; legR: THREE.Group; tail: THREE.Group };
  /** Add accessories here: `joint` is at the bottom of the neck (stethoscope), the head's own group takes the hat. */
  joint: THREE.Group;
  applyPose(pose: Pose | PoseName): void;
  dispose(): void;
}

export function createChamgadad(): Chamgadad {
  const head = createChamgadadHead();
  const built = buildBodyParts(partsJson as unknown as PartsJson, head.built.neck);
  const J = built.joint;
  const toons: Toon[] = [];

  const root = new THREE.Group();
  root.name = 'chamgadad';
  // The neck joint: the head group hangs on it with the opposite offset, so the head sits exactly where Phase 6 built it.
  const neck = new THREE.Group();
  neck.name = 'neck-joint';
  neck.position.set(J[0], J[1], J[2]);
  head.group.position.set(-J[0], -J[1], -J[2]);
  neck.add(head.group);

  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'torso';
  torsoGroup.position.set(J[0], J[1], J[2]);
  const torsoToon = makeToon({ base: C.body_base, outline: { widthFrac: outlineWidthFrac(built.torso) } });
  toons.push(torsoToon);
  const torso = torsoToon.mesh(geometryFromMesh(built.torso, J));
  torso.name = 'torso-mesh';
  torsoGroup.add(torso);

  const limbs = createLimbs(built, J);
  torsoGroup.add(limbs.armL, limbs.armR, limbs.legL, limbs.legR, limbs.tail);
  root.add(torsoGroup, neck);

  // Rest positions, so a pose is "rest + delta".
  const rest = new Map<THREE.Object3D, THREE.Vector3>();
  const parts = { root, neck, torso: torsoGroup, armL: limbs.armL, armR: limbs.armR, legL: limbs.legL, legR: limbs.legR, tail: limbs.tail };
  for (const o of Object.values(parts)) rest.set(o, o.position.clone());

  function applyPose(p: Pose | PoseName): void {
    const pose = typeof p === 'string' ? POSES[p] : p;
    for (const [name, obj] of Object.entries(parts) as [keyof typeof parts, THREE.Group][]) {
      const d = pose[name];
      obj.position.copy(rest.get(obj)!).add(new THREE.Vector3(...d.pos));
      obj.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
    }
  }

  return {
    group: root, head, built, limbs, torso, parts, joint: neck, applyPose,
    dispose() {
      head.dispose();
      for (const t of [...toons, ...limbs.toons]) t.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
  };
}
