// Phase 9: poses as data (no three). A pose is a small set of rotations and offsets, one per movable part, applied on top of the
// rest layout by body.ts. Phase 10's rig will blend between these and animate them; nothing here moves by itself.
// All angles are radians. Every number is [A]: her drawing is one still of a head and chest.

export type PartName = 'root' | 'neck' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR' | 'tail';
export interface PartPose {
  /** Added to the part's rest position. */
  pos: readonly [number, number, number];
  /** Euler XYZ rotation about the part's own pivot. */
  rot: readonly [number, number, number];
}
export type Pose = Record<PartName, PartPose>;
export type PoseName = 'sit' | 'curl';

const ID: PartPose = { pos: [0, 0, 0], rot: [0, 0, 0] };
const d = (deg: number): number => (deg * Math.PI) / 180;

/** Sitting up, arms resting on the chest with the paws together (the drawing's V), feet out front, tail behind. The rest layout. */
export const SIT: Pose = { root: ID, neck: ID, torso: ID, armL: ID, armR: ID, legL: ID, legR: ID, tail: ID };

/**
 * Curled up asleep on its side, belly toward the viewer: the whole body lies down (root rolls a quarter turn), the head tips down
 * toward the chest, the legs fold up, the arms stay tucked, the tail wraps round the front. [A]
 */
export const CURL: Pose = {
  root: { pos: [0, 0, 0], rot: [0, 0, d(-82)] },
  neck: { pos: [0, 0, 0], rot: [d(8), d(-6), d(52)] },
  torso: { pos: [0, 0, 0], rot: [0, 0, d(-14)] },
  armL: { pos: [0, 0, 0], rot: [0, 0, d(-6)] },
  armR: { pos: [0, 0, 0], rot: [0, 0, d(6)] },
  legL: { pos: [0.12, 0.2, 0.1], rot: [d(-38), 0, d(10)] },
  legR: { pos: [-0.12, 0.2, 0.1], rot: [d(-38), 0, d(-10)] },
  tail: { pos: [0, 0.2, 0.2], rot: [d(0), d(-150), d(-20)] },
};

export const POSES: Record<PoseName, Pose> = { sit: SIT, curl: CURL };

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const k = Math.min(1, Math.max(0, t));
  const out = {} as Pose;
  for (const name of Object.keys(a) as PartName[]) {
    const pa = a[name], pb = b[name];
    out[name] = {
      pos: [0, 1, 2].map((i) => pa.pos[i]! + (pb.pos[i]! - pa.pos[i]!) * k) as unknown as [number, number, number],
      rot: [0, 1, 2].map((i) => pa.rot[i]! + (pb.rot[i]! - pa.rot[i]!) * k) as unknown as [number, number, number],
    };
  }
  return out;
}
