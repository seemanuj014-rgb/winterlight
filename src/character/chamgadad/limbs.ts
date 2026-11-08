// Phase 9: arms, legs (thigh + foot) and tail as three objects. Each is a Group at its pivot so poses and Phase 10 can rotate it.
// Look: the same toon ramp and ink line as the head, colours from character/palette.json (body base / chest). Nothing is added that she did not
// draw: no fingers, no toes, no pads. [A] shapes, depths and sizes: see bodyParts.ts and CHARACTER_BIBLE.md.
import * as THREE from 'three';
import { makeToon, type Toon } from '../../render/toon/material';
import palette from '../../../character/palette.json';
import { geometryFromMesh } from './ears';
import { outlineWidthFrac } from './parts';
import type { BuiltBody } from './bodyParts';
import type { InflatedMesh } from './inflate';

const C = palette.colors;

export interface Limbs {
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  tail: THREE.Group;
  toons: Toon[];
}

type V3 = readonly [number, number, number];

function part(toons: Toon[], m: InflatedMesh, color: string, pivot: V3, name: string): THREE.Mesh {
  const toon = makeToon({ base: color, outline: { widthFrac: outlineWidthFrac(m) } });
  toons.push(toon);
  const mesh = toon.mesh(geometryFromMesh(m, pivot));
  mesh.name = name;
  return mesh;
}

/** Positions are relative to `origin` (the torso group's pivot, the neck joint). */
export function createLimbs(b: BuiltBody, origin: V3): Limbs {
  const toons: Toon[] = [];
  const at = (g: THREE.Group, p: V3): THREE.Group => {
    g.position.set(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
    return g;
  };

  const armL = at(new THREE.Group(), b.shoulderLeft);
  armL.name = 'arm-left';
  armL.add(part(toons, b.armLeft, C.body_chest, b.shoulderLeft, 'arm-left-mesh'));
  const armR = at(new THREE.Group(), b.shoulderRight);
  armR.name = 'arm-right';
  armR.add(part(toons, b.armRight, C.body_chest, b.shoulderRight, 'arm-right-mesh'));

  const leg = (thigh: InflatedMesh, hip: V3, name: string): THREE.Group => {
    const g = at(new THREE.Group(), hip);
    g.name = name;
    g.add(part(toons, thigh, C.body_base, hip, `${name}-thigh`));
    // The foot lies flat in front of the thigh: built upright in x/y, laid down by +90 degrees about x (its long axis then points toward the viewer).
    const foot = part(toons, b.footLeft, C.body_base, [0, 0, 0], `${name}-foot`);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, b.baseY + 0.2 - hip[1], thigh.frontZMax * 0.55 + 0.4 - hip[2]);
    g.add(foot);
    return g;
  };
  const legL = leg(b.thighLeft, b.hipLeft, 'leg-left');
  const legR = leg(b.thighRight, b.hipRight, 'leg-right');

  const tail = at(new THREE.Group(), b.tailPivot);
  tail.name = 'tail';
  const tailMesh = part(toons, b.tail, C.body_base, [0, 0, 0], 'tail-mesh');
  tailMesh.rotation.y = Math.PI / 2; // lies in the front-to-back plane, pointing away from the viewer, curling up
  tail.add(tailMesh);

  return { armL, armR, legL, legR, tail, toons };
}
