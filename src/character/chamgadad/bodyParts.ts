// Phase 9: the body below the drawing's crop, as plain arrays (no three, so it is unit-tested in Node).
// Everything here is [A]: her drawing stops at the chest. What IS measured and followed:
//   * the torso's top continues her neck-and-chest outline downward, side by side with the same slope where the crop cuts it;
//   * the two chest strokes (the loose V, measured from her pixels, Q4: "arms / shoulders") are the INNER edges of the two arms;
//   * colours are her palette, the ink line is her ink width, nothing is added that she did not draw (no nose, no pads, no fingers).
// Everything else (depth, the length of the arms, the thighs, feet, tail, the belly's roundness) is [A], flagged in CHARACTER_BIBLE.md.
import { refToWorld, type Pt } from '../refFrame';
import { inflate, isStarShaped, type InflateOptions, type InflatedMesh } from './inflate';
import { INK_WORLD, sampleFrontZ, zNeededInFront, type PartsJson } from './parts';

/** Her chest strokes in pixels of the 1080 px drawing, measured from the dark pixels (tools: the Phase 9 log has the rows). */
export const CHEST_STROKES_PX = {
  left: { top: [482, 940], bottom: [562.5, 1080] },
  right: { top: [684, 940], bottom: [640.6, 1080] },
} as const;

const pxToWorld = (p: readonly [number, number]): Pt => refToWorld(p[0] / 1080, p[1] / 1080);

/** The V, in world units. The strokes meet a little below the crop (about y -2.33): where the paws meet. */
export function chestStrokes(): { left: [Pt, Pt]; right: [Pt, Pt]; meet: Pt } {
  const lt = pxToWorld(CHEST_STROKES_PX.left.top), lb = pxToWorld(CHEST_STROKES_PX.left.bottom);
  const rt = pxToWorld(CHEST_STROKES_PX.right.top), rb = pxToWorld(CHEST_STROKES_PX.right.bottom);
  // intersection of the two lines
  const d1x = lb[0] - lt[0], d1y = lb[1] - lt[1], d2x = rb[0] - rt[0], d2y = rb[1] - rt[1];
  const den = d1x * d2y - d1y * d2x;
  const t = ((rt[0] - lt[0]) * d2y - (rt[1] - lt[1]) * d2x) / den;
  return { left: [lt, lb], right: [rt, rb], meet: [lt[0] + d1x * t, lt[1] + d1y * t] };
}

/** Catmull-Rom through points, `per` samples per span; open (the ends are kept) or closed. */
export function catmull(pts: readonly Pt[], per: number, closed: boolean): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  const get = (i: number): Pt => (closed ? pts[((i % n) + n) % n]! : pts[Math.min(n - 1, Math.max(0, i))]!);
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(pts[n - 1]!);
  return out;
}

export function ellipseOutline(cx: number, cy: number, rx: number, ry: number, n = 48): Pt[] {
  return Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)] as Pt);
}

export interface BodyLayout {
  torso: Partial<InflateOptions>;
  arm: Partial<InflateOptions>;
  thigh: Partial<InflateOptions>;
  foot: Partial<InflateOptions>;
  tail: Partial<InflateOptions>;
  gap: number;
  /** How far an arm's rim stands off the chest: enough that her ink line round it is drawn whole, not half buried. */
  armGap: number;
}

/** [A] first guesses for every depth; Phase 11 tunes them against the 3D head next to the drawing. */
export const BODY_LAYOUT: BodyLayout = {
  torso: { rimInset: INK_WORLD, samples: 112, rings: 12, thickness: 0.62, rim: 1, backScale: 0.9, outlineSmooth: 2, heightSmooth: 6 },
  arm: { rimInset: INK_WORLD, samples: 64, rings: 7, thickness: 0.55, rim: 1, backScale: 0.5, outlineSmooth: 2, heightSmooth: 4 },
  thigh: { rimInset: INK_WORLD, samples: 56, rings: 8, thickness: 0.7, rim: 1, backScale: 0.8, outlineSmooth: 1, heightSmooth: 4 },
  foot: { rimInset: INK_WORLD * 0.6, samples: 40, rings: 6, thickness: 0.55, rim: 1, backScale: 1, outlineSmooth: 1, heightSmooth: 3 },
  tail: { rimInset: INK_WORLD * 0.6, samples: 56, rings: 7, thickness: 0.8, rim: 1, backScale: 1, outlineSmooth: 2, heightSmooth: 4 },
  gap: 0.03,
  armGap: 0.09,
};

export interface BuiltBody {
  torso: InflatedMesh;
  /** Where the neck meets the torso: the bottom middle of the drawn neck (x, y at the crop). The head rotates about this in poses. */
  joint: [number, number, number];
  armLeft: InflatedMesh;
  armRight: InflatedMesh;
  /** Shoulder pivots (middle of each arm's top). */
  shoulderLeft: [number, number, number];
  shoulderRight: [number, number, number];
  thighLeft: InflatedMesh;
  thighRight: InflatedMesh;
  /** Hip pivots (middle of each thigh). */
  hipLeft: [number, number, number];
  hipRight: [number, number, number];
  /** Feet are built flat in x/y and meant to be laid down (rotate x by +90 degrees); the pivot is the heel end. */
  footLeft: InflatedMesh;
  footRight: InflatedMesh;
  tail: InflatedMesh;
  tailPivot: [number, number, number];
  /** Centre line x of the body below the crop. */
  axisX: number;
  /** y of the bottom of the seated torso. */
  baseY: number;
}

