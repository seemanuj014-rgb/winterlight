import * as THREE from 'three';
import { createPicker, createHaptics } from '../input';
import { terrainHeight } from '../world/groundMath';
import { FIXED_DT } from '../core/loop';
import { PetMachine, type V2 } from '../interaction/petMath';
import type { StayCast } from './stayCast';

// Phase 28: petting the bunny inside stay a while. The rules are the Phase 20 `PetMachine` (tested, pure) unchanged: a HELD finger near her makes her hop toward it, one small hop at a time; a
// quick tap ON her sends her off to hide, then she peeks and comes back; Chamgadad leans toward her, slow-blinks, flicks an ear. Only the page side is new, because here a drag elsewhere turns the view:
//   a press that lands ON the bunny is hers (`claim`, handed to `createStayInput`, so it does not turn the view); a press anywhere else still turns the view as before.
//   claimed press released quickly without moving = a tap on her; held (or moved) = a finger on the snow under it, for as long as it is down.
// The cat is not part of the valley. Keyboard (session 13): one key, held or tapped, does the same as a press on her (a tap, or a slow finger circling just beside her); `stayView` only passes it on when the key is not meant for a control. No words, no exits, nothing here can block or end anything.
// Drawn only while the bunny is drawn (the draw-call plan); when she is not, the machine is not stepped and nothing can be claimed.

export interface StayPet {
  /** is a press at this client point on the bunny? (also starts the press when it is) */
  claim(clientX: number, clientY: number, pointerType?: string): boolean;
  /** Phase 28 (keyboard): the pet key went down / up. A quick press is a tap on her, a held key is a slow finger circling near her. Returns true if it was taken. */
  keyDown(): boolean;
  keyUp(): void;
  /** pointer move / up / cancel for the claimed press only */
  move(clientX: number, clientY: number): void;
  release(clientX: number, clientY: number): void;
  /** the bunny's home moved (the screen's shape changed): start her machine again from the new spot */
  rehome(): void;
  /** every frame; `present` = the bunny is drawn right now */
  update(dt: number, present: boolean): void;
  state(): { mode: string; x: number; z: number; pressing: boolean; hopsSeen: number };
  /** where the bunny is on the screen (client px), or null */
  screenOf(): { x: number; y: number; radiusPx: number } | null;
  resize(w: number, h: number): void;
  dispose(): void;
}

/** `[A]` how big the bunny counts as a target (m): a small animal on a phone needs a generous one */
export const STAY_BUNNY_RADIUS = 0.7;
/** `[A]` a press shorter than this (s) that has not moved is a tap; anything longer is a finger held on the snow */
export const TAP_MAX_S = 0.35;
/** `[A]` the keyboard's finger: how far from her home it circles (m) and how fast (rad/s); small so she hops, never far */
export const KEY_FINGER_RADIUS = 0.55;
export const KEY_FINGER_SPEED = 1.1;
/** `[A]` the leash round her home spot (m), short so a hop never leaves the picture */
export const STAY_BUNNY_LEASH = 1.4;

