// Phase 6: the reference camera. An orthographic camera whose image plane is her drawing (see refFrame.ts for the maths).
// From a square canvas it shows exactly the drawing's square, so a screenshot lines up 1:1 with the reference image.
import * as THREE from 'three';
import { refOrthoBounds, REF_CAMERA_Z } from './refFrame';

export function createReferenceCamera(aspect = 1): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, REF_CAMERA_Z * 4);
  cam.position.set(0, 0, REF_CAMERA_Z);
  cam.lookAt(0, 0, 0);
  fitReferenceCamera(cam, aspect);
  return cam;
}

/** Call on every resize. Shows the whole drawing at any aspect. */
export function fitReferenceCamera(cam: THREE.OrthographicCamera, aspect: number): void {
  const b = refOrthoBounds(aspect);
  cam.left = b.left;
  cam.right = b.right;
  cam.top = b.top;
  cam.bottom = b.bottom;
  cam.updateProjectionMatrix();
}
