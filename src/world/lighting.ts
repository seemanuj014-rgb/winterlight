import * as THREE from 'three';
import { TOON_LIGHT_INTENSITY } from '../render/toon/material';
import {
  MOON_KEY, SKY_FILL, NOOK_FILL, NOOK_WINDOW_LIGHT, cabinPointLights, nookPointLights, flicker, moonDirection,
  type PointSpec, type Tier,
} from './lightingMath';

// Phase 15: the lighting rig. Two rigs, both a handful of real lights and nothing else:
//   world: a cool moon key from where the sky's moon stands, a cool hemisphere fill, and warm point lights at the cabin's lantern and windows;
//   nook:  the lamp (warm), a faint warm bounce, the cool light through the window, a dim fill.
// The toon material turns every light into the same few cel steps (Phase 3), so a point light makes a soft step of warm on the logs and the snow, not a glossy hot spot.
// The warm glow meshes already in the scene (windows, lantern, spill, halo: Phase 14) are the baked half of the warm; these lights are the real half.
// Nothing here changes how Chamgadad is drawn: her own views (`?head`, `?body`, ...) never build this rig, and her materials are untouched.

export interface Lighting {
  /** moon, fill and the nook's world-space lights. Point lights are children of the object they belong to (so they turn with it). */
  readonly root: THREE.Group;
  readonly pointLights: THREE.PointLight[];
  /** lights in the scene by kind, for the `?debug` log and the tests */
  stats(): { directional: number; hemisphere: number; point: number };
  update(tSec: number): void;
  /** only steps down: lights beyond the new tier's budget are switched off */
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  /** nook only: 0..1, the lamp's strength follows the dial the nook has (Phase 14 `setLamp`) */
  setLamp(w: number): void;
  dispose(): void;
}

interface Entry {
  light: THREE.PointLight;
  spec: PointSpec;
  base: number;
}

function makePoints(specs: PointSpec[], parent: THREE.Object3D, out: Entry[]): void {
  for (const s of specs) {
    const l = new THREE.PointLight(s.color, s.intensity, s.distance, s.decay);
    l.name = `light-${s.name}`;
    l.position.set(...s.pos);
    parent.add(l);
    out.push({ light: l, spec: s, base: s.intensity });
  }
}

/** The world rig. `cabinRoot`: the cabin group the warm lights hang from (they follow it if it moves). Without a cabin there are no warm lights, only the moon and the fill. */
export function createWorldLighting(opts: { tier: Tier; reducedMotion: boolean; cabinRoot?: THREE.Object3D | null }): Lighting {
  let reduced = opts.reducedMotion;
  let tier = opts.tier;
  const root = new THREE.Group();
  root.name = 'lighting-world';

  const m = moonDirection();
  const moon = new THREE.DirectionalLight(MOON_KEY.color, TOON_LIGHT_INTENSITY * MOON_KEY.intensity);
  moon.name = 'light-moon';
  moon.position.set(m[0] * 20, m[1] * 20, m[2] * 20);
  const fill = new THREE.HemisphereLight(SKY_FILL.sky, SKY_FILL.ground, SKY_FILL.intensity);
  fill.name = 'light-fill';
  root.add(moon, fill);

  const entries: Entry[] = [];
  if (opts.cabinRoot) makePoints(cabinPointLights('high'), opts.cabinRoot, entries); // all of them; the tier switches the extras off
  const apply = (): void => {
    const keep = new Set(cabinPointLights(tier).map((s) => s.name));
    for (const e of entries) e.light.visible = keep.has(e.spec.name);
    // the low tier's single "windows" light stands in for both windows: it is the 'window-left' slot with the stand-in's numbers
    if (tier === 'low') {
      const stand = cabinPointLights('low')[1];
      const left = entries.find((e) => e.spec.name === 'window-left');
      if (stand && left) {
        left.light.visible = true;
        left.light.position.set(...stand.pos);
        left.light.distance = stand.distance;
        left.base = stand.intensity;
      }
    }
  };
  apply();

  return {
    root,
    pointLights: entries.map((e) => e.light),
    stats() {
      return { directional: 1, hemisphere: 1, point: entries.filter((e) => e.light.visible).length };
    },
    update(t) {
      for (const e of entries) if (e.light.visible) e.light.intensity = e.base * flicker(t, e.spec.flicker[0], e.spec.flicker[1], e.spec.seed, reduced);
    },
    setTier(next) {
      if (rank(next) < rank(tier)) return; // never up
      tier = next;
      apply();
    },
    setReducedMotion(on) {
      reduced = on;
    },
    setLamp() {},
    dispose() {
      for (const e of entries) {
        e.light.removeFromParent();
        e.light.dispose();
      }
      moon.dispose();
      fill.dispose();
      root.removeFromParent();
    },
  };
}

/** The nook rig. `nookRoot`: the nook group (its lights are placed in the room's own frame, so they move with it). */
export function createNookLighting(opts: { tier: Tier; reducedMotion: boolean; nookRoot: THREE.Object3D }): Lighting {
  let reduced = opts.reducedMotion;
  let tier = opts.tier;
  let lamp = 0.55;
  const root = new THREE.Group();
  root.name = 'lighting-nook';

  // the cool light through the window, from outside: a soft key from the right that leaves the left of the room (the bed) in the lamp's warm and the fill's blue
  const win = new THREE.DirectionalLight(NOOK_WINDOW_LIGHT.color, TOON_LIGHT_INTENSITY * NOOK_WINDOW_LIGHT.intensity);
  win.name = 'light-window';
  win.position.set(...NOOK_WINDOW_LIGHT.from).add(opts.nookRoot.position);
  win.target = new THREE.Object3D();
  win.target.position.copy(opts.nookRoot.position);
  const fill = new THREE.HemisphereLight(NOOK_FILL.sky, NOOK_FILL.ground, NOOK_FILL.intensity);
  fill.name = 'light-fill';
  root.add(win, win.target, fill);

  const entries: Entry[] = [];
  makePoints(nookPointLights('high'), opts.nookRoot, entries);
  const apply = (): void => {
    const keep = new Set(nookPointLights(tier).map((s) => s.name));
    for (const e of entries) e.light.visible = keep.has(e.spec.name);
  };
  apply();
  const dial = (): number => Math.min(1.4, Math.max(0, lamp / 0.55)); // 0.55 is the nook's default lamp, which reads as 1

  return {
    root,
    pointLights: entries.map((e) => e.light),
    stats() {
      return { directional: 1, hemisphere: 1, point: entries.filter((e) => e.light.visible).length };
    },
    update(t) {
      for (const e of entries) {
        if (!e.light.visible) continue;
        const k = e.spec.name === 'lamp' ? dial() : 1;
        e.light.intensity = e.base * k * flicker(t, e.spec.flicker[0], e.spec.flicker[1], e.spec.seed, reduced);
      }
    },
    setTier(next) {
      if (rank(next) < rank(tier)) return; // never up
      tier = next;
      apply();
    },
    setReducedMotion(on) {
      reduced = on;
    },
    setLamp(w) {
      lamp = Number.isFinite(w) ? w : 0;
    },
    dispose() {
      for (const e of entries) {
        e.light.removeFromParent();
        e.light.dispose();
      }
      win.dispose();
      fill.dispose();
      root.removeFromParent();
    },
  };
}

const rank = (t: Tier): number => (t === 'high' ? 0 : t === 'mid' ? 1 : 2);