export function createStayPet(o: {
  cast: StayCast;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  /** the activity labels: 'pet' while a finger is on her, back to what the turn says after */
  onActive: (on: boolean) => void;
}): StayPet {
  const { cast, camera, canvas } = o;
  const home = cast.bunnyHome;
  let machine = new PetMachine({ bunnyHome: { x: home.x, z: home.z }, bunnyYaw: home.yaw, bunnyLeash: STAY_BUNNY_LEASH });
  const picker = createPicker(camera);
  picker.add({ id: 'bunny', object: cast.bunny.root, radius: STAY_BUNNY_RADIUS });
  const haptics = createHaptics();
  let view = { w: 1, h: 1 };
  let pressing = false;
  let pressT = 0;
  let moved = false;
  let px = 0;
  let py = 0;
  let downX = 0;
  let downY = 0;
  let held = false;
  let tapAt: { at: V2; on: boolean } | null = null;
  let hops = 0;
  let acc = 0;

  const rect = (): DOMRect => canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  function ground(x: number, y: number): V2 | null {
    ndc.set((x / view.w) * 2 - 1, -(y / view.h) * 2 + 1);
    plane.constant = -terrainHeight(machine.bunny.x, machine.bunny.z);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    const p = ray.ray.intersectPlane(plane, hit);
    return p ? { x: p.x, z: p.z } : null;
  }
  const right = new THREE.Vector3();
  function sideToBunny(): -1 | 1 {
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    return (cast.bunny.root.position.x - cast.holder.position.x) * right.x + (cast.bunny.root.position.z - cast.holder.position.z) * right.z >= 0 ? 1 : -1;
  }
  function endPress(): void {
    if (!pressing) return;
    keyPress = false;
    pressing = false;
    held = false;
    o.onActive(false);
  }
  let present = false;
  let keyPress = false;
  let keyAngle = 0;
  const keyFinger = (): V2 => ({ x: home.x + Math.cos(keyAngle) * KEY_FINGER_RADIUS, z: home.z + Math.sin(keyAngle) * KEY_FINGER_RADIUS });

  return {
    keyDown() {
      if (!present || pressing) return false;
      pressing = true;
      keyPress = true;
      pressT = 0;
      moved = false;
      held = false;
      o.onActive(true);
      return true;
    },
    keyUp() {
      if (!pressing || !keyPress) return;
      if (pressT < TAP_MAX_S) tapAt = { at: machine.bunny.pos, on: true };
      keyPress = false;
      endPress();
    },
    claim(cx, cy, pointerType) {
      if (!present || pressing) return false;
      const r = rect();
      const x = cx - r.left;
      const y = cy - r.top;
      const kind = pointerType === 'touch' ? 'touch' : pointerType === 'pen' ? 'pen' : 'mouse';
      picker.setEnabled('bunny', true);
      if (picker.pick(x, y, kind) !== 'bunny') return false;
      pressing = true;
      keyPress = false;
      pressT = 0;
      moved = false;
      px = downX = x;
      py = downY = y;
      held = false;
      o.onActive(true);
      return true;
    },
    move(cx, cy) {
      if (!pressing || keyPress) return;
      const r = rect();
      px = cx - r.left;
      py = cy - r.top;
      if (Math.hypot(px - downX, py - downY) > 14) moved = true;
    },
    release(cx, cy) {
      if (!pressing || keyPress) return;
      const r = rect();
      px = cx - r.left;
      py = cy - r.top;
      if (!moved && pressT < TAP_MAX_S) tapAt = { at: ground(downX, downY) ?? machine.bunny.pos, on: true };
      endPress();
    },
    rehome() {
      machine = new PetMachine({ bunnyHome: { x: home.x, z: home.z }, bunnyYaw: home.yaw, bunnyLeash: STAY_BUNNY_LEASH });
    },
    update(dt, isPresent) {
      present = isPresent;
      picker.setEnabled('bunny', present);
      if (!present) {
        if (pressing) {
          keyPress = false;
          endPress();
        }
        return;
      }
      acc += Math.min(Number.isFinite(dt) && dt > 0 ? dt : 0, 0.1);
      while (acc >= FIXED_DT) {
        acc -= FIXED_DT;
        if (pressing) {
          pressT += FIXED_DT;
          if (moved || pressT >= TAP_MAX_S) held = true;
          if (keyPress && held) keyAngle += FIXED_DT * KEY_FINGER_SPEED;
        }
        const finger = pressing && held ? (keyPress ? keyFinger() : ground(px, py)) : null;
        const tap = tapAt;
        tapAt = null;
        const outs = machine.update(FIXED_DT, {
          catPresent: false,
          bunnyPresent: true,
          reduced: o.reducedMotion,
          cat: { on: false, moved: 0, tap: false, state: 'sit' as never },
          bunny: { state: cast.bunny.behaviour.state, finger, tap, reduced: o.reducedMotion },
          chamState: cast.actor()?.behaviour.state ?? 'sit',
        });
        const b = outs.bunny;
        if (b) {
          cast.bunny.root.position.set(b.x, terrainHeight(b.x, b.z), b.z);
          cast.bunny.root.rotation.y = b.yaw;
          if (b.request) cast.bunny.behaviour.request(b.request);
          for (const g of b.gestures) cast.bunny.behaviour.gesture(g);
        }
        const actor = cast.actor();
        if (actor && cast.ready()) {
          if (outs.cham.lean) actor.behaviour.request('curiousLean', { side: sideToBunny(), hold: 6 });
          if (outs.cham.blink) actor.behaviour.gesture('slowBlink');
          if (outs.cham.ear) actor.behaviour.gesture('earFlick');
        }
        if (outs.haptic) haptics.pulse(outs.haptic);
        for (const e of outs.events) if (e.type === 'bunnyHop') hops++;
      }
    },
    state: () => ({ mode: machine.bunny.mode, x: Number(machine.bunny.x.toFixed(2)), z: Number(machine.bunny.z.toFixed(2)), pressing, hopsSeen: hops }),
    screenOf() {
      const s = picker.screenOf('bunny');
      if (!s) return null;
      const r = rect();
      return { x: r.left + s.x, y: r.top + s.y, radiusPx: s.radiusPx };
    },
    resize(w, h) {
      view = { w: Math.max(1, w), h: Math.max(1, h) };
      picker.resize(w, h);
    },
    dispose() {
      picker.remove('bunny');
    },
  };
}
