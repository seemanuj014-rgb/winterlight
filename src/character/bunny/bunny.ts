// Phase 16: the snow bunny. A small white-blue bunny with its own shape (a chubby egg, a round head, SHORT upright ears with a rounded tip, a puff tail baked into the body),
// drawn with the same toon ramp, ink line and eye language as Chamgadad and the cat, but nothing taken from Chamgadad's silhouette.
// Rigid parts: root > motion > body, head (> two ears, face). Six meshes with their ink hulls plus the face patch = 13 draw calls and about 2.4k triangles (PB: the outdoor scene is 19 calls; Chamgadad about 30).
// Units are metres; the bunny faces +z and sits on y = 0. Every number is mine `[A]` (the bunny is ours to design, not from her drawing).
import * as THREE from 'three';
import { makeToon, type Toon } from '../../render/toon/material';
import { Critter, flickWave, slowBlinkAt, twitchWave, type Frame, type Pose } from '../companion/engine';
import { createCompanionFace, type CompanionFace, type HeadEllipsoid } from '../companion/face';
import { ellipsoid, leaf, mergePieces, triangleCount, type V3 } from '../companion/parts';
import { Blinker } from '../chamgadad/blink';
import { BUNNY_DEF, type BunnyGesture, type BunnyState } from './states';

/** sRGB hex. White-blue (AD) with lavender inside the ears and on the nose. */
export const BUNNY_COLORS = {
  fur: '#eaf2f8',
  belly: '#f6f9fc',
  shadow: '#cfdcea',
  earInner: '#a79fc4',
  nose: '#a79fc4',
  shade: '#4a5670',
} as const;

export const BUNNY_PIVOT = {
  neck: [0, 0.15, 0.045] as V3,
  /** where the ears stand on the head (the head's own frame) */
  earL: [0.042, 0.1, -0.012] as V3,
  earR: [-0.042, 0.1, -0.012] as V3,
};
export const BUNNY_HEAD: HeadEllipsoid = { c: [0, 0.06, 0.012], r: [0.083, 0.07, 0.074] };

export type BunnyPartName = 'motion' | 'body' | 'head' | 'earL' | 'earR';
export const BUNNY_PARTS: readonly BunnyPartName[] = ['motion', 'body', 'head', 'earL', 'earR'];

export interface BunnyStats {
  drawCalls: number;
  triangles: number;
  meshes: number;
}
export interface BunnyOptions {
  reducedMotion?: boolean;
  seed?: number;
  auto?: boolean;
}
export interface Bunny {
  root: THREE.Group;
  parts: Record<BunnyPartName, THREE.Group>;
  face: CompanionFace;
  behaviour: Critter<BunnyState, BunnyGesture>;
  applyPose(pose: Pose): void;
  update(dt: number): Frame<BunnyState, BunnyGesture>;
  lookAt(x: number, y: number): void;
  setReducedMotion(on: boolean): void;
  stats(): BunnyStats;
  dispose(): void;
}

/** A short rounded ear: a wide, blunt tip (a spoon, not a leaf), lavender inside. */
function earGeometry(): THREE.BufferGeometry {
  const C = BUNNY_COLORS;
  const outer: [number, number][] = [[0, -0.004], [0.027, 0], [0.034, 0.016], [0.035, 0.036], [0.029, 0.056], [0.017, 0.07], [0, 0.076]];
  const inner: [number, number][] = [[0, 0.004], [0.017, 0.008], [0.022, 0.022], [0.022, 0.038], [0.017, 0.053], [0.009, 0.062], [0, 0.066]];
  return mergePieces([leaf(outer, 0.4, [0, 0, 0], [0, 0, 0], C.fur, 10), leaf(inner, 0.4, [0, 0, 0.0085], [0, 0, 0], C.earInner, 10)]);
}

