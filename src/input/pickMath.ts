// Phase 18: choosing what a touch meant. Pure (no three, no DOM).
// A fingertip is about 9 mm wide and hides what it touches, so a small thing (a star, the bunny's nose) must be easy to hit. Every target gets a
// minimum radius ON THE SCREEN, bigger for a finger than for a mouse; a direct ray hit still counts when the target is large.
// Ranking among everything the touch could mean: higher `priority` first (so a small animal can win over the big blanket it sits on), then a direct
// ray hit, then the touch that is nearest the target's middle relative to its own size, then the nearer one to the camera.

import type { PointerKind } from './gestureMath';

export interface PickCandidate {
  id: string;
  /** the target's centre on screen (px, element box) */
  x: number;
  y: number;
  /** its real size on screen (px), before any generosity */
  radiusPx: number;
  /** distance from the camera (any unit; nearer wins ties) */
  depth: number;
  /** the picking ray went through its geometry */
  direct: boolean;
  /** higher wins; default 0 */
  priority?: number;
}

export interface PickConfig {
  /** smallest hit radius on the screen (px) per pointer kind */
  minRadius: Record<PointerKind, number>;
}

/** `[A]` 28 px radius for a finger = a 56 px circle, a bit over the 44 px touch-target advice; 14 for a mouse, 18 for a pen. The keyboard has no radius (it picks by id). */
export const PICK_DEFAULTS: PickConfig = { minRadius: { touch: 28, mouse: 14, pen: 18, key: 0 } };

export interface PickResult {
  id: string;
  direct: boolean;
  /** distance from the touch to the target's middle (px) */
  distance: number;
  /** the radius that was used (px) */
  radiusPx: number;
}

export const effectiveRadius = (radiusPx: number, kind: PointerKind, cfg: PickConfig = PICK_DEFAULTS): number => Math.max(Number.isFinite(radiusPx) ? radiusPx : 0, cfg.minRadius[kind]);

/** Size of a ball of `worldRadius` seen at `distance` by a perspective camera of vertical field `fovDeg`, in px of a view `viewHeightPx` tall. Behind the camera or bad input = 0. */
export function screenRadius(worldRadius: number, distance: number, fovDeg: number, viewHeightPx: number): number {
  if (!(worldRadius > 0) || !(distance > 0) || !(fovDeg > 0) || fovDeg >= 180 || !(viewHeightPx > 0)) return 0;
  return (worldRadius / (distance * Math.tan((fovDeg * Math.PI) / 360))) * (viewHeightPx / 2);
}

export function choosePick(px: number, py: number, kind: PointerKind, cands: readonly PickCandidate[], cfg: PickConfig = PICK_DEFAULTS): PickResult | null {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  let best: (PickResult & { priority: number; ratio: number; depth: number }) | null = null;
  for (const c of cands) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.depth)) continue;
    const r = effectiveRadius(c.radiusPx, kind, cfg);
    const distance = Math.hypot(px - c.x, py - c.y);
    const hit = c.direct || (r > 0 && distance <= r);
    if (!hit) continue;
    const cand = { id: c.id, direct: c.direct, distance, radiusPx: r, priority: c.priority ?? 0, ratio: r > 0 ? distance / r : 0, depth: c.depth };
    if (!best || beats(cand, best)) best = cand;
  }
  return best ? { id: best.id, direct: best.direct, distance: best.distance, radiusPx: best.radiusPx } : null;
}

function beats(a: { priority: number; direct: boolean; ratio: number; depth: number; id: string }, b: typeof a): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;
  if (a.direct !== b.direct) return a.direct;
  if (a.ratio !== b.ratio) return a.ratio < b.ratio;
  if (a.depth !== b.depth) return a.depth < b.depth;
  return a.id < b.id; // a fixed last tie-break, so the answer never depends on list order
}
