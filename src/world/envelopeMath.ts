// Phase 27: the envelope and its lantern, as plain arrays and plain maths (pure: no three, no DOM, no clock, no random). The picture has NO words, no seal, no heart, no ribbon bow (CLAUDE_MUST_READ
// rule 3: warm friendship, not romance). A paper lantern drifts down with the envelope hanging from two threads; the envelope waits there for as long as she likes; when she opens it the flap
// swings up and over and the letter slides out of the top. Every size, colour and time is `[A]` (mine, tune by eye). Units are metres, the same as the world.
//
// Local frame of the carrier (everything that moves together): the ENVELOPE's centre is the origin, it faces +z (the camera), the lantern hangs above it. The carrier is placed at the "hover" spot
// over the cake table (`HOVER`, relative to the table's top) and scaled by `ENV.scale`.

import { box, cyl, fan, newMesh, triCount, vertCount, type MeshData, type Vec3 } from './cabinMath';

export const ENV = {
  /** envelope body: width, height, gap between its two panels (the letter slides in the gap) */
  w: 0.26,
  h: 0.17,
  gap: 0.008,
  /** the flap: hinged on the top edge of the facing panel, a triangle this long */
  flapLen: 0.105,
  /** how far the letter slides out of the top when she opens it (m, before scale) */
  letterRise: 0.15,
  /** the lantern above: foot gap above the envelope's top edge, paper height, radii (foot, shoulder) */
  threadLen: 0.17,
  lanternH: 0.26,
  lanternR0: 0.085,
  lanternR1: 0.115,
  /** the whole carrier is drawn this much bigger than life so the envelope reads on a phone */
  scale: 1.3,
  /** the flap's open angle (radians): over the top and leaning back, never flat */
  flapMax: Math.PI * 0.86,
} as const;

const C = {
  paper: 0xefe4cc,
  paperShade: 0xdccfb2,
  edge: 0xc9ba9a,
  flapOut: 0xe6d9bd,
  flapIn: 0xb8c4d4,
  letter: 0xfbf6ea,
  thread: 0x8a6a4a,
  lanternLow: 0xffd9a0,
  lanternHigh: 0xffb86b,
  lanternRim: 0xc9873c,
};

/** where the carrier hovers while it waits: x, y, z relative to the table's top (the view adds the table's place) */
export const HOVER: Vec3 = [0, 0.4, 0.35];

/** top of the envelope in carrier-local metres */
export const ENV_TOP_Y = ENV.h / 2;
/** the lantern's foot and top in carrier-local metres */
export const LANTERN_FOOT_Y = ENV_TOP_Y + ENV.threadLen;
export const LANTERN_TOP_Y = LANTERN_FOOT_Y + ENV.lanternH;
/** where the flap's hinge is in carrier-local metres (on the facing panel's top edge) */
export const FLAP_HINGE: Vec3 = [0, ENV.h / 2, ENV.gap / 2 + 0.002];
/** where the flame is inside the lantern (the halo sits here), carrier-local */
export const FLAME_AT: Vec3 = [0, LANTERN_FOOT_Y + 0.05, 0];
/** where the letter rests (hidden in the gap), carrier-local; it slides up from here */
export const LETTER_REST: Vec3 = [0, -0.004, 0];

