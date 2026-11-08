import * as THREE from 'three';
import { makeToon } from '../render/toon/material';
import { CABIN_SITE } from './groundMath';
import {
  buildCabin, cabinStats, CABIN, CABIN_FACING_DEG, CABIN_SMOKE_ORIGIN, DOOR, SMOKE_COUNT, WARM_LIGHT,
  type CabinMeshes, type CabinStats, type PlumeTier,
} from './cabinMath';
import { toGeometry, glowMaterial, createPlume, type Plume } from './meshBuild';

// Phase 14: the cabin, seen from outside. A merged ink-lined body (logs, roof, chimney, step, window frames), a door that swings on its own pivot, the warm light
// (windows, doorway, lantern) as one unlit mesh, a soft warm patch on the snow, and the chimney smoke. Draw calls: body 2 (surface + ink), door 2, glow 1, spill 1,
// smoke 1 = 7. Textures: none. It stands on the cabin clearing, door toward the viewer.

export interface CabinOptions {
  tier: PlumeTier;
  reducedMotion: boolean;
  pixelRatio?: number;
}

export interface Cabin {
  root: THREE.Group;
  /** the door's pivot: it turns about its hinge. 0 = shut, 1 = open about 105 degrees, outward. */
  door: THREE.Group;
  smoke: Plume;
  readonly doorOpen: number;
  setDoorOpen(amount: number): void;
  update(tSec: number): void;
  setTier(t: PlumeTier): void;
  setReducedMotion(on: boolean): void;
  setPixelRatio(pr: number): void;
  stats(): CabinStats & { smokePuffs: number };
  dispose(): void;
}

export function createCabin(opts: CabinOptions): Cabin {
  const data: CabinMeshes = buildCabin();
  let reduced = opts.reducedMotion;
  const root = new THREE.Group();
  root.name = 'cabin';
  root.position.set(CABIN_SITE.x, 0, CABIN_SITE.z);
  root.rotation.y = (CABIN_FACING_DEG * Math.PI) / 180;

  // Vertex colours carry the look; the toon material colour is white. The line is thin: the cabin is big, and a logs-and-boards line wants to be fine (Phase 3: per part).
  const bodyToon = makeToon({ base: '#ffffff', outline: { widthFrac: 0.011 } });
  bodyToon.material.vertexColors = true;
  bodyToon.material.needsUpdate = true;
  const body = bodyToon.mesh(toGeometry(data.toon));
  body.name = 'cabin-body';

  const doorToon = makeToon({ base: '#ffffff', outline: { widthFrac: 0.02 } });
  doorToon.material.vertexColors = true;
  doorToon.material.needsUpdate = true;
  const doorMesh = doorToon.mesh(toGeometry(data.door));
  doorMesh.name = 'cabin-door';
  const door = new THREE.Group();
  door.name = 'cabin-door-pivot';
  door.position.set(CABIN.hingeX, 0, CABIN.hz);
  door.add(doorMesh);

  const glowMat = glowMaterial();
  const glow = new THREE.Mesh(toGeometry(data.glow), glowMat);
  glow.name = 'cabin-glow';

  const spillMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    toneMapped: false,
  });
  const spill = new THREE.Mesh(toGeometry(data.spill, true), spillMat);
  spill.name = 'cabin-spill';
  spill.renderOrder = 1;

  const smoke = createPlume(
    { base: SMOKE_COUNT, seed: 614, origin: CABIN_SMOKE_ORIGIN, color: 0xb9c7da, alpha: 0.42, life: 11, height: 4.2, spread: 0.7, wind: 1.6, size: 52, grow: 1.9 },
    { tier: opts.tier, reducedMotion: reduced, pixelRatio: opts.pixelRatio },
  );
  smoke.points.name = 'cabin-smoke';
  root.add(spill, body, door, glow, smoke.points);

  let open = 0;
  const setOpen = (a: number): void => {
    open = Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0;
    door.rotation.y = -open * ((DOOR.maxOpenDeg * Math.PI) / 180);
  };

  return {
    root,
    door,
    smoke,
    get doorOpen() {
      return open;
    },
    setDoorOpen: setOpen,
    update(t) {
      smoke.update(t);
      // the window light breathes a little (two slow waves): barely there, never a flicker you notice
      const f = reduced ? 1 : 0.965 + 0.025 * Math.sin(t * 1.3) + 0.01 * Math.sin(t * 3.1 + 1.2);
      glowMat.color.setScalar(f);
    },
    setTier: (t) => smoke.setTier(t),
    setReducedMotion(on) {
      reduced = on;
      smoke.setReducedMotion(on);
    },
    setPixelRatio: (pr) => smoke.setPixelRatio(pr),
    stats: () => ({ ...cabinStats(data), smokePuffs: smoke.count }),
    dispose() {
      bodyToon.dispose();
      doorToon.dispose();
      body.geometry.dispose();
      doorMesh.geometry.dispose();
      glow.geometry.dispose();
      spill.geometry.dispose();
      glowMat.dispose();
      spillMat.dispose();
      smoke.dispose();
      root.removeFromParent();
    },
  };
}

export { WARM_LIGHT };
