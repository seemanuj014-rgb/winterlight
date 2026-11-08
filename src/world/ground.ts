import * as THREE from 'three';
import { createTerrain, type Terrain } from './terrain';
import { createSnowfall, type Snowfall } from './snowfall';
import { createPines, type Pines } from './pines';
import { groundStats, type GroundStats, type Tier } from './groundMath';

// Phase 13: the ground, the snow in the air and the pines, as one object, to stand in front of the Phase 12 backdrop. The cabin (Phase 14) and the cast
// stand on it; they never need to touch it. Draw calls: terrain 1, snowfall 1, pines 1, pine shadows 1 = 4. Textures: none.

export interface GroundOptions {
  tier: Tier;
  reducedMotion: boolean;
  pixelRatio?: number;
}

export interface Ground {
  root: THREE.Group;
  terrain: Terrain;
  snow: Snowfall;
  pines: Pines;
  /** Call once per frame before drawing. tSec is the sim clock. */
  update(tSec: number, camera: THREE.Camera): void;
  setPixelRatio(pr: number): void;
  /** Step down only (the FPS watchdog never steps up). */
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  /** What the ground costs right now, for tests and the debug log. */
  stats(): GroundStats;
  dispose(): void;
}

export function createGround(opts: GroundOptions): Ground {
  let tier = opts.tier;
  let reduced = opts.reducedMotion;
  const root = new THREE.Group();
  root.name = 'ground';
  const terrain = createTerrain({ tier, reducedMotion: reduced });
  const snow = createSnowfall({ tier, reducedMotion: reduced, pixelRatio: opts.pixelRatio });
  const pines = createPines({ tier, reducedMotion: reduced });
  root.add(terrain.mesh, pines.shadows, pines.trees, snow.points);
  return {
    root,
    terrain,
    snow,
    pines,
    update(tSec, camera) {
      terrain.update(tSec);
      pines.update(tSec);
      snow.update(tSec, camera);
    },
    setPixelRatio(pr) {
      snow.setPixelRatio(pr);
    },
    setTier(next) {
      tier = next;
      terrain.setTier(next);
      snow.setTier(next);
      pines.setTier(next);
    },
    setReducedMotion(on) {
      reduced = on;
      terrain.setReducedMotion(on);
      snow.setReducedMotion(on);
      pines.setReducedMotion(on);
    },
    stats() {
      return groundStats(tier, reduced, pines.unit, terrain.built);
    },
    dispose() {
      terrain.dispose();
      snow.dispose();
      pines.dispose();
      root.removeFromParent();
    },
  };
}
