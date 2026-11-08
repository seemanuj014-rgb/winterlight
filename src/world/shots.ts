// Phase 17: the shots the camera director plays in this world. Pure data: no three, no DOM, so it is unit-tested.
// The director itself (`core/directorMath.ts`) knows nothing about the cabin or the snow; the coordinates live here, built from the same constants the world is built from.
// Acts (Phase 19 on) pick shots by name. `TOUR` is the whole run in order and is what the `?tour` test view plays.
// Metres; the eye stands 1.55 m above the snow outdoors. `[A]`: every position, length and field of view is a first guess, tuned by eye.

import type { Shot, V3 } from '../core/directorMath';
import { CABIN_SITE, STAGE, terrainHeight } from './groundMath';
import { CABIN, CABIN_FACING_DEG, NOOK, NOOK_ORIGIN } from './cabinMath';

export const EYE_HEIGHT = 1.55;
/** Chamgadad is about 7 units tall in her own units; the rig is scaled by this to stand about 1.4 m (Phase 14 note, `[A]`, Phase 19 owns the final size). */
export const CHAMGADAD_SCALE = 0.2;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** A point in the cabin's own frame (origin at the middle of the footprint, the door on +z) to the world. */
export function cabinToWorld(x: number, y: number, z: number): V3 {
  const th = rad(CABIN_FACING_DEG);
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [x * c + z * s + CABIN_SITE.x, y, -x * s + z * c + CABIN_SITE.z];
}
/** The reverse: a world point in the cabin's own frame. */
export function worldToCabin(p: V3): V3 {
  const th = rad(CABIN_FACING_DEG);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dx = p[0] - CABIN_SITE.x;
  const dz = p[2] - CABIN_SITE.z;
  return [dx * c - dz * s, p[1], dx * s + dz * c];
}

/** A point outdoors with its height above the snow. */
const snow = (x: number, h: number, z: number): V3 => [x, terrainHeight(x, z) + h, z];
/** A point in the nook (its own frame) to the world. */
const nook = (x: number, y: number, z: number): V3 => [x + NOOK_ORIGIN[0], y + NOOK_ORIGIN[1], z + NOOK_ORIGIN[2]];

export type Location = 'nook' | 'outside';
/** Where the camera is: the nook hangs 50 m above the ground, so height tells. The app hides the other place while it is here. */
export const locationOfEye = (eyeY: number): Location => (eyeY > NOOK_ORIGIN[1] - 25 ? 'nook' : 'outside');

/** Where the cast stands for the tour (test placement; the acts own the real ones from Phase 19). */
export const SPOTS = {
  /** Chamgadad asleep on the bed (feet on the mattress; `y` is the top of the blanket there) */
  chamgadadBed: nook(NOOK.sleepSpot[0], NOOK.bed.top + 0.1, NOOK.sleepSpot[2]),
  /** Chamgadad on the stage clearing, facing the viewer's side */
  chamgadadStage: snow(STAGE.x, 0, STAGE.z),
  /** the cat on the blanket's lump (the same place `?nook&cat` uses) */
  cat: nook(NOOK.bed.x + 0.46, 0.765, NOOK.bed.z),
  /** the bunny at the edge of the stage clearing, to her left */
  bunny: snow(-1.9, 0, -3.1),
} as const;

// The doorway, in the cabin's own frame: the door is in the front wall (z = hz) at x 0, 1 m wide and 2 m tall.
const DOOR_Z = CABIN.hz;

// A pose at the end of the push-out, kept in one place so the next shot can start exactly there.
const OUT_EYE = cabinToWorld(0.05, EYE_HEIGHT, 4.4);
const OUT_LOOK = cabinToWorld(0, 3.2, 12);
const STAGE_EYE_A: V3 = snow(1.2, EYE_HEIGHT, -0.2);
const STAGE_EYE_B: V3 = snow(0.9, EYE_HEIGHT - 0.05, -1.2);
const STAGE_LOOK: V3 = snow(0, 1.2, STAGE.z);

