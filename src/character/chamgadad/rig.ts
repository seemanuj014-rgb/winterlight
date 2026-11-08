// Phase 10: the small procedural rig. It owns the pieces that move (the pose, the breath, the face, the ears, the Zs) and, once per frame,
// asks the Behaviour (behaviour.ts) what to show and writes it onto the meshes.
// Order each frame: behaviour -> pose -> breathing and squash -> gaze and eyes -> face -> ears (they read the head's new transform) -> Zs.
// No new geometry for the body: the only new draw calls are the three Z sprites, and only while Chamgadad sleeps.
// The rest pose is exactly the Phase 9 `sit` pose (breath is zero at the first frame), so nothing about how she looks at rest changed.
import * as THREE from 'three';
import type { QualityTier } from '../../core/quality';
import type { Chamgadad } from './body';
import { createFace, type Face } from './face';
import { createEarDriver, type EarDriver } from './earMotion';
import { Behaviour, type Frame } from './behaviour';

/** How much the chest rises on a full breath and how far a full stretch changes the body's height (fractions, [A]). */
export const BREATH_Y = 0.012;
export const BREATH_X = 0.006;
export const STRETCH_Y = 0.07;
export const STRETCH_X = 0.03;

export interface ZsObject {
  group: THREE.Group;
  sprites: THREE.Sprite[];
  update(dt: number, amount: number, anchorWorld: THREE.Vector3, reduced: boolean): void;
  dispose(): void;
}

/** One soft Z as ink and pale blue, drawn once into a small canvas (no image file). */
function zTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const path = (): void => {
    g.beginPath();
    g.moveTo(16, 18);
    g.lineTo(48, 18);
    g.lineTo(16, 46);
    g.lineTo(48, 46);
  };
  g.strokeStyle = '#010102';
  g.lineWidth = 11;
  path();
  g.stroke();
  g.strokeStyle = '#e4edf2';
  g.lineWidth = 6.5;
  path();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const Z_SIZES = [1.0, 0.78, 0.58];
const Z_CYCLE = 4.6; // seconds for one Z to float up and fade

export function createZs(): ZsObject {
  const group = new THREE.Group();
  group.name = 'zs';
  group.visible = false;
  const tex = zTexture();
  const sprites = Z_SIZES.map((s, i) => {
    const mat = new THREE.SpriteMaterial({ map: tex ?? undefined, transparent: true, depthWrite: false, depthTest: false, opacity: 0, fog: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(s, s, 1);
    sp.renderOrder = 10 + i;
    group.add(sp);
    return sp;
  });
  let clock = 0;
  const tmp = new THREE.Vector3();
  return {
    group, sprites,
    update(dt, amount, anchor, reduced) {
      clock += dt;
      group.visible = amount > 0.01;
      if (!group.visible) return;
      group.parent?.updateWorldMatrix(true, false);
      sprites.forEach((sp, i) => {
        const base = Z_SIZES[i]!;
        // three Zs a third of a cycle apart, each floating up and to the right, swaying a little, growing, then fading
        const u = reduced ? 0.2 + i * 0.28 : ((clock / Z_CYCLE) + i / 3) % 1;
        const rise = u * 1.9;
        const sway = reduced ? 0 : Math.sin(u * Math.PI * 2 + i) * 0.1;
        tmp.set(anchor.x + 0.25 + u * 0.7 + sway, anchor.y + rise, anchor.z + 0.6);
        if (group.parent) group.parent.worldToLocal(tmp);
        sp.position.copy(tmp);
        const grow = 0.55 + 0.45 * Math.min(1, u * 1.6);
        sp.scale.set(base * grow, base * grow, 1);
        const fade = Math.min(1, u / 0.18) * (1 - Math.min(1, Math.max(0, (u - 0.62) / 0.38)));
        (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, fade) * Math.min(1, amount) * 0.95;
      });
    },
    dispose() {
      tex?.dispose();
      for (const sp of sprites) (sp.material as THREE.SpriteMaterial).dispose();
    },
  };
}

export interface RigOptions {
  tier?: QualityTier;
  reducedMotion?: boolean;
  seed?: number;
  /** Automatic ear flicks and blinks of the face and ear drivers (default on unless reduced motion). */
  auto?: boolean;
}

export interface Rig {
  behaviour: Behaviour;
  face: Face;
  ears: EarDriver;
  zs: ZsObject;
  /** Call once per frame (fixed step is fine). Returns the frame it applied. */
  update(dt: number): Frame;
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

export function createRig(body: Chamgadad, opts: RigOptions = {}): Rig {
  const reduced = !!opts.reducedMotion;
  const behaviour = new Behaviour({ reducedMotion: reduced });
  const face = createFace(body.head, { reducedMotion: reduced, seed: opts.seed });
  const ears = createEarDriver(body.head, { tier: opts.tier, reducedMotion: reduced, seed: opts.seed, auto: opts.auto });
  const zs = createZs();
  body.group.add(zs.group);
  // The torso is scaled about the neck joint; to keep the seat on the ground the whole figure is lifted by what the scale took away.
  const seatBelowJoint = body.built.joint[1] - body.built.baseY;
  const anchorLocal = new THREE.Vector3(body.head.built.head.centre[0] + 1.4, body.head.built.head.centre[1] + 1.7, body.head.built.head.frontZMax * 0.5);
  const anchor = new THREE.Vector3();
  let reducedNow = reduced;
  let holding = false;

  const rig: Rig = {
    behaviour, face, ears, zs,
    update(dt) {
      const f = behaviour.update(dt);
      body.applyPose(f.pose);
      // breathing and squash / stretch
      const sy = 1 + f.breath * BREATH_Y + f.stretch * STRETCH_Y;
      const sx = 1 + f.breath * BREATH_X - f.stretch * STRETCH_X;
      body.parts.torso.scale.set(sx, sy, sx);
      body.parts.root.position.y += seatBelowJoint * (sy - 1);
      // eyes: the behaviour holds them closed when it wants them closed, otherwise the automatic blinks run
      face.lookAt(f.gaze as [number, number]);
      if (f.eyes > 0) {
        face.holdBlink(f.eyes);
        holding = true;
      } else if (holding) {
        face.holdBlink(null);
        holding = false;
      }
      face.update(dt);
      for (const e of f.events) if (e.type === 'earFlick') ears.flick(e.which, e.strength);
      ears.update(dt);
      body.head.group.localToWorld(anchor.copy(anchorLocal));
      zs.update(dt > 0 ? Math.min(dt, 0.1) : 0, f.zs, anchor, reducedNow);
      return f;
    },
    setReducedMotion(on) {
      reducedNow = on;
      behaviour.setReducedMotion(on);
      face.blinker.auto = !on;
      // the ear springs' own reduced-motion tug scale is fixed when the driver is made (Phase 8); only the automatic flicks switch live
      ears.motion.auto = opts.auto ?? !on;
    },
    dispose() {
      body.group.remove(zs.group);
      zs.dispose();
      face.dispose();
    },
  };
  return rig;
}
