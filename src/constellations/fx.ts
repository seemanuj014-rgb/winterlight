import * as THREE from 'three';
import type { ConstellationDef } from './defs';
import type { EngineEvent, EngineState } from './engine';

// Phase 21: how a constellation LOOKS. Stars with a soft glow (one Points object, one draw call), lines that draw like glowing frost (one mesh of ribbons, one draw call, with a
// slot for the line that follows the finger), a hint pulse, a soft "not that one" dip, and a completion burst (one Points object, a few dozen specks). Three draw calls in all.
// It only reads what the engine says (state + events); it decides nothing. Plane units: -1..1, y up; `root` is scaled and placed in the sky by the caller (see index.ts).
// Palette: frost `#9cc8ff` / `#f4fbff`, a warm lit star `#ffe2b0` (warm = someone is here, ART_DIRECTION). No red anywhere: a wrong star only dims.
// Reduced motion: lines appear at once, no twinkle, no burst particles (the stars and lines just light up), same story.

export type Tier = 'low' | 'mid' | 'high';
const BURST = { low: 18, mid: 28, high: 40 } as const;
const GLOW_BASE = 0.38;
const LINE_WIDTH = 0.016;
const DRAW_SECONDS = 0.38;
const BURST_SECONDS = 2.2;

export interface FxOptions {
  def: ConstellationDef;
  tier: Tier;
  reducedMotion: boolean;
  pixelRatio?: number;
}

export interface Fx {
  root: THREE.Group;
  /** engine events -> visual cues (a connect starts a line drawing, a complete starts the burst ...) */
  onEvent(e: EngineEvent): void;
  /** call every frame; `tSec` is the page's own clock */
  update(dt: number, tSec: number, s: EngineState): void;
  setPixelRatio(pr: number): void;
  /** line half-width in plane units (the caller keeps it a few pixels wide on any screen) */
  setLineWidth(w: number): void;
  setTier(tier: Tier): void;
  setReducedMotion(on: boolean): void;
  /** instantly show an engine state (the test view's `&pre=`) */
  snapTo(s: EngineState): void;
  /** where a star is in the root's own plane (never null for a real id) */
  starLocal(id: string): THREE.Vector3 | null;
  stats(): { drawCalls: number; triangles: number; particles: number };
  dispose(): void;
}

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aGlow;
attribute float aPhase;
uniform float uPx;
uniform float uTime;
uniform float uTwinkle;
varying float vGlow;
varying float vPhase;
void main() {
  vGlow = aGlow;
  vPhase = aPhase;
  float tw = 1.0 + uTwinkle * 0.12 * sin(uTime * 1.3 + aPhase * 6.2831);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx * (0.8 + 0.5 * aGlow) * tw;
}
`;
const STAR_FRAG = /* glsl */ `
uniform vec3 uFrost;
uniform vec3 uWarm;
uniform float uWarmMix;
varying float vGlow;
varying float vPhase;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float core = exp(-r * r * 38.0);
  float halo = exp(-r * r * 6.5) * 0.55;
  // a faint four-point glint that grows with the glow
  float cross = (exp(-abs(p.x) * 22.0) + exp(-abs(p.y) * 22.0)) * (1.0 - r) * smoothstep(0.45, 1.0, vGlow) * 0.55;
  vec3 col = mix(uFrost, uWarm, clamp(uWarmMix * smoothstep(0.6, 1.0, vGlow), 0.0, 1.0));
  float a = (core + halo * (0.35 + 0.65 * vGlow) + cross) * (0.35 + 0.65 * vGlow);
  gl_FragColor = vec4(col * (0.8 + core), a);
  #include <colorspace_fragment>
}
`;

const LINE_VERT = /* glsl */ `
attribute vec2 aA;
attribute vec2 aB;
attribute float aSide;
attribute float aEnd;
attribute float aProg;
attribute float aAlpha;
attribute float aSeed;
uniform float uWidth;
varying float vSide;
varying float vAlong;
varying float vCap;
varying float vProg;
varying float vAlpha;
varying float vSeed;
varying float vLen;
void main() {
  vec2 d = aB - aA;
  float len = max(length(d), 1e-4);
  vec2 dir = d / len;
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = uWidth * 3.2;
  vec2 pos = mix(aA, aB, aEnd) + nrm * aSide * w + dir * (aEnd * 2.0 - 1.0) * w;
  vSide = aSide;
  vAlong = aEnd + (aEnd * 2.0 - 1.0) * w / len;
  vCap = w / len;
  vProg = aProg;
  vAlpha = aAlpha;
  vSeed = aSeed;
  vLen = len / w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
}
`;
const LINE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlash;
uniform float uWarmMix;
uniform float uTwinkle;
uniform vec3 uCore;
uniform vec3 uHalo;
uniform vec3 uWarm;
varying float vSide;
varying float vAlong;
varying float vCap;
varying float vProg;
varying float vAlpha;
varying float vSeed;
varying float vLen;
void main() {
  if (vAlpha < 0.003) discard;
  // distance from the line's own axis, with round caps
  float over = max(0.0, abs(vAlong - 0.5) - 0.5) / max(vCap, 1e-4) / 1.0;
  float r = length(vec2(vSide, over));
  // the drawn part: everything up to the head, with a soft head
  float head = smoothstep(vProg + 0.004, vProg - 0.05, vAlong) * step(0.0001, vProg);
  float core = exp(-r * r * 22.0);
  float halo = exp(-r * r * 4.0) * 0.5;
  // frost glints along the line: tiny crystals that wake and fade, never a flicker
  float g = sin(vAlong * vLen * 2.2 + vSeed * 40.0);
  float glint = pow(max(0.0, g), 24.0) * exp(-vSide * vSide * 3.0) * (0.5 + 0.5 * uTwinkle * sin(uTime * 0.9 + vSeed * 30.0 + vAlong * 9.0));
  vec3 base = mix(uHalo, uCore, core);
  base = mix(base, uWarm, uWarmMix * 0.6);
  float a = (core * 0.95 + halo + glint * 0.9 + uFlash * (core + halo)) * head * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(base * (1.0 + uFlash * 0.6 + glint), a);
  #include <colorspace_fragment>
}
`;

