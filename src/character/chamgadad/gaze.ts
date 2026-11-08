// Phase 7: where Chamgadad looks. Pure maths, no three.
// Gaze is two numbers in the head's own frame: x (-1 left .. 1 right, as the viewer sees the front) and y (-1 down .. 1 up).
// The eyes never leave the head: the target is clamped to an ellipse, then smoothed, and the shader only moves things by a few pixels.
// Neutral gaze (0, 0) IS her drawing, which looks a little up and to the left (Q5 in CHARACTER_BIBLE.md is still open).

export interface GazeLimits {
  /** Half width of the allowed region (1 = the full range). */
  rx: number;
  /** Half height of the allowed region. Eyes travel less up and down than sideways. */
  ry: number;
}
export const GAZE_LIMITS: GazeLimits = { rx: 1, ry: 0.8 };

export type GazeName = 'center' | 'up' | 'down' | 'left' | 'right';
/** The five targets the Phase 7 screenshots use. */
export const GAZE_TARGETS: Record<GazeName, readonly [number, number]> = {
  center: [0, 0],
  up: [0, 0.8],
  down: [0, -0.8],
  left: [-1, 0],
  right: [1, 0],
};

export function clampGaze(x: number, y: number, limits: GazeLimits = GAZE_LIMITS): [number, number] {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0];
  const q = Math.hypot(x / limits.rx, y / limits.ry);
  return q <= 1 ? [x, y] : [x / q, y / q];
}

/**
 * Gaze for a point in the head's local frame (x right, y up, z toward the viewer). A point straight ahead gives (0, 0); a point far off
 * to one side saturates at the limit. `reach` is how far off-axis (in the same units as the point) counts as the full range.
 */
export function gazeTowardLocalPoint(px: number, py: number, pz: number, reach = 2, limits: GazeLimits = GAZE_LIMITS): [number, number] {
  const depth = Math.max(pz, 0.25);
  return clampGaze((px / depth) / reach * 2, (py / depth) / reach * 2, limits);
}

export interface GazeState {
  x: number;
  y: number;
  tx: number;
  ty: number;
}
export const newGaze = (): GazeState => ({ x: 0, y: 0, tx: 0, ty: 0 });

export function setGazeTarget(s: GazeState, x: number, y: number, limits: GazeLimits = GAZE_LIMITS): void {
  const [cx, cy] = clampGaze(x, y, limits);
  s.tx = cx;
  s.ty = cy;
}

/** Critically damped follow (no overshoot, so the eyes cannot overshoot their limit). `halfLife` seconds to cover half the distance. */
export function stepGaze(s: GazeState, dt: number, halfLife = 0.07): void {
  if (!(dt > 0)) return;
  const k = 1 - Math.pow(0.5, dt / halfLife);
  s.x += (s.tx - s.x) * k;
  s.y += (s.ty - s.y) * k;
}
