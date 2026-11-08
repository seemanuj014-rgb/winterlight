// Phase 8: drives the two ears of a ChamgadadHead with the pure EarMotion (earSpring.ts).
// Each frame it measures how the head moved (rotation and sideways move, in the head's own axes), hands that to the springs,
// then writes the result onto the ear groups (about their pivots) and the bowls (the fold flex). At rest everything is zero,
// so the ears are exactly where Phase 6 left them. No new meshes, no new draw calls.
import * as THREE from 'three';
import type { QualityTier } from '../../core/quality';
import type { ChamgadadHead } from './head';
import { earAxis, earModeForTier, EarMotion, EAR_NAMES, type EarAxis, type EarMotionMode, type EarName } from './earSpring';

/** One frame's head motion is clamped to this (radians, world units), so a teleport or a camera cut does not fling the ears. */
const MAX_ROT_PER_FRAME = 0.5;
const MAX_MOVE_PER_FRAME = 1;

export interface EarDriver {
  motion: EarMotion;
  /** Call once per frame after the head's own transform has been set for that frame. */
  update(dt: number): void;
  /** Flick one ear or both. */
  flick(which: EarName | 'both', strength?: number): void;
  /** Forget where the head was (use after teleporting it), so the next frame produces no kick. */
  resync(): void;
  /** Put both ears back at rest. */
  reset(): void;
}

export interface EarDriverOptions {
  reducedMotion?: boolean;
  /** Quality tier: low gets the sine sway, the others the springs. Ignored if `mode` is given. */
  tier?: QualityTier;
  mode?: EarMotionMode;
  seed?: number;
  /** Automatic flicks (default: on unless reduced motion). */
  auto?: boolean;
}

export function createEarDriver(head: ChamgadadHead, opts: EarDriverOptions = {}): EarDriver {
  const headCx = head.built.head.centre[0];
  const axes = {} as Record<EarName, EarAxis>;
  const objs = { upright: head.earUpright, angled: head.earAngled };
  const built = { upright: head.built.earUpright, angled: head.built.earAngled };
  for (const n of EAR_NAMES) axes[n] = earAxis(built[n].flap.positions, built[n].pivot, headCx);

  const mode = opts.mode ?? (opts.tier ? earModeForTier(opts.tier) : 'spring');
  const motion = new EarMotion(axes, { mode, reducedMotion: opts.reducedMotion, seed: opts.seed });
  if (opts.auto !== undefined) motion.auto = opts.auto;

  const q = new THREE.Quaternion();
  const prevQ = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const prevP = new THREE.Vector3();
  const mv = new THREE.Vector3();
  let have = false;

  const apply = (): void => {
    for (const n of EAR_NAMES) {
      const pose = motion.pose(n);
      objs[n].group.rotation.set(pose.rx, pose.ry, pose.rz);
      objs[n].bowlMesh.rotation.set(0, 0, pose.flex);
    }
  };

  const driver: EarDriver = {
    motion,
    update(dt) {
      head.group.getWorldQuaternion(q);
      head.group.getWorldPosition(p);
      if (have) {
        // rotation of the head since last frame, written in the head's own axes: q = dq * prev, local = q^-1 * (dq as a rotation)
        dq.copy(q).multiply(prevQ.invert()); // world-frame delta
        let ang = 2 * Math.acos(Math.min(1, Math.abs(dq.w)));
        const sign = dq.w < 0 ? -1 : 1;
        const s = Math.sqrt(Math.max(1 - dq.w * dq.w, 0));
        const ax = s > 1e-9 ? new THREE.Vector3(dq.x, dq.y, dq.z).multiplyScalar(sign / s) : new THREE.Vector3(0, 0, 1);
        ang = Math.min(ang, MAX_ROT_PER_FRAME);
        ax.applyQuaternion(q.clone().invert()); // into the head's frame
        mv.copy(p).sub(prevP);
        if (mv.length() > MAX_MOVE_PER_FRAME) mv.setLength(MAX_MOVE_PER_FRAME);
        mv.applyQuaternion(q.clone().invert());
        motion.couple({ rx: ax.x * ang, ry: ax.y * ang, rz: ax.z * ang, mx: mv.x, my: mv.y });
      }
      prevQ.copy(q);
      prevP.copy(p);
      have = true;
      motion.update(dt);
      apply();
    },
    flick(which, strength) {
      motion.flick(which, strength);
    },
    resync() {
      have = false;
    },
    reset() {
      motion.reset();
      apply();
    },
  };
  apply();
  return driver;
}