export const SHOTS = {
  /** Act 1: the room from its open side, a slow dolly in */
  nookWide: {
    name: 'nookWide',
    eye: [nook(0.1, 1.35, 5.5), nook(0.1, 1.3, 4.7)],
    look: [nook(-0.05, 0.95, -1.2), nook(-0.3, 0.85, -1.15)],
    fov: [42, 40],
    seconds: 9,
    hold: 0.5,
  },
  /** closer, toward the bed where Chamgadad sleeps; she wakes as the camera arrives */
  nookBed: {
    name: 'nookBed',
    eye: [nook(0.1, 1.3, 4.7), nook(0.45, 1.15, 3.0), nook(0.5, 1.05, 2.1)],
    look: [nook(-0.3, 0.85, -1.15), nook(-0.8, 0.7, -1.05)],
    fov: [40, 36],
    seconds: 8,
    hold: 0.5,
    cues: [{ at: 0.2, name: 'chamgadadWake' }],
  },
  /** the head turns toward the door in the right wall; the cat wakes */
  nookDoor: {
    name: 'nookDoor',
    eye: [nook(0.5, 1.05, 2.1), nook(-0.3, 1.25, 2.6)],
    look: [nook(-0.8, 0.7, -1.05), nook(0.7, 1.0, -0.2), nook(NOOK.hx - 0.1, 1.15, NOOK.doorZ)],
    fov: [36, 40],
    seconds: 7,
    hold: 0.8,
    cues: [{ at: 0.3, name: 'catWake' }],
  },
  /**
   * Phase 19, the "let her sleep" secret: while nobody touches the screen the camera drifts slowly in toward her and the lamp sinks (the act dims it).
   * Starts from where `nookWide` ended, so it is smooth from any moment. `[A]`.
   */
  nookSleep: {
    name: 'nookSleep',
    eye: [nook(0.1, 1.3, 4.7), nook(-0.1, 1.15, 3.7), nook(-0.35, 1.05, 3.1)],
    look: [nook(-0.3, 0.85, -1.15), nook(-0.8, 0.72, -1.05)],
    fov: [40, 34],
    seconds: 16,
    handheld: 0.6,
  },
  /** Phase 19, Act 2: she hops across the room to the door and the camera goes with her, wide enough to keep the whole path in frame. `[A]` */
  nookWalk: {
    name: 'nookWalk',
    eye: [nook(0.5, 1.05, 2.1), nook(0.5, 1.2, 3.3), nook(0.2, 1.35, 4.0)],
    look: [nook(-0.8, 0.7, -1.05), nook(0.1, 0.7, -0.1), nook(1.2, 0.8, 0.7)],
    fov: [38, 44],
    seconds: 9,
    hold: 0,
  },
  /** Phase 19, Act 2: she stands at the door and it swings open. `[A]` */
  nookAtDoor: {
    name: 'nookAtDoor',
    eye: [nook(0.2, 1.35, 4.0), nook(0.4, 1.3, 3.6)],
    look: [nook(1.2, 0.8, 0.7), nook(1.7, 0.95, 0.9)],
    fov: [44, 42],
    seconds: 7,
    hold: 0,
  },
  /**
   * The push-out (Act 2): the camera starts just inside the doorway looking at the shut door, the door swings open, and the camera pushes out through it into the snow.
   * Starts with a cut (the nook is 50 m up). The warm panel in the doorway is not seen from inside, so the first frame is the dark back of the door.
   */
  doorOut: {
    name: 'doorOut',
    eye: [cabinToWorld(0, EYE_HEIGHT, DOOR_Z - 0.55), cabinToWorld(0, EYE_HEIGHT, DOOR_Z + 0.6), OUT_EYE],
    look: [cabinToWorld(0, 1.5, DOOR_Z + 1.1), cabinToWorld(0, 1.8, 6.5), OUT_LOOK],
    fov: [46, 44],
    seconds: 6.5,
    handheld: 1.3,
    channels: { door: [[0, 0], [0.08, 0], [0.36, 1]] },
    cues: [{ at: 0.08, name: 'doorOpen' }],
  },
  /** first footsteps: a slow walk through the snow, turning to find her */
  snowWalk: {
    name: 'snowWalk',
    eye: [OUT_EYE, snow(5.4, EYE_HEIGHT, -7.2), snow(3.9, EYE_HEIGHT, -2.6), STAGE_EYE_A],
    look: [OUT_LOOK, STAGE_LOOK],
    fov: [44, 38],
    seconds: 11,
    handheld: 1.6,
  },
  /** Chamgadad on the stage, the cabin glowing behind her; she waves, the bunny peeks and hops */
  stage: {
    name: 'stage',
    eye: [STAGE_EYE_A, STAGE_EYE_B],
    look: [STAGE_LOOK, [STAGE_LOOK[0], STAGE_LOOK[1] + 0.05, STAGE_LOOK[2]]],
    fov: [38, 36],
    seconds: 8,
    hold: 1.5,
    cues: [
      { at: 0.15, name: 'chamgadadWave' },
      { at: 0.45, name: 'bunnyPeek' },
      { at: 0.8, name: 'bunnyHop' },
    ],
  },
  /**
   * Phase 20: close on the pair for petting the cat: Chamgadad sitting up on the bed and the cat on the blanket beside her. A slow settle-in, then it holds (the last frame stays).
   * Not part of the tour or the acts (the "stay a while" mode of Phase 28 will call it). `[A]`
   */
  petCat: {
    name: 'petCat',
    eye: [nook(-0.1, 1.25, 2.5), nook(-0.5, 1.12, 1.85)],
    look: [nook(-0.6, 0.86, -1.05), nook(-0.42, 0.86, -1.05)],
    fov: [40, 36.5],
    seconds: 6,
    handheld: 0.5,
  },
  /**
   * Phase 20: Chamgadad on the stage and the bunny at the edge of the clearing, close enough that her hops read. A slow settle-in, then it holds. `[A]`
   */
  petBunny: {
    name: 'petBunny',
    eye: [snow(1.9, EYE_HEIGHT - 0.2, -0.4), snow(0.5, EYE_HEIGHT - 0.4, 0.6)],
    look: [snow(-0.7, 0.55, -3.8), snow(-0.95, 0.2, -3.8)],
    fov: [38, 48],
    seconds: 6,
    handheld: 0.5,
  },
  /** tip the head back to the sky (the five names go there from Phase 22) */
  skyLook: {
    name: 'skyLook',
    eye: [STAGE_EYE_B],
    look: [STAGE_LOOK, snow(-2, 9.5, -16), snow(0.5, 11, -18)],
    fov: [36, 46],
    seconds: 9,
    hold: 1,
  },
  /** the finale pull-back: up and away through the pines until the cabin glows small in the valley */
  finale: {
    name: 'finale',
    eye: [STAGE_EYE_B, snow(-1, 3.0, 3), snow(-5, 6.5, 9), snow(-8, 8.0, 14)],
    look: [snow(0, 2.5, -10), snow(3, 2.5, -13), snow(6, 2.5, -14.5)],
    fov: [46, 34],
    seconds: 16,
    handheld: 0.8,
  },
} as const satisfies Record<string, Shot>;

export type ShotName = keyof typeof SHOTS;
export const SHOT_NAMES = Object.keys(SHOTS) as ShotName[];
/** The whole run, in order (the `?tour` view plays it; the door push-out is a cut from the nook). */
export const TOUR: readonly ShotName[] = ['nookWide', 'nookBed', 'nookDoor', 'doorOut', 'snowWalk', 'stage', 'skyLook', 'finale'];
