// Phase 16: the cat. A small warm grey-cream cat, drawn by the same hand as Chamgadad (same toon ramp, same wobbling ink line, same eye language) but its own
// animal: a pointed triangle ear (no copy of her leaf ears), a lean round body, a long tail with a dark tip, cream bib and paws.
// Rigid parts, like Chamgadad: root > motion > body (hips) > fore (shoulders), head (> two ears, face), tail1 > tail2. Nine meshes with their ink hulls plus the face
// patch = 15 draw calls; about 3.4k triangles with the hulls (PB: the nook scene is 7 calls; Chamgadad is about 30).
// Units are metres; the cat faces +z and sits on y = 0. Every number is mine `[A]` (the cat is ours to design, not from her drawing).
import * as THREE from 'three';
import { makeToon, type Toon } from '../../render/toon/material';
import { Critter, flickWave, slowBlinkAt, type Frame, type Pose } from '../companion/engine';
import { createCompanionFace, type CompanionFace, type HeadEllipsoid } from '../companion/face';
import { ellipsoid, leaf, limb, mergePieces, triangleCount, type V3 } from '../companion/parts';
import { Blinker } from '../chamgadad/blink';
import { CAT_DEF, type CatGesture, type CatState } from './states';

/** The colours of the cat, sRGB hex. Warm grey-cream so it reads against the blue snow (AD) and on the blanket. */
export const CAT_COLORS = {
  fur: '#c8b8a0',
  dark: '#b3a28c',
  tip: '#7f7266',
  cream: '#eee4d3',
  earInner: '#d7b9b4',
  nose: '#c79a98',
  shade: '#2b2a33',
} as const;

/** Pivots in the cat's own frame (the origin is on the ground under the middle of the cat). */
export const CAT_PIVOT = {
  body: [0, 0.07, -0.06] as V3,
  shoulder: [0, 0.24, 0.05] as V3,
  neck: [0, 0.25, 0.06] as V3,
  tail1: [0, 0.055, -0.14] as V3,
  /** where tail2 hangs from tail1 (tail1's own frame) */
  tail2: [0, 0, -0.15] as V3,
  /** where the ears stand on the head (the head's own frame) */
  earL: [0.056, 0.108, -0.012] as V3,
  earR: [-0.056, 0.108, -0.012] as V3,
};
export const CAT_HEAD: HeadEllipsoid = { c: [0, 0.06, 0.014], r: [0.098, 0.082, 0.088] };
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export type CatPartName = 'motion' | 'body' | 'hind' | 'fore' | 'head' | 'earL' | 'earR' | 'tail1' | 'tail2';
export const CAT_PARTS: readonly CatPartName[] = ['motion', 'body', 'hind', 'fore', 'head', 'earL', 'earR', 'tail1', 'tail2'];

export interface CatStats {
  drawCalls: number;
  triangles: number;
  meshes: number;
}

export interface CatOptions {
  reducedMotion?: boolean;
  seed?: number;
  /** Automatic blinks, ear flicks and tail flicks (default on unless reduced motion). */
  auto?: boolean;
}

export interface Cat {
  /** Place and turn this one. */
  root: THREE.Group;
  parts: Record<CatPartName, THREE.Group>;
  face: CompanionFace;
  behaviour: Critter<CatState, CatGesture>;
  /** Apply a pose (rest + deltas) straight to the groups; the rig does this each frame, a test view can do it by hand. */
  applyPose(pose: Pose): void;
  /** Call once per frame (a fixed step is fine). Returns the frame it applied. */
  update(dt: number): Frame<CatState, CatGesture>;
  /** Look somewhere, -1..1 each (the shade inside the black slides). */
  lookAt(x: number, y: number): void;
  setReducedMotion(on: boolean): void;
  stats(): CatStats;
  dispose(): void;
}

function earGeometry(): THREE.BufferGeometry {
  const C = CAT_COLORS;
  const profile: [number, number][] = [[0, -0.004], [0.043, 0], [0.037, 0.02], [0.025, 0.045], [0.011, 0.066], [0, 0.077]];
  const inner: [number, number][] = [[0, 0.004], [0.026, 0.006], [0.021, 0.022], [0.012, 0.043], [0.005, 0.056], [0, 0.062]];
  return mergePieces([leaf(profile, 0.38, [0, 0, 0], [0, 0, 0], C.fur, 8), leaf(inner, 0.38, [0, 0, 0.0075], [0, 0, 0], C.earInner, 8)]);
}