const BURST_VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
uniform float uPx;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx * (0.5 + 0.5 * aLife) * step(0.001, aLife);
}
`;
const BURST_FRAG = /* glsl */ `
uniform vec3 uWarm;
uniform vec3 uFrost;
varying float vLife;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || vLife < 0.001) discard;
  float a = exp(-r * r * 7.0) * smoothstep(0.0, 0.3, vLife);
  gl_FragColor = vec4(mix(uFrost, uWarm, 0.65), a);
  #include <colorspace_fragment>
}
`;

const col = (hex: number): THREE.Color => new THREE.Color(hex);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const approach = (cur: number, target: number, dt: number, rate: number): number => cur + (target - cur) * (1 - Math.exp(-dt * rate));

export function createConstellationFx(opts: FxOptions): Fx {
  const { def } = opts;
  let tier = opts.tier;
  let reduced = opts.reducedMotion;
  let pr = opts.pixelRatio ?? 1;
  const root = new THREE.Group();
  root.name = `constellation-${def.id}`;
  const n = def.nodes.length;
  const m = def.edges.length;
  const index = new Map(def.nodes.map((s, i) => [s.id, i] as const));

  // ---- stars ---------------------------------------------------------------------------------------------------------------------------
  const sPos = new Float32Array(n * 3);
  const sSize = new Float32Array(n);
  const sGlow = new Float32Array(n).fill(GLOW_BASE);
  const sPhase = new Float32Array(n);
  def.nodes.forEach((s, i) => {
    sPos.set([s.x, s.y, 0], i * 3);
    sSize[i] = 30 * (s.size ?? 1);
    sPhase[i] = (i * 0.618) % 1;
  });
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  sGeo.setAttribute('aGlow', new THREE.BufferAttribute(sGlow, 1).setUsage(THREE.DynamicDrawUsage));
  sGeo.setAttribute('aPhase', new THREE.BufferAttribute(sPhase, 1));
  const sMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: { uPx: { value: pr }, uTime: { value: 0 }, uTwinkle: { value: reduced ? 0 : 1 }, uFrost: { value: col(0xcfe3ff) }, uWarm: { value: col(0xffe2b0) }, uWarmMix: { value: 0 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(sGeo, sMat);
  stars.name = 'constellation-stars';
  stars.frustumCulled = false;
  stars.renderOrder = 20;

  // ---- lines: m edges + one slot for the line that follows the finger -----------------------------------------------------------------
  const slots = m + 1;
  const aA = new Float32Array(slots * 4 * 2);
  const aB = new Float32Array(slots * 4 * 2);
  const aSide = new Float32Array(slots * 4);
  const aEnd = new Float32Array(slots * 4);
  const aProg = new Float32Array(slots * 4);
  const aAlpha = new Float32Array(slots * 4);
  const aSeed = new Float32Array(slots * 4);
  const idx = new Uint16Array(slots * 6);
  const dummy = new Float32Array(slots * 4 * 3);
  for (let s = 0; s < slots; s++) {
    for (let v = 0; v < 4; v++) {
      aSide[s * 4 + v] = v % 2 === 0 ? -1 : 1;
      aEnd[s * 4 + v] = v < 2 ? 0 : 1;
      aSeed[s * 4 + v] = ((s * 0.37 + 0.11) % 1);
    }
    idx.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 1, s * 4 + 3, s * 4 + 2], s * 6);
  }
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.BufferAttribute(dummy, 3));
  const dyn = (a: Float32Array, size: number, name: string): void => void lGeo.setAttribute(name, new THREE.BufferAttribute(a, size).setUsage(THREE.DynamicDrawUsage));
  dyn(aA, 2, 'aA');
  dyn(aB, 2, 'aB');
  dyn(aProg, 1, 'aProg');
  dyn(aAlpha, 1, 'aAlpha');
  lGeo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  lGeo.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 1));
  lGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  lGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  const lMat = new THREE.ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    uniforms: { uTime: { value: 0 }, uWidth: { value: LINE_WIDTH }, uFlash: { value: 0 }, uWarmMix: { value: 0 }, uTwinkle: { value: reduced ? 0 : 1 }, uCore: { value: col(0xf4fbff) }, uHalo: { value: col(0x9cc8ff) }, uWarm: { value: col(0xffe2b0) } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const lines = new THREE.Mesh(lGeo, lMat);
  lines.name = 'constellation-lines';
  lines.frustumCulled = false;
  lines.renderOrder = 19;

  // per-edge visual state
  const eFrom: string[] = def.edges.map(([a]) => a);
  const eProg = new Float32Array(m);
  const eWant = new Float32Array(m);
  const setSlot = (s: number, a: string, b: string): void => {
    const pa = def.nodes[index.get(a)!]!;
    const pb = def.nodes[index.get(b)!]!;
    for (let v = 0; v < 4; v++) {
      aA.set([pa.x, pa.y], (s * 4 + v) * 2);
      aB.set([pb.x, pb.y], (s * 4 + v) * 2);
    }
  };
  const setSlotXY = (s: number, ax: number, ay: number, bx: number, by: number): void => {
    for (let v = 0; v < 4; v++) {
      aA.set([ax, ay], (s * 4 + v) * 2);
      aB.set([bx, by], (s * 4 + v) * 2);
    }
  };
  def.edges.forEach(([a, b], i) => setSlot(i, a, b));
  const rubber = m;
  setSlotXY(rubber, 0, 0, 0, 0);

  // ---- the burst ----------------------------------------------------------------------------------------------------------------------
  const bMax = BURST.high;
  const bPos = new Float32Array(bMax * 3);
  const bSize = new Float32Array(bMax).fill(0);
  const bLife = new Float32Array(bMax);
  const bVel = new Float32Array(bMax * 2);
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3).setUsage(THREE.DynamicDrawUsage));
  bGeo.setAttribute('aSize', new THREE.BufferAttribute(bSize, 1));
  bGeo.setAttribute('aLife', new THREE.BufferAttribute(bLife, 1).setUsage(THREE.DynamicDrawUsage));
  const bMat = new THREE.ShaderMaterial({ vertexShader: BURST_VERT, fragmentShader: BURST_FRAG, uniforms: { uPx: { value: pr }, uWarm: { value: col(0xffe2b0) }, uFrost: { value: col(0xcfe3ff) } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const burst = new THREE.Points(bGeo, bMat);
  burst.name = 'constellation-burst';
  burst.frustumCulled = false;
  burst.renderOrder = 21;
  burst.visible = false;
  bGeo.setDrawRange(0, BURST[tier]);

  root.add(lines, stars, burst);

  // ---- state kept between frames --------------------------------------------------------------------------------------------------------
  let flash = 0;
  let warm = 0;
  let burstAge = -1;
  let complete = false;
  const dip = new Float32Array(n); // 0..1: a star that was told "not that one" dims and comes back
  const select = new Float32Array(n); // 0..1: picked-up star
  let seed = 3;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  function startBurst(): void {
    if (reduced) return;
    burstAge = 0;
    burst.visible = true;
    const k = BURST[tier];
    for (let i = 0; i < bMax; i++) {
      const st = def.nodes[i % n]!;
      const ang = rnd() * Math.PI * 2;
      const sp = 0.12 + rnd() * 0.32;
      bPos.set([st.x, st.y, 0], i * 3);
      bVel.set([Math.cos(ang) * sp, Math.sin(ang) * sp + 0.05], i * 2);
      bSize[i] = 10 + rnd() * 14;
      bLife[i] = i < k ? 1 : 0;
    }
    (bGeo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (bGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  function onEvent(e: EngineEvent): void {
    switch (e.type) {
      case 'connect': {
        eFrom[e.edge] = e.from;
        setSlot(e.edge, e.from, e.to);
        eWant[e.edge] = 1;
        if (reduced) eProg[e.edge] = 1;
        break;
      }
      case 'undo':
        eWant[e.edge] = 0;
        if (reduced) eProg[e.edge] = 0;
        break;
      case 'reset':
        eWant.fill(0);
        eProg.fill(0);
        complete = false;
        burstAge = -1;
        burst.visible = false;
        flash = 0;
        break;
      case 'select':
        select[index.get(e.star)!] = 1e-3;
        break;
      case 'wrong':
        dip[index.get(e.star)!] = 1;
        break;
      case 'complete':
        complete = true;
        flash = 1;
        startBurst();
        break;
      default:
        break;
    }
  }

  function snapTo(s: EngineState): void {
    eWant.fill(0);
    eProg.fill(0);
    for (const e of s.drawn) {
      eWant[e] = 1;
      eProg[e] = 1;
    }
    complete = s.complete;
    warm = complete ? 1 : 0;
  }

  const starLocal = (id: string): THREE.Vector3 | null => {
    const i = index.get(id);
    return i === undefined ? null : new THREE.Vector3(sPos[i * 3]!, sPos[i * 3 + 1]!, 0);
  };

  let hintClock = 0;
  function update(dt: number, tSec: number, s: EngineState): void {
    dt = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    sMat.uniforms.uTime!.value = tSec;
    lMat.uniforms.uTime!.value = tSec;
    sMat.uniforms.uTwinkle!.value = lMat.uniforms.uTwinkle!.value = reduced ? 0 : 1;
    hintClock += dt;

    // the lines: drawing and un-drawing
    const drawn = new Set(s.drawn);
    for (let i = 0; i < m; i++) {
      eProg[i] = reduced ? eWant[i]! : Math.abs(eWant[i]! - eProg[i]!) < 1e-3 ? eWant[i]! : eProg[i]! + Math.sign(eWant[i]! - eProg[i]!) * Math.min(Math.abs(eWant[i]! - eProg[i]!), dt / DRAW_SECONDS);
      const ghost = s.hint && s.hint.edge === i && !drawn.has(i);
      if (ghost) {
        // the hint: the line is only dreamt of, a pale pulse from one star to the other
        const h = s.hint!;
        if (eFrom[i] !== h.from) {
          eFrom[i] = h.from;
          setSlot(i, h.from, h.to);
        }
        for (let v = 0; v < 4; v++) {
          aProg[i * 4 + v] = 1;
          aAlpha[i * 4 + v] = reduced ? 0.3 : 0.16 + 0.16 * (0.5 + 0.5 * Math.sin(hintClock * 2.4));
        }
      } else {
        for (let v = 0; v < 4; v++) {
          aProg[i * 4 + v] = eProg[i]!;
          aAlpha[i * 4 + v] = 0.9;
        }
      }
    }
    // the line that follows the finger
    const a = s.anchor ? def.nodes[index.get(s.anchor)!]! : null;
    const live = !!(s.dragging && s.finger && a);
    if (live) {
      setSlotXY(rubber, a!.x, a!.y, s.finger!.x, s.finger!.y);
      for (let v = 0; v < 4; v++) {
        aProg[rubber * 4 + v] = 1;
        aAlpha[rubber * 4 + v] = 0.75;
      }
    } else for (let v = 0; v < 4; v++) aAlpha[rubber * 4 + v] = approach(aAlpha[rubber * 4 + v]!, 0, dt, 14);
    for (const name of ['aA', 'aB', 'aProg', 'aAlpha']) (lGeo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;

    // the stars
    const joined = new Float32Array(n);
    for (const e of s.drawn) {
      joined[index.get(def.edges[e]![0])!] = 1;
      joined[index.get(def.edges[e]![1])!] = 1;
    }
    const targets = new Set<string>(s.targets);
    for (let i = 0; i < n; i++) {
      const id = def.nodes[i]!.id;
      let t = GLOW_BASE + 0.35 * joined[i]!;
      if (s.anchor === id) t = 1;
      else if (targets.has(id)) t = Math.max(t, reduced ? 0.7 : 0.62 + 0.14 * Math.sin(hintClock * 4 + i));
      if (s.hint && (s.hint.from === id || s.hint.to === id)) t = Math.max(t, reduced ? 0.85 : 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(hintClock * 2.4)));
      if (complete) t = 1;
      dip[i] = approach(dip[i]!, 0, dt, 3.2);
      t = t * (1 - 0.75 * dip[i]!);
      sGlow[i] = approach(sGlow[i]!, t, dt, 9);
      select[i] = s.anchor === id ? approach(select[i]!, 1, dt, 10) : approach(select[i]!, 0, dt, 8);
    }
    (sGeo.getAttribute('aGlow') as THREE.BufferAttribute).needsUpdate = true;
    // a picked-up star swells a little: its size attribute follows `select`
    const sizeAttr = sGeo.getAttribute('aSize') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) sizeAttr.setX(i, 30 * (def.nodes[i]!.size ?? 1) * (1 + 0.22 * select[i]!));
    sizeAttr.needsUpdate = true;

    // completion: the warm light comes in, the flash fades, the burst flies
    warm = approach(warm, complete ? 1 : 0, dt, reduced ? 6 : 1.6);
    sMat.uniforms.uWarmMix!.value = warm;
    lMat.uniforms.uWarmMix!.value = warm;
    flash = Math.max(0, flash - dt / (reduced ? 0.8 : 1.4));
    lMat.uniforms.uFlash!.value = flash * (reduced ? 0.4 : 1);
    if (burstAge >= 0) {
      burstAge += dt;
      const k = BURST[tier];
      for (let i = 0; i < k; i++) {
        const lifeT = burstAge / BURST_SECONDS;
        bPos[i * 3] = bPos[i * 3]! + bVel[i * 2]! * dt * (1 - lifeT * 0.7);
        bPos[i * 3 + 1] = bPos[i * 3 + 1]! + bVel[i * 2 + 1]! * dt * (1 - lifeT * 0.7);
        bLife[i] = clamp01(1 - lifeT);
      }
      (bGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (bGeo.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
      if (burstAge >= BURST_SECONDS) {
        burstAge = -1;
        burst.visible = false;
      }
    }
  }

  return {
    root,
    onEvent,
    update,
    snapTo,
    starLocal,
    setPixelRatio(p) {
      pr = p;
      sMat.uniforms.uPx!.value = p;
      bMat.uniforms.uPx!.value = p;
    },
    setLineWidth(w) {
      if (Number.isFinite(w) && w > 0) lMat.uniforms.uWidth!.value = w;
    },
    setTier(t) {
      tier = t;
      bGeo.setDrawRange(0, BURST[t]);
    },
    setReducedMotion(on) {
      reduced = on;
    },
    stats: () => ({ drawCalls: 2 + (burst.visible ? 1 : 0), triangles: slots * 2, particles: n + (burst.visible ? BURST[tier] : 0) }),
    dispose() {
      for (const g of [sGeo, lGeo, bGeo]) g.dispose();
      for (const mt of [sMat, lMat, bMat]) mt.dispose();
    },
  };
}
