import * as THREE from 'three';
import { makeToon } from '../render/toon/material';
import { buildCake, cakeGroundY, cakeStats, CAKE_CANDLES, CAKE_SITE, CAKE_TARGET, CANDLE_COUNT, CANDLE_TARGET_R, FLAME, FLAME_ANCHORS, type CakeStats } from './cakeMath';
import { FLAME_FRAG, FLAME_VERT } from './cakeShaders';
import { toGeometry } from './meshBuild';

// Phase 25: the snow-table, the cake and the five flames, on the stage clearing. Draw calls: body 2 (surface + ink), flames and smoke wisps 1 = 3. Textures: none.
// Lights: ONE warm point light over the cake whose strength follows how many flames are alight (the cabin's lights are the model; the toon surfaces answer it).
// The act hands it the candle states each frame (`set`); the table rises out of the snow with `appear`.

/** what the act hands in per candle (the same shape as `CandleView` in acts/cakeMath.ts; world/ may not import acts/, so it is spelled out here) */
export interface CandleLook {
  state: 'lit' | 'dying' | 'out';
  flame: number;
  dyingFor: number;
  outAt: number;
  bend: number;
}

export interface Cake {
  root: THREE.Group;
  /** invisible, un-drawn stand-ins the picker raycasts against: one per candle and one for the whole cake (material.visible = false: no draw call) */
  proxies: { candles: THREE.Mesh[]; cake: THREE.Mesh };
  light: THREE.PointLight;
  /** world position of candle i's flame (for the picker and the focus ring) */
  flameWorld(i: number, out?: THREE.Vector3): THREE.Vector3;
  cakeWorld(out?: THREE.Vector3): THREE.Vector3;
  /** every frame: candle states from the machine, its fade-in, the clock */
  set(views: readonly CandleLook[], appear: number, light: number, machineT: number): void;
  update(tSec: number): void;
  /** the view's size in pixels and the camera's vertical field, so a flame is the right size on screen */
  setView(heightPx: number, fovDeg: number, pixelRatio: number): void;
  setReducedMotion(on: boolean): void;
  stats(): CakeStats;
  dispose(): void;
}

