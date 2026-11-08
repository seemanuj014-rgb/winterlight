import * as THREE from 'three';
import { makeToon } from '../render/toon/material';
import { buildNook, nookStats, NOOK, NOOK_ORIGIN, DOOR, STEAM_COUNT, type NookMeshes, type PlumeTier } from './cabinMath';
import { toGeometry, glowMaterial, createPlume, type Plume } from './meshBuild';

// Phase 14: the sleepy nook, inside the cabin: bed with a blanket, a window onto the snow, a small lamp, a cup of cocoa with steam, a shelf, a rug and a door.
// A closed room with its open side toward +z (where the camera stands), built far above the ground (NOOK_ORIGIN) so it never meets the snow or the pines.
// While the camera is in here the director hides the ground and the sky parts (their snowfall box follows the camera).
// Draw calls: body 2 (surface + ink), door 2, glow 1, lamp halo 1, steam 1 = 7. Textures: none. Chamgadad, the cat and the lights come later (Phases 16, 19, 15).

export interface Nook {
  root: THREE.Group;
  /** the door in the right wall, pivot at its hinge. 0 = shut, 1 = open about 105 degrees, into the room. */
  door: THREE.Group;
  steam: Plume;
  readonly doorOpen: number;
  setDoorOpen(amount: number): void;
  /** `warmth` 0..1 lifts the lamp (Phase 19's hold-to-wake raises the light); 0.55 is the resting, low lamp. */
  setLamp(warmth: number): void;
  update(tSec: number): void;
  setTier(t: PlumeTier): void;
  setReducedMotion(on: boolean): void;
  setPixelRatio(pr: number): void;
  stats(): { triangles: number; drawCalls: number; steamPuffs: number };
  dispose(): void;
}

export function createNook(opts: { tier: PlumeTier; reducedMotion: boolean; pixelRatio?: number }): Nook {
  const data: NookMeshes = buildNook();
  let reduced = opts.reducedMotion;
  const root = new THREE.Group();
  root.name = 'nook';
  root.position.set(...NOOK_ORIGIN);

  const bodyToon = makeToon({ base: '#ffffff', outline: { widthFrac: 0.009 } });
  bodyToon.material.vertexColors = true;
  bodyToon.material.needsUpdate = true;
  const body = bodyToon.mesh(toGeometry(data.toon));
  body.name = 'nook-body';

  const doorToon = makeToon({ base: '#ffffff', outline: { widthFrac: 0.02 } });
  doorToon.material.vertexColors = true;
  doorToon.material.needsUpdate = true;
  const doorMesh = doorToon.mesh(toGeometry(data.door));
  const door = new THREE.Group();
  door.name = 'nook-door-pivot';
  door.position.set(NOOK.hx, 0, NOOK.doorZ);
  door.add(doorMesh);

  const glowMat = glowMaterial();
  const glow = new THREE.Mesh(toGeometry(data.glow), glowMat);
  glow.name = 'nook-glow';

  const steam = createPlume(
    { base: STEAM_COUNT, seed: 2718, origin: NOOK.cup, color: 0xf4efe6, alpha: 0.4, life: 4.2, height: 0.55, spread: 0.07, wind: 0.05, size: 15, grow: 1.4 },
    { tier: opts.tier, reducedMotion: reduced, pixelRatio: opts.pixelRatio },
  );
  steam.points.name = 'nook-steam';
  const haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  const halo = new THREE.Mesh(toGeometry(data.halo, true), haloMat);
  halo.name = 'nook-halo';
  root.add(body, door, glow, halo, steam.points);

  let open = 0;
  const setOpen = (a: number): void => {
    open = Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0;
    door.rotation.y = -Math.PI / 2 - open * ((DOOR.maxOpenDeg * Math.PI) / 180);
  };
  setOpen(0);

  let lamp = 0.55;
  return {
    root,
    door,
    steam,
    get doorOpen() {
      return open;
    },
    setDoorOpen: setOpen,
    setLamp(w) {
      lamp = Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.55;
    },
    update(t) {
      steam.update(t);
      const f = reduced ? 0.55 + 0.45 * lamp : 0.55 + 0.45 * lamp + 0.015 * Math.sin(t * 1.1);
      glowMat.color.setScalar(f);
      haloMat.color.setScalar(f * (0.6 + 0.8 * lamp));
    },
    setTier: (t) => steam.setTier(t),
    setReducedMotion(on) {
      reduced = on;
      steam.setReducedMotion(on);
    },
    setPixelRatio: (pr) => steam.setPixelRatio(pr),
    stats: () => ({ ...nookStats(data), steamPuffs: steam.count }),
    dispose() {
      bodyToon.dispose();
      doorToon.dispose();
      body.geometry.dispose();
      doorMesh.geometry.dispose();
      glow.geometry.dispose();
      halo.geometry.dispose();
      glowMat.dispose();
      haloMat.dispose();
      steam.dispose();
      root.removeFromParent();
    },
  };
}
