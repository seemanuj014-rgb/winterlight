// Phase 22: where the five shapes sit in the sky, for any screen shape. Pure (no three, no DOM): angles in, angles out.
// The sky view is the night backdrop's camera (fitBackdropView) tipped up further, so the sky above the mountains fills the screen and the five patches fit in it at once.
// A patch is placed by a sky direction (azimuth, elevation) and a half-width in degrees (`Placement`, see index.ts); this file works out those numbers from where on the SCREEN
// each patch should be, and can project a patch back onto the screen to prove it is in view, above the mountains and clear of its neighbours.
//
// Every number here is `[A]` (the owner has not seen the sky): the screen slots, the sizes, the pitch, the margins.

import { fitBackdropView, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, MOON_RADIUS_DEG, MOUNTAIN_LAYERS } from '../world/backdropMath';

export interface SkyView {
  aspect: number;
  fovDeg: number;
  /** the camera's pitch up from level, degrees */
  pitchDeg: number;
  /** how much more than `placeBackdropCamera(camera, aspect)` already tips (pass this as its 4th argument) */
  extraPitchDeg: number;
  halfHorizontalDeg: number;
}

export interface SkyPlacement {
  azDeg: number;
  elDeg: number;
  halfAngleDeg: number;
}

/** `[A]` camera pitch of the sky view by screen shape: high enough that the lowest part of the picture is just above the far mountains' tops (19 degrees) with room for rows of patches */
export const SKY_PITCH = { tall: 41, square: 37, wide: 36 };
/** `[A]` the highest the far mountains reach (degrees of elevation): the lowest a patch may go */
export const MOUNTAIN_TOP_DEG = Math.max(...MOUNTAIN_LAYERS.map((l) => l.elevDeg[1]));
/** `[A]` clear sky kept under a patch's lowest star */
export const MOUNTAIN_MARGIN_DEG = 2.5;
export const PATCH_DISTANCE = 60;

const D2R = Math.PI / 180;

export function skyViewFor(aspect: number): SkyView {
  const a = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 1;
  const v = fitBackdropView(a);
  const pitch = a < 0.75 ? SKY_PITCH.tall : a < 1.1 ? SKY_PITCH.square : SKY_PITCH.wide;
  return { aspect: a, fovDeg: v.fovDeg, pitchDeg: pitch, extraPitchDeg: pitch - v.pitchDeg, halfHorizontalDeg: v.halfHorizontalDeg };
}

/** the sky direction (degrees) of a point on the screen: u -1..1 left to right, v -1..1 bottom to top */
export function viewToAzEl(view: SkyView, u: number, v: number): { azDeg: number; elDeg: number } {
  const tanV = Math.tan((view.fovDeg * D2R) / 2);
  const tanH = tanV * view.aspect;
  const x = u * tanH;
  const y = v * tanV;
  const p = view.pitchDeg * D2R;
  const yy = y * Math.cos(p) + Math.sin(p);
  const zz = y * Math.sin(p) - Math.cos(p);
  return { azDeg: Math.atan2(x, -zz) / D2R, elDeg: Math.atan2(yy, Math.hypot(x, zz)) / D2R };
}

/** a patch's world frame (relative to the eye): where its centre is and which way its plane's x and y point, exactly as `createConstellationPlay.place` builds it */
function frame(p: SkyPlacement, dist = PATCH_DISTANCE) {
  const az = p.azDeg * D2R;
  const el = p.elDeg * D2R;
  const c = [Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist];
  const len = Math.hypot(c[0]!, c[1]!, c[2]!);
  const z = [-c[0]! / len, -c[1]! / len, -c[2]! / len]; // +z toward the eye
  // x = up x z, y = z x x   (Object3D.lookAt for a plain object, up = +y)
  let x = [z[2]!, 0, -z[0]!];
  const xl = Math.hypot(x[0]!, x[1]!, x[2]!) || 1;
  x = [x[0]! / xl, 0, x[2]! / xl];
  const y = [z[1]! * x[2]! - z[2]! * x[1]!, z[2]! * x[0]! - z[0]! * x[2]!, z[0]! * x[1]! - z[1]! * x[0]!];
  return { c, x, y };
}

/** a point of a patch's own plane (the def's x, y) -> where it is on the screen (u, v in -1..1; outside that = off screen) and its elevation in the sky */
export function projectPlane(view: SkyView, p: SkyPlacement, px: number, py: number): { u: number; v: number; elDeg: number; azDeg: number } {
  const half = Math.tan(p.halfAngleDeg * D2R) * PATCH_DISTANCE;
  const f = frame(p);
  const w = [0, 1, 2].map((i) => f.c[i]! + (f.x[i]! * px + f.y[i]! * py) * half);
  const pitch = view.pitchDeg * D2R;
  const yc = w[1]! * Math.cos(pitch) + w[2]! * Math.sin(pitch);
  const zc = -w[1]! * Math.sin(pitch) + w[2]! * Math.cos(pitch);
  const tanV = Math.tan((view.fovDeg * D2R) / 2);
  const tanH = tanV * view.aspect;
  const depth = -zc;
  return {
    u: depth > 0 ? w[0]! / depth / tanH : Infinity,
    v: depth > 0 ? yc / depth / tanV : Infinity,
    elDeg: Math.atan2(w[1]!, Math.hypot(w[0]!, w[2]!)) / D2R,
    azDeg: Math.atan2(w[0]!, -w[2]!) / D2R,
  };
}

export interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function extentOf(nodes: readonly { x: number; y: number }[]): Extent {
  const e = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const n of nodes) {
    e.minX = Math.min(e.minX, n.x);
    e.maxX = Math.max(e.maxX, n.x);
    e.minY = Math.min(e.minY, n.y);
    e.maxY = Math.max(e.maxY, n.y);
  }
  return e;
}

/** the screen rectangle (u, v) a patch's stars cover, with `pad` plane units of room round them (a star's glow and the finger's reach) */
export function screenBox(view: SkyView, p: SkyPlacement, ext: Extent, pad = 0.15): { u0: number; u1: number; v0: number; v1: number; lowestElDeg: number } {
  const corners: [number, number][] = [
    [ext.minX - pad, ext.minY - pad],
    [ext.maxX + pad, ext.minY - pad],
    [ext.maxX + pad, ext.maxY + pad],
    [ext.minX - pad, ext.maxY + pad],
  ];
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  let lowest = Infinity;
  for (const [x, y] of corners) {
    const r = projectPlane(view, p, x, y);
    u0 = Math.min(u0, r.u);
    u1 = Math.max(u1, r.u);
    v0 = Math.min(v0, r.v);
    v1 = Math.max(v1, r.v);
    lowest = Math.min(lowest, r.elDeg);
  }
  return { u0, u1, v0, v1, lowestElDeg: lowest };
}

export function boxesOverlap(a: { u0: number; u1: number; v0: number; v1: number }, b: { u0: number; u1: number; v0: number; v1: number }): boolean {
  return a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;
}

/** `[A]` where each patch sits on the screen: the centre (u, v) of the patch and its half-height as a fraction of the screen's half-height. Rows go up the sky in discovery order. */
interface Slot {
  u: number;
  v: number;
  /** half-size of the patch (its plane's 1.0) as a fraction of the half-height of the screen */
  s: number;
}

type SlotMap = Record<string, Slot>;

const TALL: SlotMap = {
  strawberry: { u: 0.5, v: -0.31, s: 0.215 },
  bumblebee: { u: -0.4, v: -0.07, s: 0.2 },
  rose: { u: 0.5, v: 0.2, s: 0.215 },
  'kaaju-katli': { u: -0.52, v: 0.44, s: 0.19 },
  'cutie-patootie': { u: -0.02, v: 0.66, s: 0.175 }, // was u 0.42: the wishes star button (top right) sat on top of it
};
const SQUARE: SlotMap = {
  strawberry: { u: 0.5, v: -0.22, s: 0.2 },
  bumblebee: { u: -0.5, v: 0.0, s: 0.2 },
  rose: { u: 0.5, v: 0.3, s: 0.2 },
  'kaaju-katli': { u: -0.5, v: 0.52, s: 0.2 },
  'cutie-patootie': { u: 0.1, v: 0.72, s: 0.17 },
};
const WIDE: SlotMap = {
  strawberry: { u: 0.1, v: -0.36, s: 0.22 },
  bumblebee: { u: 0.55, v: -0.12, s: 0.22 },
  rose: { u: -0.7, v: 0.0, s: 0.22 },
  'kaaju-katli': { u: 0.78, v: 0.5, s: 0.22 },
  'cutie-patootie': { u: -0.3, v: 0.6, s: 0.22 },
};

/** the five placements for a screen shape, ready for `createConstellationPlay` / `setPlacement` */
export function layoutFor(aspect: number): Record<string, SkyPlacement> {
  const view = skyViewFor(aspect);
  const slots = view.aspect < 0.75 ? TALL : view.aspect < 1.1 ? SQUARE : WIDE;
  const tanV = Math.tan((view.fovDeg * D2R) / 2);
  const out: Record<string, SkyPlacement> = {};
  for (const [id, s] of Object.entries(slots)) {
    const d = viewToAzEl(view, s.u, s.v);
    out[id] = { azDeg: d.azDeg, elDeg: d.elDeg, halfAngleDeg: Math.atan(s.s * tanV) / D2R };
  }
  return out;
}

/** the moon's disc (with a rim) as a screen circle, for "do the patches keep off the moon" */
export function moonOnScreen(view: SkyView): { u: number; v: number; rU: number; rV: number } {
  const az = MOON_AZIMUTH_DEG * D2R;
  const el = MOON_ELEVATION_DEG * D2R;
  const w = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  const pitch = view.pitchDeg * D2R;
  const yc = w[1]! * Math.cos(pitch) + w[2]! * Math.sin(pitch);
  const zc = -w[1]! * Math.sin(pitch) + w[2]! * Math.cos(pitch);
  const tanV = Math.tan((view.fovDeg * D2R) / 2);
  const tanH = tanV * view.aspect;
  const depth = -zc;
  const r = Math.tan((MOON_RADIUS_DEG + 1.5) * D2R);
  return { u: w[0]! / depth / tanH, v: yc / depth / tanV, rU: r / tanH, rV: r / tanV };
}