interface NeckEdge { left: Pt; right: Pt; }

/** Her neck outline's two edge points at world height y (read off the traced contour, linear between its points). */
export function neckEdgesAt(neck: readonly (readonly number[])[], y: number): NeckEdge {
  const pts = neck.map(([u, v]) => refToWorld(u!, v!) as Pt);
  let left: Pt | null = null, right: Pt | null = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
    const t = (y - a[1]) / (b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t;
    if (!left || x < left[0]) left = [x, y];
    if (!right || x > right[0]) right = [x, y];
  }
  if (!left || !right) throw new Error(`neckEdgesAt: the neck outline does not reach y ${y}`);
  return { left, right };
}

/**
 * Pushes an arm (built flat at z 0) onto the surface behind it: each vertex goes to the surface z there, plus its own dome height,
 * minus `embed(y)` so the top of the arm sinks into the chest and the ink line there is hidden (her strokes taper off at the top; so does this).
 */
export function drapeOnto(m: InflatedMesh, surfaces: readonly InflatedMesh[], gap: number, embed: (y: number) => number): InflatedMesh {
  const positions = Float32Array.from(m.positions);
  const n = positions.length / 3;
  const base = (x: number, y: number): number => {
    let best: number | null = null;
    for (const s of surfaces) {
      const z = sampleFrontZ(s, x, y);
      if (z !== null && (best === null || z > best)) best = z;
    }
    return best ?? 0;
  };
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!;
    positions[v * 3 + 2] = positions[v * 3 + 2]! + base(x, y) + gap - embed(y);
  }
  let zMax = -Infinity, zMin = Infinity;
  for (let v = 0; v < n; v++) { zMax = Math.max(zMax, positions[v * 3 + 2]!); zMin = Math.min(zMin, positions[v * 3 + 2]!); }
  return { ...m, positions, frontZMax: zMax, backZMin: zMin };
}

function shiftXY(m: InflatedMesh, dx: number, dy: number, dz: number): InflatedMesh {
  const positions = Float32Array.from(m.positions);
  for (let i = 0; i < positions.length; i += 3) { positions[i] += dx; positions[i + 1] += dy; positions[i + 2] += dz; }
  return { ...m, positions, rim: m.rim.map(([x, y]) => [x + dx, y + dy] as Pt), centre: [m.centre[0] + dx, m.centre[1] + dy], frontZMax: m.frontZMax + dz, backZMin: m.backZMin + dz };
}