const ease = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export function createCake(opts: { reducedMotion: boolean; pixelRatio?: number }): Cake {
  const data = buildCake();
  const root = new THREE.Group();
  root.name = 'cake';
  const gy = cakeGroundY();
  root.position.set(CAKE_SITE.x, gy, CAKE_SITE.z);

  const toon = makeToon({ base: '#ffffff', outline: { widthFrac: 0.012 } });
  toon.material.vertexColors = true;
  toon.material.needsUpdate = true;
  const body = toon.mesh(toGeometry(data));
  body.name = 'cake-body';
  root.add(body);

  // flames (0..4) then wisps (5..9), one Points
  const n = CANDLE_COUNT * 2;
  const pos = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  const seed = new Float32Array(n);
  const flame = new Float32Array(n);
  const bend = new Float32Array(n);
  const age = new Float32Array(n).fill(-1);
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const a = FLAME_ANCHORS[i]!;
    for (const k of [i, i + CANDLE_COUNT]) {
      pos.set(a, k * 3);
      seed[k] = (i * 0.37 + 0.11) % 1;
    }
    kind[i] = 0;
    kind[i + CANDLE_COUNT] = 1;
    flame[i] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const attrs = {
    aKind: new THREE.BufferAttribute(kind, 1),
    aSeed: new THREE.BufferAttribute(seed, 1),
    aFlame: new THREE.BufferAttribute(flame, 1),
    aBend: new THREE.BufferAttribute(bend, 1),
    aAge: new THREE.BufferAttribute(age, 1),
  };
  for (const [k, a] of Object.entries(attrs)) geo.setAttribute(k, a);
  let reduced = opts.reducedMotion;
  const mat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uProj: { value: 600 },
      uHeight: { value: FLAME.height },
      uSprite: { value: FLAME.spriteScale },
      uShow: { value: 0 },
      uCalm: { value: reduced ? 1 : 0 },
      uWispLife: { value: FLAME.wispLife },
      uWispRise: { value: FLAME.wispRise },
      uCore: { value: new THREE.Color(FLAME.core) },
      uEdge: { value: new THREE.Color(FLAME.edge) },
      uWisp: { value: new THREE.Color(FLAME.wispColor) },
    },
    transparent: true,
    depthWrite: false,
  });
  const flames = new THREE.Points(geo, mat);
  flames.name = 'cake-flames';
  flames.frustumCulled = false;
  flames.renderOrder = 4;
  root.add(flames);

  // the warm light over the cake
  const light = new THREE.PointLight(FLAME.core, 0, 2.2, 1.6);
  light.name = 'light-candles';
  light.position.set(0, CAKE_TARGET.centre[1] + 0.2, 0.06);
  root.add(light);

  // picker stand-ins: they raycast but never draw
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const candles = CAKE_CANDLES.map((_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(CANDLE_TARGET_R, 6, 4), hidden);
    m.position.set(...(FLAME_ANCHORS[i] as [number, number, number]));
    m.position.y -= 0.03;
    m.name = `cake-candle-${i}`;
    root.add(m);
    return m;
  });
  const cakeProxy = new THREE.Mesh(new THREE.CylinderGeometry(CAKE_TARGET.radius, CAKE_TARGET.radius, 0.2, 10), hidden);
  cakeProxy.position.set(...(CAKE_TARGET.centre as [number, number, number]));
  cakeProxy.name = 'cake-proxy';
  root.add(cakeProxy);

  // [A] a faint warm afterglow stays when every flame is out (the sponge went muddy grey in the first look with the light at 0); the share of the light that follows the flames is the rest
  const AFTERGLOW = 0.25;
  let baseLight = 0.55;
  let lightNow = 0;
  let appearNow = 0;
  let tNow = 0;
  const applyAppear = (): void => {
    root.visible = appearNow > 0.001;
    root.position.y = gy - (1 - appearNow) * 0.95; // the table rises out of the snow
    mat.uniforms.uShow!.value = ease((appearNow - 0.8) / 0.2);
  };
  applyAppear();

  return {
    root,
    proxies: { candles, cake: cakeProxy },
    light,
    flameWorld(i, out = new THREE.Vector3()) {
      const a = FLAME_ANCHORS[i] ?? FLAME_ANCHORS[0]!;
      root.updateWorldMatrix(true, false);
      return out.set(a[0], a[1] + 0.02, a[2]).applyMatrix4(root.matrixWorld);
    },
    cakeWorld(out = new THREE.Vector3()) {
      root.updateWorldMatrix(true, false);
      return out.set(...(CAKE_TARGET.centre as [number, number, number])).applyMatrix4(root.matrixWorld);
    },
    set(views, appear, lightFrac, machineT) {
      appearNow = appear;
      lightNow = lightFrac;
      tNow = machineT;
      for (let i = 0; i < CANDLE_COUNT; i++) {
        const v = views[i];
        if (!v) continue;
        flame[i] = v.flame;
        bend[i] = v.bend;
        // the smoke begins as the flame is nearly gone and is aged from there
        age[i + CANDLE_COUNT] = v.state === 'lit' ? -1 : Math.max(0, tNow - v.outAt - 0.15);
        flame[i + CANDLE_COUNT] = 0;
      }
      attrs.aFlame.needsUpdate = true;
      attrs.aBend.needsUpdate = true;
      attrs.aAge.needsUpdate = true;
      applyAppear();
    },
    update(tSec) {
      mat.uniforms.uTime!.value = tSec;
      // a tiny steady flicker of the light (exactly steady when reduced)
      const f = reduced ? 1 : 1 + 0.06 * Math.sin(tSec * 11.3) + 0.04 * Math.sin(tSec * 19.1 + 1);
      light.intensity = baseLight * (AFTERGLOW + (1 - AFTERGLOW) * lightNow) * f * ease(appearNow);
    },
    setView(heightPx, fovDeg, pr) {
      mat.uniforms.uProj!.value = (heightPx * pr) / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
    setReducedMotion(on) {
      reduced = on;
      mat.uniforms.uCalm!.value = on ? 1 : 0;
    },
    stats() {
      return cakeStats(data);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      hidden.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry !== undefined) o.geometry.dispose();
      });
      root.removeFromParent();
    },
  };
}
