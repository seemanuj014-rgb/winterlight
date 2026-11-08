// Phase 9: removable accessory layers. They are OFF by default (CHARACTER_BIBLE rule 2: accessories default OFF) and never part of
// her drawing; they are ours, so they are plain, small and in the same toon and ink style. Turn one on with `setVisible(true)`.
// Colours are not hers: soft winter tones picked from her palette family (lavender from her ear patch, the white of her eye highlight).
import * as THREE from 'three';
import { makeToon, type Toon } from '../../render/toon/material';
import { sampleFrontZ } from './parts';
import type { Chamgadad } from './body';

export interface Accessory {
  group: THREE.Group;
  setVisible(on: boolean): void;
  dispose(): void;
}

const STETH_TUBE = '#4a5866'; // dark slate, readable on her pale blue-grey
const STETH_METAL = '#d3dbe0';
const HAT_BODY = '#87889c'; // her ear-patch lavender
const HAT_STRIPE = '#f7f8fa'; // her eye-highlight white

function make(): { group: THREE.Group; toons: Toon[]; geoms: THREE.BufferGeometry[]; finish(): Accessory } {
  const group = new THREE.Group();
  group.visible = false;
  const toons: Toon[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  return {
    group, toons, geoms,
    finish: () => ({
      group,
      setVisible: (on) => { group.visible = on; },
      dispose() { toons.forEach((t) => t.dispose()); geoms.forEach((g) => g.dispose()); },
    }),
  };
}

/**
 * A stethoscope: a tube round the back of the neck, hanging down the chest in a U, ending in a round chest piece resting on the chest.
 * It is parented to the neck joint so it turns with the neck. The U is laid on the real chest surface (sampled), so it cannot sink in.
 */
export function createStethoscope(c: Chamgadad): Accessory {
  const m = make();
  const J = c.built.joint;
  const surf = [c.head.built.neck, c.built.torso, c.built.armLeft, c.built.armRight];
  const front = (x: number, y: number): number => {
    let best = -Infinity;
    for (const s of surf) {
      const z = sampleFrontZ(s, x, y);
      if (z !== null) best = Math.max(best, z);
    }
    return Number.isFinite(best) ? best : 0.3;
  };
  const r = 0.055;
  const ax = c.built.axisX;
  const pts: THREE.Vector3[] = [];
  const add = (x: number, y: number, lift: number): void => { pts.push(new THREE.Vector3(x - J[0], y - J[1], front(x, y) + lift + r)); };
  // behind the neck, over the shoulder, down the chest, round the bottom of the U, and up the other side
  pts.push(new THREE.Vector3(ax - 0.75 - J[0], -1.2 - J[1], -0.25));
  add(ax - 0.78, -1.62, 0.0);
  add(ax - 0.66, -2.1, 0.05);
  add(ax - 0.4, -2.75, 0.12);
  add(ax, -3.05, 0.14);
  add(ax + 0.4, -2.75, 0.12);
  add(ax + 0.68, -2.1, 0.05);
  add(ax + 0.82, -1.62, 0.0);
  pts.push(new THREE.Vector3(ax + 0.8 - J[0], -1.2 - J[1], -0.25));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const tube = new THREE.TubeGeometry(curve, 72, r, 8, false);
  const tubeToon = makeToon({ base: STETH_TUBE, outline: { widthFrac: 0.03 } });
  const tubeMesh = tubeToon.mesh(tube);
  tubeMesh.name = 'stethoscope-tube';
  // the chest piece: a small flat disc on a short stem at the bottom of the U
  const bx = ax, by = -3.05;
  const piece = new THREE.CylinderGeometry(0.17, 0.17, 0.07, 20);
  piece.rotateX(Math.PI / 2);
  const pieceToon = makeToon({ base: STETH_METAL, outline: { widthFrac: 0.05 } });
  const pieceMesh = pieceToon.mesh(piece);
  pieceMesh.name = 'stethoscope-chest-piece';
  pieceMesh.position.set(bx - J[0], by - 0.2 - J[1], front(bx, by - 0.2) + 0.13);
  m.toons.push(tubeToon, pieceToon);
  m.geoms.push(tube, piece);
  m.group.name = 'stethoscope';
  m.group.add(tubeMesh, pieceMesh);
  c.joint.add(m.group);
  return m.finish();
}

/**
 * A small party hat: a cone with a stripe and a round tuft, sitting between the ears on top of the head, tilted with the head.
 * Parented to the head group, so it follows the head and the ears' springs do not touch it.
 */
export function createPartyHat(c: Chamgadad): Accessory {
  const m = make();
  const h = c.head.built.head;
  const apexY = 0.9;
  // top of the head between the ears: the highest point of the head rim near its middle
  let topY = -Infinity, topX = h.centre[0];
  for (const [x, y] of h.rim) {
    if (Math.abs(x - h.centre[0]) < 0.35 && y > topY) { topY = y; topX = x; }
  }
  const cone = new THREE.ConeGeometry(0.42, apexY, 24, 1);
  cone.translate(0, apexY / 2, 0);
  const hatToon = makeToon({ base: HAT_BODY, outline: { widthFrac: 0.03 } });
  const hat = hatToon.mesh(cone);
  hat.name = 'party-hat';
  const band = new THREE.TorusGeometry(0.34, 0.05, 8, 28);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0.18, 0);
  const stripeToon = makeToon({ base: HAT_STRIPE, outline: { widthFrac: 0.05 } });
  const stripe = stripeToon.mesh(band);
  stripe.name = 'party-hat-stripe';
  const ball = new THREE.SphereGeometry(0.1, 14, 10);
  ball.translate(0, apexY + 0.04, 0);
  const ballMesh = stripeToon.mesh(ball);
  ballMesh.name = 'party-hat-tuft';
  const hatGroup = new THREE.Group();
  hatGroup.add(hat, stripe, ballMesh);
  // sits on the top of the head, a little sunk in, leaning with the head's own tilt
  hatGroup.position.set(topX, topY - 0.06, (h.frontZMax + h.backZMin) / 2 - 0.05);
  hatGroup.rotation.z = -0.12;
  m.toons.push(hatToon, stripeToon);
  m.geoms.push(cone, band, ball);
  m.group.name = 'party-hat-group';
  m.group.add(hatGroup);
  c.head.group.add(m.group);
  return m.finish();
}