export function buildBodyParts(json: PartsJson, headNeck: InflatedMesh, layout: Partial<BodyLayout> = {}): BuiltBody {
  const L: BodyLayout = { ...BODY_LAYOUT, ...layout };
  const V = chestStrokes();
  const cropY = refToWorld(0.5, 0.99907)[1]; // her neck's flat bottom, y -1.996
  const edgeTop = neckEdgesAt(json.neck.points, -1.45);
  const edgeBot = neckEdgesAt(json.neck.points, cropY + 0.002);
  const axisX = (edgeBot.left[0] + edgeBot.right[0]) / 2;
  const baseY = -4.4;

  // Torso: the neck's two edges continued downward, widening the way they do at the crop, then a round seated bottom.
  // Half widths from the axis, at heights below the crop. [A]
  const half = (y: number, w: number): [Pt, Pt] => [[axisX - w, y], [axisX + w, y]];
  const sides: [number, number][] = [[-2.45, 1.2], [-3.0, 1.4], [-3.5, 1.5], [-3.9, 1.46], [-4.18, 1.22], [-4.36, 0.7]];
  const leftPts: Pt[] = [edgeTop.left, edgeBot.left, ...sides.map(([y, w]) => half(y, w)[0])];
  const rightPts: Pt[] = [edgeTop.right, edgeBot.right, ...sides.map(([y, w]) => half(y, w)[1])];
  const left = catmull(leftPts, 6, false);
  const right = catmull(rightPts, 6, false);
  const bottom: Pt[] = [[axisX, baseY]];
  const outline: Pt[] = [...left, ...bottom, ...right.reverse()];
  const torso = inflate(outline, { ...L.torso, zOffset: 0 });

  // Arms: two wedges lying on the chest. The inner edge IS her stroke (carried on down to where the strokes meet), the outer edge hugs
  // the body, the tip (the paw) is where the strokes meet. [A] the length, the width, the paws meeting.
  const [lt, lb] = V.left;
  const [rt, rb] = V.right;
  const meet = V.meet;
  const pawY = meet[1] - 0.28;
  const e15 = neckEdgesAt(json.neck.points, -1.5), e19 = neckEdgesAt(json.neck.points, -1.9);
  const IN = 0.1; // how far inside her silhouette the outer edge of an arm stays
  const armLeftOutline = catmull([
    [lt[0] - 0.02, lt[1] + 0.06], [e15.left[0] + IN + 0.1, -1.46], [e15.left[0] + IN, -1.52], [e19.left[0] + IN, -1.9], [axisX - 1.2 + 0.14, -2.45],
    [axisX - 0.85, -2.72], [meet[0] - 0.3, pawY - 0.02], [meet[0] - 0.02, pawY + 0.04],
    [meet[0] + 0.02, meet[1] - 0.12], lb, [lt[0] + 0.02, lt[1] - 0.1],
  ], 5, true);
  const armRightOutline = catmull([
    [rt[0] + 0.02, rt[1] + 0.06], [e15.right[0] - IN - 0.1, -1.46], [e15.right[0] - IN, -1.52], [e19.right[0] - IN, -1.9], [axisX + 1.2 - 0.14, -2.45],
    [axisX + 0.9, -2.72], [meet[0] + 0.32, pawY - 0.02], [meet[0] + 0.1, pawY + 0.04],
    [meet[0] - 0.02, meet[1] - 0.12], rb, [rt[0] - 0.02, rt[1] - 0.1],
  ], 5, true).reverse();
  const armL0 = inflate(armLeftOutline, { ...L.arm, zOffset: 0 });
  const armR0 = inflate(armRightOutline, { ...L.arm, zOffset: 0 });
  const embed = (y: number): number => {
    const t = Math.min(1, Math.max(0, (lt[1] - y) / 0.3)); // 0 at the top of the stroke, 1 a bit below
    return 0.2 * (1 - t * t * (3 - 2 * t));
  };
  const surfaces = [headNeck, torso];
  const armLeft = drapeOnto(armL0, surfaces, L.armGap, embed);
  const armRight = drapeOnto(armR0, surfaces, L.armGap, embed);
  const shoulderL: [number, number, number] = [lt[0] - 0.25, lt[1] - 0.15, armLeft.frontZMax - 0.2];
  const shoulderR: [number, number, number] = [rt[0] + 0.25, rt[1] - 0.15, armRight.frontZMax - 0.2];

  // Thighs: two ovals at the lower sides of the seated body, in front of the torso. [A]
  const thighY = -3.55;
  const tl0 = inflate(ellipseOutline(axisX - 0.98, thighY, 0.62, 0.7, 56), { ...L.thigh, zOffset: 0 });
  const tr0 = inflate(ellipseOutline(axisX + 0.98, thighY, 0.62, 0.7, 56), { ...L.thigh, zOffset: 0 });
  const thighLeft = shiftXY(tl0, 0, 0, zNeededInFront(tl0, [torso], L.gap));
  const thighRight = shiftXY(tr0, 0, 0, zNeededInFront(tr0, [torso], L.gap));
  const hipLeft: [number, number, number] = [axisX - 0.98, thighY + 0.2, thighLeft.frontZMax - 0.2];
  const hipRight: [number, number, number] = [axisX + 0.98, thighY + 0.2, thighRight.frontZMax - 0.2];

  // Feet: a long soft oval each, built upright (long axis y) and laid forward by the caller. Heel at the origin end. [A]
  const footLen = 0.7, footWid = 0.38;
  const foot0 = inflate(ellipseOutline(0, 0, footWid, footLen, 40), { ...L.foot, zOffset: 0 });
  const footLeft = foot0;
  const footRight = foot0;

  // Tail: a soft curved teardrop built in x/y (root at the origin, curling up and over), stood on its side by the caller. [A]
  const tailSpine: Pt[] = [[0, 0], [0.5, 0.05], [1.0, 0.3], [1.4, 0.75], [1.55, 1.25], [1.35, 1.65]];
  const widths = [0.32, 0.36, 0.38, 0.36, 0.3, 0.12];
  const up: Pt[] = [], dn: Pt[] = [];
  tailSpine.forEach(([x, y], i) => {
    const a = tailSpine[Math.max(0, i - 1)]!, b = tailSpine[Math.min(tailSpine.length - 1, i + 1)]!;
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    const nx = -ty / l, ny = tx / l;
    up.push([x + nx * widths[i]!, y + ny * widths[i]!]);
    dn.push([x - nx * widths[i]!, y - ny * widths[i]!]);
  });
  const tailOutline = catmull([[-0.1, 0], ...up, [1.34, 1.8], ...dn.reverse()], 5, true);
  const tail = inflate(tailOutline, { ...L.tail, zOffset: 0 });
  const tailPivot: [number, number, number] = [axisX, baseY + 0.75, torso.backZMin * 0.75];

  return { torso, joint: [axisX, cropY, 0], armLeft, armRight, shoulderLeft: shoulderL, shoulderRight: shoulderR, thighLeft, thighRight, hipLeft, hipRight, footLeft, footRight, tail, tailPivot, axisX, baseY };
}

/** True if the outline can be inflated (star-shaped from some point). A test uses this on every limb outline. */
export function inflatable(outline: readonly Pt[]): boolean {
  try {
    const m = inflate(outline, { samples: 48, rings: 4 });
    return isStarShaped(m.rim, m.centre);
  } catch {
    return false;
  }
}
