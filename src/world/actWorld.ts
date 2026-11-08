import type * as THREE from 'three';
import type { CameraRig } from '../core/director';
import type { Frame } from '../core/directorMath';
import type { Rig } from '../character/chamgadad/rig';
import type { Cat } from '../character/cat/cat';
import type { Bunny } from '../character/bunny/bunny';
import type { Nook } from './nook';
import type { Cabin } from './cabin';
import type { Lighting } from './lighting';
import type { Location } from './shots';

// Phase 19: what the acts are handed. Types only (no three code runs here), so the world's assembly (`tourView.ts`) and the acts (`src/acts/`) can share it without
// importing each other. The acts own what happens; the world only offers its parts.

export interface ActWorld {
  readonly camera: THREE.PerspectiveCamera;
  /** the camera rig (its `.director` plays shots): the acts ask it for shots by name (`world/shots.ts`) */
  readonly cameraRig: CameraRig;
  readonly actor: Rig;
  readonly cat: Cat;
  readonly bunny: Bunny;
  readonly nook: Nook;
  readonly nookLights: Lighting;
  readonly cabin: Cabin;
  /** Chamgadad's holder (her pose drives her own group; the placement lives on this) */
  readonly holder: THREE.Group;
  /** where the camera is now; the app hides the other place */
  readonly location: Location;
  /**
   * Put her seat on a spot in the NOOK's own frame (metres; `y` is the ground she sits on there) and turn her to `yaw` (radians about the vertical, 0 = +z).
   * Her height over the ground is taken from her posture, so a hop's own lift is untouched.
   */
  placeInNook(x: number, y: number, z: number, yaw: number): void;
}

/** What the world calls on the acts. `step` runs once per fixed step, BEFORE the camera director moves, and gets the frame the director showed last. */
export interface ActsHook {
  start(): void;
  step(dt: number, frame: Frame): void;
  /** every drawn frame (the focus ring follows her on screen) */
  render(): void;
  resize(widthPx: number, heightPx: number): void;
}