/** The carrier's fixed surface: the lantern paper, the two threads and the envelope's two panels and edges, as ONE mesh (vertex colours). The flap and the letter are their own pieces. */
export function buildCarrier(): MeshData {
  const m = newMesh();
  const { w, h, gap } = ENV;
  // the envelope: a facing panel and a rear panel with a gap between them, closed along the bottom and the two sides; the top stays open for the letter
  box(m, { c: [0, 0, gap / 2] }, [w, h, 0.002], C.paper);
  box(m, { c: [0, 0, -gap / 2] }, [w, h, 0.002], C.paperShade);
  box(m, { c: [0, -h / 2 + 0.0015, 0] }, [w, 0.003, gap + 0.002], C.edge);
  box(m, { c: [-w / 2 + 0.0015, 0, 0] }, [0.003, h, gap + 0.002], C.edge);
  box(m, { c: [w / 2 - 0.0015, 0, 0] }, [0.003, h, gap + 0.002], C.edge);
  // two threads from the top corners up to the lantern's foot
  for (const s of [-1, 1] as const) {
    const x0 = s * (w / 2 - 0.02);
    const x1 = s * 0.05;
    const len = Math.hypot(x1 - x0, ENV.threadLen);
    const lean = Math.atan2(x1 - x0, ENV.threadLen);
    box(m, { c: [(x0 + x1) / 2, ENV_TOP_Y + ENV.threadLen / 2, 0], rz: -lean }, [0.003, len, 0.003], C.thread);
  }
  // the lantern: a tapered six-sided paper tube in two bands (a hotter foot, a paler shoulder) with a thin rim at the foot and a small cap on top
  const half = ENV.lanternH / 2;
  const rMid = (ENV.lanternR0 + ENV.lanternR1) / 2;
  cyl(m, { c: [0, LANTERN_FOOT_Y + half / 2, 0] }, ENV.lanternR0, rMid, half, 6, 'y', C.lanternHigh, false);
  cyl(m, { c: [0, LANTERN_FOOT_Y + half + half / 2, 0] }, rMid, ENV.lanternR1, half, 6, 'y', C.lanternLow, false);
  cyl(m, { c: [0, LANTERN_FOOT_Y + 0.004, 0] }, ENV.lanternR0 + 0.004, ENV.lanternR0 + 0.004, 0.008, 6, 'y', C.lanternRim, true);
  cyl(m, { c: [0, LANTERN_TOP_Y + 0.006, 0] }, ENV.lanternR1, ENV.lanternR1 * 0.8, 0.012, 6, 'y', C.lanternRim, true);
  return m;
}

/** The flap: a triangle with its hinge along the local x axis at the origin and its tip straight down (-y). Two faces a hair apart: the outside paper and the pale inside lining. */
export function buildFlap(): MeshData {
  const m = newMesh();
  const pts: [number, number][] = [
    [-ENV.w / 2, 0],
    [ENV.w / 2, 0],
    [0, -ENV.flapLen],
  ];
  const cAt: [number, number] = [0, -ENV.flapLen / 3];
  const c1 = hex3(C.flapOut);
  const c2 = hex3(C.flapIn);
  fan(m, { c: [0, 0, 0.0006] }, pts, [0, 0, 1], c1, c1, undefined, undefined, cAt);
  fan(m, { c: [0, 0, -0.0006] }, pts, [0, 0, -1], c2, c2, undefined, undefined, cAt);
  return m;
}

/** The letter: a plain ivory card, a little smaller than the envelope. No lines on it (no words). */
export function buildLetter(): MeshData {
  const m = newMesh();
  box(m, { c: [0, 0, 0] }, [ENV.w - 0.03, ENV.h - 0.016, 0.003], C.letter);
  return m;
}