export function createCat(opts: CatOptions = {}): Cat {
  const C = CAT_COLORS;
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

  // body: torso (leaning forward a little), haunches, hind paws, cream bib, a dark saddle on the back
  const P = CAT_PIVOT;
  const body = mergePieces(
    [
      ellipsoid([0, 0.15, -0.035], [0.1, 0.15, 0.1], C.fur, { seg: [10, 8], rot: [0.2, 0, 0] }),
      ellipsoid([0.085, 0.09, -0.06], [0.07, 0.085, 0.1], C.fur, { seg: [9, 6] }),
      ellipsoid([-0.085, 0.09, -0.06], [0.07, 0.085, 0.1], C.fur, { seg: [9, 6] }),
      ellipsoid([0, 0.17, 0.045], [0.062, 0.11, 0.04], C.cream, { seg: [8, 6], rot: [0.2, 0, 0] }),
      ellipsoid([0, 0.2, -0.118], [0.05, 0.08, 0.022], C.dark, { seg: [8, 6], rot: [0.2, 0, 0] }),
    ],
    P.body,
  );
  // the hind paws are their own part so that a lying cat can keep them flat on the blanket while her body turns forward
  const hind = mergePieces(
    [
      ellipsoid([0.065, 0.025, 0.045], [0.032, 0.025, 0.06], C.cream, { seg: [8, 5] }),
      ellipsoid([-0.065, 0.025, 0.045], [0.032, 0.025, 0.06], C.cream, { seg: [8, 5] }),
    ],
    P.body,
  );
  const fore = mergePieces(
    [
      limb([0.045, 0.24, 0.05], [0.05, 0.035, 0.085], 0.03, 0.024, C.fur, 7),
      limb([-0.045, 0.24, 0.05], [-0.05, 0.035, 0.085], 0.03, 0.024, C.fur, 7),
      ellipsoid([0.05, 0.024, 0.1], [0.03, 0.023, 0.04], C.cream, { seg: [8, 5] }),
      ellipsoid([-0.05, 0.024, 0.1], [0.03, 0.023, 0.04], C.cream, { seg: [8, 5] }),
    ],
    P.shoulder,
  );
  const head = mergePieces([ellipsoid(CAT_HEAD.c, CAT_HEAD.r, C.fur, { seg: [12, 8] })]);
  const tail1 = mergePieces([limb([0, 0, 0], [0, 0, -0.15], 0.027, 0.023, C.fur, 7)]);
  const tail2 = mergePieces([limb([0, 0, 0], [0, 0, -0.15], 0.023, 0.017, C.tip, 7)]);

  const meshes = {
    body: mk(body, 'cat-body', 0.034),
    hind: mk(hind, 'cat-hind', 0.05),
    fore: mk(fore, 'cat-fore', 0.05),
    head: mk(head, 'cat-head', 0.04),
    earL: mk(earGeometry(), 'cat-ear-l', 0.07),
    earR: mk(earGeometry(), 'cat-ear-r', 0.07),
    tail1: mk(tail1, 'cat-tail-1', 0.07),
    tail2: mk(tail2, 'cat-tail-2', 0.08),
  };

  const root = new THREE.Group();
  root.name = 'cat';
  const motion = group('cat-motion', [0, 0, 0]);
  const bodyG = group('cat-body-pivot', P.body);
  const hindG = group('cat-hind-pivot', [0, 0, 0]);
  const foreG = group('cat-fore-pivot', sub(P.shoulder, P.body));
  const headG = group('cat-head-pivot', sub(P.neck, P.body));
  const earLG = group('cat-ear-l-pivot', P.earL);
  const earRG = group('cat-ear-r-pivot', P.earR);
  const tail1G = group('cat-tail-1-pivot', sub(P.tail1, P.body));
  const tail2G = group('cat-tail-2-pivot', P.tail2);
  root.add(motion);
  motion.add(bodyG);
  bodyG.add(meshes.body, hindG, foreG, headG, tail1G);
  hindG.add(meshes.hind);
  foreG.add(meshes.fore);
  headG.add(meshes.head, earLG, earRG);
  earLG.add(meshes.earL);
  earRG.add(meshes.earR);
  tail1G.add(meshes.tail1, tail2G);
  tail2G.add(meshes.tail2);

  // the face: two big eyes and a small nose on the head's ellipsoid, in the head's own frame (the head mesh is built about the neck pivot)
  const face = createCompanionFace(
    CAT_HEAD,
    [
      { kind: 0, x: 0.043, y: 0.058, w: 0.036, h: 0.043 },
      { kind: 0, x: -0.043, y: 0.058, w: 0.036, h: 0.043 },
      { kind: 1, x: 0, y: 0.024, w: 0.018, h: 0.015 }, // the nose
    ],
    { shade: C.shade, nose: C.nose },
  );
  headG.add(face.mesh);

  const parts: Record<CatPartName, THREE.Group> = { motion, body: bodyG, hind: hindG, fore: foreG, head: headG, earL: earLG, earR: earRG, tail1: tail1G, tail2: tail2G };
  const rest = new Map<CatPartName, THREE.Vector3>();
  for (const n of CAT_PARTS) rest.set(n, parts[n].position.clone());

  const reduced0 = !!opts.reducedMotion;
  const behaviour = new Critter(CAT_DEF, { reducedMotion: reduced0, seed: opts.seed, auto: opts.auto });
  const blinker = new Blinker((opts.seed ?? 11) + 3, { minGap: 3.5, maxGap: 9, doubleChance: 0.05 });
  blinker.auto = !reduced0;
  let gx = 0;
  let gy = 0;
  let gtx = 0;
  let gty = 0;
  let autoBlink = opts.auto ?? !reduced0;

  function applyPose(p: Pose): void {
    for (const n of CAT_PARTS) {
      const g = parts[n];
      const r = rest.get(n)!;
      g.position.set(r.x + (p[`${n}.px`] ?? 0), r.y + (p[`${n}.py`] ?? 0), r.z + (p[`${n}.pz`] ?? 0));
      g.rotation.set(p[`${n}.rx`] ?? 0, p[`${n}.ry`] ?? 0, p[`${n}.rz`] ?? 0);
    }
  }

  const cat: Cat = {
    root, parts, face, behaviour,
    applyPose,
    update(dt) {
      const f = behaviour.update(dt);
      const pose: Record<string, number> = { ...f.pose };
      // gestures ride on top of the posture
      const flL = f.gt.earFlickL >= 0 ? flickWave(f.gt.earFlickL) : 0;
      const flR = f.gt.earFlickR >= 0 ? flickWave(f.gt.earFlickR) : 0;
      pose['earL.rz'] = (pose['earL.rz'] ?? 0) - flL * 0.45;
      pose['earR.rz'] = (pose['earR.rz'] ?? 0) + flR * 0.45;
      pose['earL.rx'] = (pose['earL.rx'] ?? 0) + Math.abs(flL) * 0.12;
      pose['earR.rx'] = (pose['earR.rx'] ?? 0) + Math.abs(flR) * 0.12;
      if (f.gt.tailFlick >= 0) {
        const w = flickWave(f.gt.tailFlick, 1.0);
        pose['tail1.ry'] = (pose['tail1.ry'] ?? 0) + w * 0.18;
        pose['tail2.ry'] = (pose['tail2.ry'] ?? 0) + w * 0.5;
      }
      // the purr's tremor
      pose['motion.py'] = (pose['motion.py'] ?? 0) + f.shiver * 0.0025;
      applyPose(pose);
      // breath: the body mesh rises a little about the hips (the children do not scale with it)
      const b = f.breath;
      meshes.body.scale.set(1 + b * 0.012, 1 + b * 0.03, 1 + b * 0.012);
      // eyes: a held closure, a slow blink, or the automatic blinks
      const slow = f.gt.slowBlink >= 0 ? slowBlinkAt(f.gt.slowBlink) : 0;
      const held = Math.max(f.eyes, slow);
      blinker.auto = autoBlink && behaviour.auto;
      const auto = blinker.update(dt);
      face.setBlink(held > 0 ? held : auto);
      gtx = f.ch.gx ?? 0;
      gty = f.ch.gy ?? 0;
      const k = 1 - Math.exp(-Math.max(0, dt) / 0.3);
      gx += (gtx - gx) * k;
      gy += (gty - gy) * k;
      face.setGaze(gx, gy);
      return f;
    },
    lookAt(x, y) {
      gx = gtx = x;
      gy = gty = y;
      face.setGaze(x, y);
    },
    setReducedMotion(on) {
      behaviour.setReducedMotion(on);
      autoBlink = !on;
      blinker.auto = !on;
    },
    stats() {
      let calls = 0;
      let tris = 0;
      let n = 0;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        n++;
        calls++;
        tris += triangleCount(m.geometry);
      });
      return { drawCalls: calls, triangles: tris, meshes: n };
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
  return cat;
}
