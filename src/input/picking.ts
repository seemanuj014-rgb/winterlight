import * as THREE from 'three';
import { choosePick, screenRadius, type PickCandidate, type PickConfig } from './pickMath';
import type { PointerKind } from './gestureMath';

// Phase 18: raycast picking with generous touch targets. A target is an object (or a group) plus a point and a size that say how big to treat it ON THE SCREEN.
// `pick` projects every enabled target, asks the raycaster whether the ray went through its geometry, and hands the lot to the pure `choosePick`.
// Targets do not hide one another: a target behind a wall can still be picked. The acts only enable the targets that are meant to be touchable, and `priority`
// says which wins when they overlap (a small animal over the blanket it lies on). Nothing here draws anything: no draw calls, no triangles.

export interface PickTarget {
  id: string;
  /** the geometry the ray is tested against (children included); may be a group. Invisible objects are skipped. */
  object: THREE.Object3D;
  /** where the target "is" for generous picking (world). Default: the centre of the object's bounding box. */
  centre?: () => THREE.Vector3;
  /** how big to treat it, in world metres (a ball round the centre). Default: the bounding-sphere radius. */
  radius?: number;
  priority?: number;
  /** false = cannot be picked (and the keyboard skips it). Default true. */
  enabled?: boolean;
  /** how the keyboard and screen readers name it. The words belong to content/; there is no default. */
  label?: string;
}

export interface Picker {
  add(t: PickTarget): void;
  remove(id: string): void;
  setEnabled(id: string, on: boolean): void;
  has(id: string): boolean;
  /** ids that can be picked now, in the order they were added (the keyboard's reading order) */
  ids(): string[];
  label(id: string): string | undefined;
  /** which target is at (x, y) px in the element's box, or null */
  pick(x: number, y: number, kind: PointerKind): string | null;
  /** where a target is on screen (px), or null when it is behind the camera or not there */
  screenOf(id: string): { x: number; y: number; radiusPx: number } | null;
  /** tell it the size of the view (px). Call from the stage's onResize. */
  resize(width: number, height: number): void;
}

export function createPicker(camera: THREE.PerspectiveCamera, cfg?: PickConfig): Picker {
  const targets = new Map<string, PickTarget>();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  let w = 1;
  let h = 1;

  function measure(t: PickTarget): { centre: THREE.Vector3; worldRadius: number } | null {
    if (!t.object.visible) return null;
    if (t.centre && t.radius !== undefined) return { centre: t.centre(), worldRadius: t.radius };
    box.makeEmpty();
    box.setFromObject(t.object);
    if (box.isEmpty()) return null;
    box.getBoundingSphere(sphere);
    return { centre: t.centre ? t.centre() : sphere.center.clone(), worldRadius: t.radius ?? sphere.radius };
  }

  function project(t: PickTarget): (PickCandidate & { radiusPx: number }) | null {
    const m = measure(t);
    if (!m) return null;
    camera.updateMatrixWorld();
    c.copy(m.centre);
    const depth = v.copy(c).applyMatrix4(camera.matrixWorldInverse).z * -1; // distance in front of the camera
    if (!(depth > camera.near)) return null; // behind the camera
    c.project(camera);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
    return {
      id: t.id,
      x: ((c.x + 1) / 2) * w,
      y: ((1 - c.y) / 2) * h,
      radiusPx: screenRadius(m.worldRadius, depth, camera.fov, h),
      depth,
      direct: false,
      ...(t.priority !== undefined ? { priority: t.priority } : {}),
    };
  }

  const enabled = (t: PickTarget): boolean => t.enabled !== false;

  return {
    add: (t) => void targets.set(t.id, t),
    remove: (id) => void targets.delete(id),
    setEnabled(id, on) {
      const t = targets.get(id);
      if (t) t.enabled = on;
    },
    has: (id) => targets.has(id),
    ids: () => [...targets.values()].filter(enabled).map((t) => t.id),
    label: (id) => targets.get(id)?.label,
    resize(width, height) {
      w = Math.max(1, width);
      h = Math.max(1, height);
    },
    screenOf(id) {
      const t = targets.get(id);
      const p = t && project(t);
      return p ? { x: p.x, y: p.y, radiusPx: p.radiusPx } : null;
    },
    pick(x, y, kind) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
      camera.updateMatrixWorld();
      ray.setFromCamera(ndc, camera);
      const cands: PickCandidate[] = [];
      for (const t of targets.values()) {
        if (!enabled(t)) continue;
        const p = project(t);
        if (!p) continue;
        p.direct = ray.intersectObject(t.object, true).length > 0;
        cands.push(p);
      }
      return choosePick(x, y, kind, cands, cfg)?.id ?? null;
    },
  };
}
