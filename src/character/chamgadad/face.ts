// Phase 7: Chamgadad's face: two eyes with brows, gaze, blink. No mouth: the long curve under her face is Q1 (smile or chin) and
// is not drawn here until the owner decides. No nose, lashes or blush: not in her drawing.
import * as THREE from 'three';
import type { ChamgadadHead } from './head';
import { createEye, disposeEye, type EyeObject } from './eyes';
import { Blinker } from './blink';
import { clampGaze, newGaze, setGazeTarget, stepGaze, GAZE_TARGETS, type GazeName, type GazeState } from './gaze';

/** Largest shift of the shade inside the black, as a fraction of an eye patch (about 10 px of her drawing at the limit). */
export const GAZE_SHIFT_UV = 0.04;
/** How much the head turning under a fixed light slides the marks, and the most they may move (fraction of a patch). */
export const LIGHT_SHIFT_GAIN = 0.2;
export const LIGHT_SHIFT_MAX = 0.05;
/** Where the key light is in the world (same as createHeadKeyLight). */
const KEY_DIR = new THREE.Vector3(3, 4, 5).normalize();

export interface Face {
  group: THREE.Group;
  eyes: EyeObject[];
  ready: Promise<void>;
  gaze: GazeState;
  blinker: Blinker;
  /** Look at one of the five named targets, or any (x, y) in -1..1 (clamped to the eyes' limits). */
  lookAt(target: GazeName | readonly [number, number]): void;
  /** Snap straight to the target (no smoothing); screenshots and tests use this. */
  snapGaze(): void;
  /** Force a blink amount 0..1 and stop the automatic blinks (for screenshots). */
  holdBlink(amount: number | null): void;
  update(dt: number): void;
  dispose(): void;
}

export function createFace(head: ChamgadadHead, opts: { reducedMotion?: boolean; seed?: number } = {}): Face {
  const group = new THREE.Group();
  group.name = 'face';
  const eyes = [createEye('left', head.built), createEye('right', head.built)];
  for (const e of eyes) group.add(e.mesh);
  head.group.add(group);
  const gaze = newGaze();
  const blinker = new Blinker(opts.seed ?? 7);
  blinker.auto = !opts.reducedMotion;
  let held: number | null = null;
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();

  const apply = (blink: number): void => {
    const [gx, gy] = clampGaze(gaze.x, gaze.y);
    // light in the head's own frame, minus where it is when the head faces the camera: how much the head has turned under the light
    head.group.getWorldQuaternion(tmpQ).invert();
    tmpV.copy(KEY_DIR).applyQuaternion(tmpQ);
    const lx = THREE.MathUtils.clamp((tmpV.x - KEY_DIR.x) * LIGHT_SHIFT_GAIN, -LIGHT_SHIFT_MAX, LIGHT_SHIFT_MAX);
    const ly = THREE.MathUtils.clamp((tmpV.y - KEY_DIR.y) * LIGHT_SHIFT_GAIN, -LIGHT_SHIFT_MAX, LIGHT_SHIFT_MAX);
    for (const e of eyes) {
      const u = e.material.uniforms;
      (u.uGaze!.value as THREE.Vector2).set(gx * GAZE_SHIFT_UV, gy * GAZE_SHIFT_UV);
      (u.uLight!.value as THREE.Vector2).set(lx, ly);
      u.uBlink!.value = blink;
    }
  };
  apply(0);

  return {
    group, eyes, gaze, blinker,
    ready: Promise.all(eyes.map((e) => e.ready)).then(() => undefined),
    lookAt(t) {
      const [x, y] = typeof t === 'string' ? GAZE_TARGETS[t] : t;
      setGazeTarget(gaze, x, y);
    },
    snapGaze() {
      gaze.x = gaze.tx;
      gaze.y = gaze.ty;
      apply(held ?? 0);
    },
    holdBlink(amount) {
      held = amount;
      apply(held ?? 0);
    },
    update(dt) {
      stepGaze(gaze, dt);
      apply(held ?? blinker.update(dt));
    },
    dispose() {
      for (const e of eyes) disposeEye(e);
      head.group.remove(group);
    },
  };
}
