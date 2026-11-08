import * as THREE from 'three';
import { createSky, type Sky } from './sky';
import { createMountains, type Mountains } from './mountains';
import { createAurora, type Aurora } from './aurora';
import { createMoon, type Moon } from './moon';
import { driftOffset, fitBackdropView, type Tier } from './backdropMath';

// Phase 12: the whole night backdrop in one object: sky dome, stars, moon, aurora (these four follow the camera's position, so they sit at
// infinity and never parallax) and the four mountain layers (these stay in the world and slide sideways at different rates in a slow drift,
// near layers more, so the valley has depth). Later phases add ground, pines and the cabin in FRONT of this; they never need to touch it.
//
// Draw calls: dome 1, stars 1, moon 1, aurora 1, mountains 4 = 8. Triangles: about 4.8k. Textures: none (every pixel is shader maths).

// SphereGeometry(r, 32, 20) = 32 * 20 * 2 - 32 * 2 (the pole rows have one triangle per segment); the moon is one quad; the aurora is 28 quads
const DOME_TRIANGLES = 32 * 20 * 2 - 32 * 2;
const MOON_TRIANGLES = 2;
const AURORA_TRIANGLES = 28 * 2;

export interface BackdropOptions {
  tier: Tier;
  reducedMotion: boolean;
  pixelRatio?: number;
}

export interface Backdrop {
  root: THREE.Group;
  sky: Sky;
  mountains: Mountains;
  aurora: Aurora;
  moon: Moon;
  /** Call once per frame before drawing. tSec is the sim clock; the camera is whatever is looking at the world. */
  update(tSec: number, camera: THREE.Camera): void;
  setPixelRatio(pr: number): void;
  /** Step down only (the FPS watchdog never steps up). */
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  /** What the backdrop costs, for tests and the debug log. */
  stats(): { drawCalls: number; triangles: number; stars: number };
  dispose(): void;
}

export function createBackdrop(opts: BackdropOptions): Backdrop {
  let reduced = opts.reducedMotion;
  const root = new THREE.Group();
  root.name = 'backdrop';
  const skyGroup = new THREE.Group();
  skyGroup.name = 'backdrop-sky';
  const sky = createSky({ tier: opts.tier, reducedMotion: reduced, pixelRatio: opts.pixelRatio });
  const aurora = createAurora({ tier: opts.tier, reducedMotion: reduced });
  const moon = createMoon();
  skyGroup.add(sky.dome, sky.stars, aurora.mesh, moon.mesh);
  const mountains = createMountains();
  root.add(skyGroup, mountains.group);

  return {
    root,
    sky,
    mountains,
    aurora,
    moon,
    update(tSec, camera) {
      skyGroup.position.copy(camera.position); // the sky is at infinity: it travels with the eye
      const drift = driftOffset(tSec, reduced);
      for (const { layer, mesh } of mountains.layers) mesh.position.x = drift * layer.parallax;
      sky.update(reduced ? 0 : tSec);
      aurora.update(reduced ? 0 : tSec);
    },
    setPixelRatio(pr) {
      sky.setPixelRatio(pr);
    },
    setTier(tier) {
      sky.setTier(tier);
      aurora.setTier(tier);
    },
    setReducedMotion(on) {
      reduced = on;
    },
    stats() {
      return { drawCalls: 4 + mountains.layers.length, triangles: mountains.triangles + DOME_TRIANGLES + MOON_TRIANGLES + AURORA_TRIANGLES, stars: sky.starCount };
    },
    dispose() {
      sky.dispose();
      aurora.dispose();
      moon.dispose();
      mountains.dispose();
      root.removeFromParent();
    },
  };
}

/** The test view's camera: eye height, a little upward pitch, a field of view by aspect (see fitBackdropView). The camera director (Phase 17) replaces this. */
export function placeBackdropCamera(camera: THREE.PerspectiveCamera, aspect: number, yawDeg = 0, pitchExtraDeg = 0): void {
  const v = fitBackdropView(aspect);
  camera.fov = v.fovDeg;
  camera.aspect = aspect;
  camera.near = 0.1;
  camera.far = 100;
  camera.position.set(0, v.eyeY, 0);
  camera.rotation.set(((v.pitchDeg + pitchExtraDeg) * Math.PI) / 180, (-yawDeg * Math.PI) / 180, 0, 'YXZ');
  camera.updateProjectionMatrix();
}