export function createBunny(opts: BunnyOptions = {}): Bunny {
  const C = BUNNY_COLORS;
  const P = BUNNY_PIVOT;
  const toons: Toon[] = [];
  const mk = (geo: THREE.BufferGeometry, name: string, widthFrac: number): THREE.Mesh => {
    const toon = makeToon({ base: '#ffffff', outline: { widthFrac, minPx: 1.4 } });
    toon.material.vertexColors = true;
    toon.material.needsUpdate = true;
    toons.push(toon);
    const m = toon.mesh(geo);
    m.name = name;
    return m;
  };
  const group = (name: string, at: V3): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...at);
    return g;
  };

  // body: a chubby egg, two soft haunches, two front paws on the snow, a puff tail baked in
  const body = mergePieces([
    ellipsoid([0, 0.092, -0.005], [0.098, 0.095, 0.105], C.fur, { seg: [12, 8], rot: [-0.12, 0, 0] }),
    ellipsoid([0.07, 0.05, -0.04], [0.05, 0.05, 0.07], C.fur, { seg: [8, 6] }),
    ellipsoid([-0.07, 0.05, -0.04], [0.05, 0.05, 0.07], C.fur, { seg: [8, 6] }),
    ellipsoid([0, 0.075, -0.105], [0.033, 0.033, 0.033], C.belly, { seg: [8, 6] }),
    ellipsoid([0, 0.07, 0.058], [0.062, 0.062, 0.05], C.belly, { seg: [8, 6] }),
    ellipsoid([0.034, 0.016, 0.085], [0.022, 0.017, 0.033], C.fur, { seg: [8, 5] }),
    ellipsoid([-0.034, 0.016, 0.085], [0.022, 0.017, 0.033], C.fur, { seg: [8, 5] }),
  ]);
  const head = mergePieces([ellipsoid(BUNNY_HEAD.c, BUNNY_HEAD.r, C.fur, { seg: [14, 9] })]);

  const meshes = {
    body: mk(body, 'bunny-body', 0.04),
    head: mk(head, 'bunny-head', 0.045),
    earL: mk(earGeometry(), 'bunny-ear-l', 0.08),
    earR: mk(earGeometry(), 'bunny-ear-r', 0.08),
  };

  const root = new THREE.Group();
  root.name = 'bunny';
  const motion = group('bunny-motion', [0, 0, 0]);
  const bodyG = group('bunny-body-pivot', [0, 0.06, 0]);
  const headG = group('bunny-head-pivot', P.neck);
  const earLG = group('bunny-ear-l-pivot', P.earL);
  const earRG = group('bunny-ear-r-pivot', P.earR);
  root.add(motion);
  motion.add(bodyG);
  bodyG.add(meshes.body);
  motion.add(headG);
  headG.add(meshes.head, earLG, earRG);
  earLG.add(meshes.earL);
  earRG.add(meshes.earR);
  // the body mesh was built about the ground; its pivot sits 0.06 up so a lean (body.rx) turns it about the haunches
  meshes.body.position.set(0, -0.06, 0);

  const face = createCompanionFace(
    BUNNY_HEAD,
    [
      { kind: 0, x: 0.04, y: 0.058, w: 0.034, h: 0.041 },
      { kind: 0, x: -0.04, y: 0.058, w: 0.034, h: 0.041 },
      { kind: 1, x: 0, y: 0.027, w: 0.02, h: 0.016 }, // the nose
    ],
    { shade: C.shade, nose: C.nose },
  );
  headG.add(face.mesh);

  const parts: Record<BunnyPartName, THREE.Group> = { motion, body: bodyG, head: headG, earL: earLG, earR: earRG };
  const rest = new Map<BunnyPartName, THREE.Vector3>();
  for (const n of BUNNY_PARTS) rest.set(n, parts[n].position.clone());

  const reduced0 = !!opts.reducedMotion;
  const behaviour = new Critter(BUNNY_DEF, { reducedMotion: reduced0, seed: opts.seed, auto: opts.auto });
  const blinker = new Blinker((opts.seed ?? 11) + 5, { minGap: 3, maxGap: 8, doubleChance: 0.08 });
  blinker.auto = !reduced0;
  let gx = 0;
  let gy = 0;
  let autoBlink = opts.auto ?? !reduced0;

  function applyPose(p: Pose): void {
    for (const n of BUNNY_PARTS) {
      const g = parts[n];
      const r = rest.get(n)!;
      g.position.set(r.x + (p[`${n}.px`] ?? 0), r.y + (p[`${n}.py`] ?? 0), r.z + (p[`${n}.pz`] ?? 0));
      g.rotation.set(p[`${n}.rx`] ?? 0, p[`${n}.ry`] ?? 0, p[`${n}.rz`] ?? 0);
    }
  }

  const bunny: Bunny = {
    root, parts, face, behaviour, applyPose,
    update(dt) {
      const f = behaviour.update(dt);
      const pose: Record<string, number> = { ...f.pose };
      const flL = f.gt.earFlickL >= 0 ? flickWave(f.gt.earFlickL) : 0;
      const flR = f.gt.earFlickR >= 0 ? flickWave(f.gt.earFlickR) : 0;
      pose['earL.rz'] = (pose['earL.rz'] ?? 0) - flL * 0.4;
      pose['earR.rz'] = (pose['earR.rz'] ?? 0) + flR * 0.4;
      pose['earL.rx'] = (pose['earL.rx'] ?? 0) + Math.abs(flL) * 0.12;
      pose['earR.rx'] = (pose['earR.rx'] ?? 0) + Math.abs(flR) * 0.12;
      applyPose(pose);
      const b = f.breath;
      meshes.body.scale.set(1 + b * 0.012, 1 + b * 0.03, 1 + b * 0.012);
      // the nose twitch: the nose patch slides a hair, and the head dips a hair (fast, tiny)
      const tw = f.gt.noseTwitch >= 0 ? twitchWave(f.gt.noseTwitch) : 0;
      face.setNoseShift(0, tw * 0.0016, 0);
      const slow = f.gt.slowBlink >= 0 ? slowBlinkAt(f.gt.slowBlink) : 0;
      const held = Math.max(f.eyes, slow);
      blinker.auto = autoBlink && behaviour.auto;
      const auto = blinker.update(dt);
      face.setBlink(held > 0 ? held : auto);
      const k = 1 - Math.exp(-Math.max(0, dt) / 0.3);
      gx += ((f.ch.gx ?? 0) - gx) * k;
      gy += ((f.ch.gy ?? 0) - gy) * k;
      face.setGaze(gx, gy);
      return f;
    },
    lookAt(x, y) {
      gx = x;
      gy = y;
      face.setGaze(x, y);
    },
    setReducedMotion(on) {
      behaviour.setReducedMotion(on);
      autoBlink = !on;
      blinker.auto = !on;
    },
    stats() {
      let tris = 0;
      let n = 0;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        n++;
        tris += triangleCount(m.geometry);
      });
      return { drawCalls: n, triangles: tris, meshes: n };
    },
    dispose() {
      for (const t of toons) t.dispose();
      face.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m !== face.mesh) m.geometry.dispose();
      });
    },
  };
  applyPose(behaviour.frame.pose);
  return bunny;
}