function hex3(h: number): Vec3 {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

export function envelopeStats(): { triangles: number; vertices: number; drawCalls: number } {
  const a = buildCarrier();
  const b = buildFlap();
  const c = buildLetter();
  // carrier, flap, letter, and the one halo point round the flame
  return { triangles: triCount(a) + triCount(b) + triCount(c), vertices: vertCount(a) + vertCount(b) + vertCount(c), drawCalls: 4 };
}

// ---------------------------------------------------------------------------
// Where everything is at a moment. Inputs are the machine's own numbers (`arriveProgress` and `openProgress`, 0..1) and a clock for the idle sway.
// ---------------------------------------------------------------------------
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

export interface EnvelopePose {
  visible: boolean;
  /** carrier offset from the hover spot, metres (before the view adds the hover spot's place) */
  x: number;
  y: number;
  z: number;
  roll: number;
  yaw: number;
  /** 0..1 how opaque (the paper fades in at the start of the arrival and never fades out) */
  alpha: number;
  /** 0..1 the light inside the lantern, with a slow flicker */
  glow: number;
  /** the flap's angle (radians, 0 = closed on the front) */
  flap: number;
  /** how far the letter has slid up out of the top, metres (before scale) */
  letterY: number;
  /** is the letter above the envelope's top (so it is seen) */
  letterOut: boolean;
}

export const DESCENT = {
  /** where the carrier starts, relative to the hover spot: high above and a little to one side, so it enters from out of the top of the picture */
  from: [0.45, 1.9, -0.5] as Vec3,
  /** the flap opens over the first share of the opening, then the letter slides out over the rest */
  flapEnd: 0.45,
  letterStart: 0.38,
};

/**
 * `arrive` and `open` are `LetterMachine.arriveProgress` / `.openProgress`. `t` is a clock in seconds for the sway while it hangs. Reduced motion: no travel (it fades in where it hangs),
 * no sway, no flicker; the flap and the letter still move, plainly, over the machine's shorter opening time.
 */
export function envelopePose(arrive: number, open: number, t: number, reduced = false): EnvelopePose {
  const a = Number.isFinite(arrive) ? clamp01(arrive) : 0;
  const o = Number.isFinite(open) ? clamp01(open) : 0;
  const tt = Number.isFinite(t) ? t : 0;
  if (a <= 0) return { visible: false, x: 0, y: 0, z: 0, roll: 0, yaw: 0, alpha: 0, glow: 0, flap: 0, letterY: 0, letterOut: false };
  // a gentle landing: fast at first, slowing to a hover (ease out, cubic)
  const k = 1 - Math.pow(1 - a, 3);
  const rest = reduced ? 1 : k;
  const settle = 1 - a; // 1 while it is still coming, 0 once it hangs
  const swayK = reduced ? 0 : 1;
  const sway = swayK * (0.02 + 0.07 * settle);
  const w = 2 * Math.PI * 0.21 * tt;
  const x = (1 - rest) * DESCENT.from[0] + sway * Math.sin(w);
  const y = (1 - rest) * DESCENT.from[1] + swayK * 0.012 * Math.sin(2 * Math.PI * 0.17 * tt + 1);
  const z = (1 - rest) * DESCENT.from[2] + sway * 0.5 * Math.cos(w * 0.8);
  const flick = swayK * (0.06 * Math.sin(2 * Math.PI * 1.3 * tt) + 0.03 * Math.sin(2 * Math.PI * 3.1 * tt + 2));
  const flap = smooth(0, DESCENT.flapEnd, o) * ENV.flapMax;
  const rise = smooth(DESCENT.letterStart, 1, o);
  const letterY = rise * ENV.letterRise;
  return {
    visible: true,
    x,
    y,
    z,
    roll: swayK * (0.03 + 0.09 * settle) * Math.sin(w + 1.1),
    yaw: swayK * 0.05 * Math.sin(w * 0.7),
    alpha: reduced ? smooth(0, 1, a) : smooth(0, 0.1, a),
    glow: clamp01(smooth(0, 0.25, a) * (0.93 + flick)),
    flap,
    letterY,
    // the letter's top edge clears the envelope's top once it has slid up by more than the gap between its own top and the panel's
    letterOut: letterY > 0.012,
  };
}

/** The camera for this view: in front of the hover spot, far enough to keep the lantern, the envelope and a bit of the cake in the picture; wider on a tall phone. Relative to the hover spot. */
export function envelopeCamera(aspect: number): { eye: Vec3; look: Vec3; fovDeg: number } {
  const a = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 0.5;
  const tall = a < 0.8;
  return { eye: [0.04, tall ? 0.18 : 0.12, tall ? 1.95 : 2.3], look: [0, tall ? 0.16 : 0.2, 0], fovDeg: tall ? 42 : 40 };
}
