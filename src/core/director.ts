import * as THREE from 'three';
import { Director, fovForAspect, type DirectorOptions, type Frame } from './directorMath';

// Phase 17: puts a director frame onto the one camera. The maths is in `directorMath.ts` (pure, tested); this file only writes numbers onto three.js.
// It knows nothing about the scene: the shots come from `world/shots.ts`, the app (main.ts, later the acts) decides which one to play.

export interface CameraRig {
  readonly director: Director;
  /** the screen's width over height, so a tall phone gets a wider field (call from the stage's resize callback) */
  setAspect(aspect: number): void;
  /** Advance the director and write its frame onto the camera. Call once per fixed step, or once per frame with the frame time. */
  update(dt: number): Frame;
  /** Write the director's current frame onto the camera again (after a resize, with no time passing). */
  apply(): void;
}

export function createCameraRig(camera: THREE.PerspectiveCamera, opts: DirectorOptions = {}): CameraRig {
  const director = new Director(opts);
  let aspect = camera.aspect || 1;
  const tmp = new THREE.Vector3();

  function write(f: Frame): void {
    camera.position.set(f.eye[0], f.eye[1], f.eye[2]);
    tmp.set(f.look[0], f.look[1], f.look[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(tmp);
    if (f.roll !== 0) camera.rotateZ(f.roll);
    camera.aspect = aspect;
    camera.fov = fovForAspect(f.fov, aspect);
    camera.updateProjectionMatrix();
  }

  return {
    director,
    setAspect(a) {
      if (Number.isFinite(a) && a > 0) aspect = a;
    },
    update(dt) {
      const f = director.update(dt);
      if (f.shot) write(f);
      return f;
    },
    apply() {
      const f = director.frame;
      if (f.shot) write(f);
    },
  };
}
