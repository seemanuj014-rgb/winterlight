import * as THREE from 'three';
import type { Stage } from '../core/renderer';
import { createBackdrop, type Backdrop } from '../world/backdrop';
import { createGround, type Ground } from '../world/ground';
import { createWorldLighting, type Lighting } from '../world/lighting';
import { createCake, type Cake } from '../world/cake';
import { cakeCamera } from '../world/cakeMath';
import { CakeMachine, parseBlowScript, scriptedBlow, type CakeEvent } from './cakeMath';
import { CAKE_TEXT } from './cakeText';
import { createHud, type Hud } from './hud';
import { createCakeAct, type CakeAct } from './act4_cake';
import type { Bus, WinterEvents } from '../state/events';

// Phase 25 test view: `?cake` = the snow-table with the cake and its five candles on the stage clearing, under the night sky. NO Chamgadad (she is 30 draw calls; Phase 28 places her).
// It runs the real CakeMachine, so the whole moment can be looked at without a microphone and without a finger:
//   &at=<s>        run the machine that many fixed-step seconds from the start and freeze there (a repeatable frame)
//   &blow=2-3.5    a scripted breath, in machine seconds (several ranges with commas), standing in for the microphone
//   &tap=<s>[:n]   a scripted tap at that machine second, on candle n (or the next lit one); several with commas
//   &reduced, &nopost, &nohud, &debug&tier=low|mid|high   as on every test view
//   &nomic         never ask for the microphone (taps still work)
// Touch, mouse, keys and the microphone are wired through the act (`act4_cake.ts`); a scripted `&blow` stands in for the microphone and then it is not asked at all.
// State is on `window.__cake`.

export interface CakeView {
  /** Phase 28: the cake's events go out here (the card chains on `act:done {4}`) */
  readonly bus: Bus<WinterEvents>;
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

declare global {
  interface Window {
    __cake?: {
      phase(): string;
      lit(): number;
      log(): CakeEvent[];
      t(): number;
      draws(): number;
      stats(): ReturnType<Cake['stats']>;
      machine: CakeMachine;
      act: CakeAct;
      screenOf(id: string): { x: number; y: number; radiusPx: number } | null;
      busLog(): { at: number; name: string; data: unknown }[];
      acts(): { phase: string; lit: number; mic: string; micListening: boolean; focus: string | null; done: boolean; reading: unknown };
    };
  }
}

export function createCakeView(ctx: { stage: Stage; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean }): CakeView {
  const { stage, scene, camera, params } = ctx;
  const pr = (): number => Math.min(window.devicePixelRatio || 1, stage.settings.maxPixelRatio);
  scene.background = new THREE.Color(0x0d1b2e);

  const backdrop: Backdrop = createBackdrop({ tier: stage.tier, reducedMotion: ctx.reduced, pixelRatio: pr() });
  scene.add(backdrop.root);
  const ground: Ground = createGround({ tier: stage.tier, reducedMotion: ctx.reduced, pixelRatio: pr() });
  scene.add(ground.root);
  const lighting: Lighting = createWorldLighting({ tier: stage.tier, reducedMotion: ctx.reduced });
  scene.add(lighting.root);
  const cake: Cake = createCake({ reducedMotion: ctx.reduced, pixelRatio: pr() });
  scene.add(cake.root);
  if (params.has('debug')) {
    console.log('[cake] stats', stage.tier, JSON.stringify(cake.stats()));
    console.log('[cake] lights', stage.tier, JSON.stringify(lighting.stats()));
  }

  const hud: Hud | null = params.has('nohud') ? null : createHud({ hint: CAKE_TEXT.hint, line: CAKE_TEXT.line });
  const act: CakeAct = createCakeAct({ canvas: ctx.canvas, camera, cake, hud, reduced: ctx.reduced, mic: !params.has('nomic') });
  const machine = act.machine;
  const busLog: { at: number; name: string; data: unknown }[] = [];
  for (const name of ['act:enter', 'cake:wish', 'candle:out', 'act:done'] as const) act.bus.on(name, (data) => void busLog.push({ at: Number(act.machine.time.toFixed(2)), name, data }));
  const scriptedBlowOn = params.has('blow');

  const blowScript = parseBlowScript(params.get('blow'));
  const taps = (params.get('tap') ?? '')
    .split(',')
    .map((s) => /^(\d+(?:\.\d+)?)(?::(\d))?$/.exec(s.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ at: Number(m[1]), candle: m[2] === undefined ? null : Number(m[2]) }))
    .sort((a, b) => a.at - b.at);

  let fovNow = 36;
  let hNow = 780;
  const place = (aspect: number): void => {
    const c = cakeCamera(aspect);
    camera.aspect = aspect;
    camera.fov = c.fovDeg;
    camera.near = 0.05;
    camera.far = 200;
    camera.position.set(...c.eye);
    camera.lookAt(...c.look);
    camera.updateProjectionMatrix();
    fovNow = c.fovDeg;
    cake.setView(hNow, fovNow, pr());
  };
  place(Math.max(0.2, (window.innerWidth || 390) / Math.max(1, window.innerHeight || 780)));

  const FIXED = 1 / 60;
  let t = 0;
  let frozen = false;
  let started = false;
  const step = (dt: number): void => {
    while (taps.length && taps[0]!.at <= t) machine.tap(taps.shift()!.candle);
    act.step(dt, scriptedBlowOn ? { blowing: scriptedBlow(blowScript, t), strength: 0.8 } : undefined);
    t += dt;
  };
  const show = (): void => act.render();
  const kickoff = (): void => {
    if (started) return;
    started = true;
    act.start();
    if (params.has('at')) {
      const steps = Math.round(Number(params.get('at')) / FIXED);
      for (let i = 0; i < steps; i++) step(FIXED);
      frozen = true;
      act.setEnabled(false);
    }
  };

  window.__cake = {
    phase: () => machine.phase,
    lit: () => machine.litCount,
    log: () => [...machine.log],
    t: () => t,
    draws: () => stage.gl.info.render.calls,
    stats: () => cake.stats(),
    machine,
    act,
    screenOf: (id) => act.screenOf(id),
    busLog: () => [...busLog],
    acts: () => act.state(),
  };

  return {
    bus: act.bus,
    update(dt) {
      kickoff();
      if (frozen) return;
      step(dt);
    },
    render(tSec) {
      const at = frozen ? Number(params.get('at') ?? 0) : tSec;
      backdrop.update(at, camera);
      ground.update(at, camera);
      lighting.update(at);
      show();
      cake.update(frozen ? t : tSec);
    },
    resize(aspect, w, h) {
      backdrop.setPixelRatio(pr());
      ground.setPixelRatio(pr());
      hNow = h;
      act.resize(w, h);
      place(aspect);
      void w;
    },
    setTier(tier) {
      backdrop.setTier(tier);
      ground.setTier(tier);
      lighting.setTier(tier);
    },
    dispose() {
      act.dispose();
      hud?.dispose();
      cake.dispose();
      lighting.dispose();
    },
  };
}
