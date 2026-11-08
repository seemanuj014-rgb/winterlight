import * as THREE from 'three';
import type { Stage } from '../core/renderer';
import { createBackdrop, type Backdrop } from '../world/backdrop';
import { createGround, type Ground } from '../world/ground';
import { createWorldLighting, type Lighting } from '../world/lighting';
import { createCake, type Cake, type CandleLook } from '../world/cake';
import { CAKE_SITE, CAKE_TOP_Y, CANDLE_COUNT, cakeGroundY } from '../world/cakeMath';
import { createLanterns, type Lanterns } from '../fx/lanterns';
import { createGlitter, type GlitterBurst } from '../fx/glitter';
import { RELEASE, lanternPose, makeLanterns, releaseCamera } from '../fx/lanternMath';
import { GLITTER } from '../fx/glitterMath';
import { createReleaseAct, type ReleaseAct } from './releaseAct';
import type { Bus, WinterEvents } from '../state/events';

// Phase 26 test view: `?release` = the beat after the candles. The cake stands with its five flames out; the music hushes (nothing moves for RELEASE.hushS), then a soft snow-glitter
// burst goes off over the table and the paper lanterns let go one by one and rise into the aurora, swaying, fading out high up. NO Chamgadad (Phase 28 places her). It is a plain clock:
// no input, no microphone. Knobs:
//   &at=<s>        freeze at that many seconds after the START of the release (a repeatable frame); without it the release plays once from the start and holds the empty sky
//   &reduced, &nopost, &debug&tier=low|mid|high   as on every test view
//   &bloom=0..1   the glow gain of the post pass (default 0.4, set in main.ts)
//   &sound         (main.ts) the sound button appears and the card's own events make the sounds; the release then WAITS for the first touch or key press (a phone has no sound before one),
//                  so the hush and the swell can be heard. Without `&sound` it starts at once.
// The clock is the real `ReleaseMachine` (`fx/releaseMath.ts`) and its events (`release:start`, `release:burst`, `release:done`) go out on `view.bus`.
// State is on `window.__release`.

export interface ReleaseView {
  /** the bus the release's events go out on (main.ts hands it to the audio engine under `&sound`) */
  readonly bus: Bus<WinterEvents>;
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

declare global {
  interface Window {
    __release?: {
      t(): number;
      /** hush | release | done (idle before it starts) */
      phase(): string;
      /** start now (only needed under `&sound`, where the view waits for a touch) */
      start(): void;
      /** every event the machine has fired: type and its own time */
      log(): { type: string; at: number }[];
      /** the bus events seen, in order, with the machine's time */
      busLog(): { at: number; name: string }[];
      draws(): number;
      /** lanterns in the sky right now */
      up(): number;
      /** visible glitter sparks right now (0 before the burst, 0 after its life) */
      sparkLife(): number;
      counts(): { lanterns: number; glitter: number };
      stats(): ReturnType<Lanterns['stats']>;
      /** where lantern i is on screen (px), or null if it is not up */
      screenOf(i: number): { x: number; y: number } | null;
    };
  }
}

export function createReleaseView(ctx: { stage: Stage; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean }): ReleaseView {
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
  // the cake as the last act left it: the table is up, the five flames are out
  const out: CandleLook[] = Array.from({ length: CANDLE_COUNT }, () => ({ state: 'out', flame: 0, dyingFor: 1, outAt: 0, bend: 0 }));
  cake.set(out, 1, 0, 99);

  const gy = cakeGroundY();
  const topY = gy + CAKE_TOP_Y;
  const lanterns: Lanterns = createLanterns({ tier: stage.tier, reducedMotion: ctx.reduced, pixelRatio: pr() });
  lanterns.setOrigin(CAKE_SITE.x, topY, CAKE_SITE.z);
  scene.add(lanterns.root);
  const glitter: GlitterBurst = createGlitter({ tier: stage.tier, reducedMotion: ctx.reduced, pixelRatio: pr() });
  glitter.setOrigin(CAKE_SITE.x, topY + 0.1, CAKE_SITE.z);
  scene.add(glitter.points);

  let hNow = 780;
  let fovNow = 48;
  const place = (aspect: number): void => {
    const c = releaseCamera(aspect);
    camera.aspect = aspect;
    camera.fov = c.fovDeg;
    camera.near = 0.05;
    camera.far = 400;
    camera.position.set(CAKE_SITE.x + c.eye[0], topY + c.eye[1], CAKE_SITE.z + c.eye[2]);
    camera.lookAt(CAKE_SITE.x + c.look[0], topY + c.look[1], CAKE_SITE.z + c.look[2]);
    camera.updateProjectionMatrix();
    fovNow = c.fovDeg;
    lanterns.setView(hNow, fovNow, pr());
  };
  place(Math.max(0.2, (window.innerWidth || 390) / Math.max(1, window.innerHeight || 780)));

  const frozen = params.has('at');
  const frozenAt = Number(params.get('at') ?? 0);
  const act: ReleaseAct = createReleaseAct();
  const busLog: { at: number; name: string }[] = [];
  for (const name of ['release:start', 'release:burst', 'release:done'] as const) act.bus.on(name, () => void busLog.push({ at: Number(act.machine.time.toFixed(2)), name }));
  // `t` is the machine's clock (held at the end); a frozen frame runs the machine that many fixed steps first so its events fire too
  const FIXED = 1 / 60;
  const readT = (): number => act.machine.time;
  const waitForTouch = params.has('sound');
  let kicked = false;
  const kickoff = (): void => {
    if (kicked) return;
    kicked = true;
    act.start();
    if (frozen) {
      const steps = Math.round(Math.max(0, frozenAt) / FIXED);
      for (let i = 0; i < steps; i++) act.step(FIXED);
    }
  };
  const onGesture = (): void => {
    if (!frozen) kickoff();
  };
  if (waitForTouch && !frozen) {
    for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, onGesture, { once: true });
  }
  const data = makeLanterns(26, 18);
  const v3 = new THREE.Vector3();

  window.__release = {
    t: () => readT(),
    phase: () => act.machine.phase,
    start: () => kickoff(),
    log: () => [...act.machine.log],
    busLog: () => [...busLog],
    draws: () => stage.gl.info.render.calls,
    up: () => {
      const n = lanterns.count;
      let k = 0;
      for (let i = 0; i < n; i++) if (lanternPose(data[i]!, readT(), ctx.reduced).visible) k++;
      return k;
    },
    sparkLife: () => {
      const s = readT() - RELEASE.hushS;
      return s > 0 && s < GLITTER.lifeS + 0.4 ? 1 : 0;
    },
    counts: () => ({ lanterns: lanterns.count, glitter: glitter.count }),
    stats: () => lanterns.stats(),
    screenOf: (i) => {
      const p = lanternPose(data[i]!, readT(), ctx.reduced);
      if (!p.visible) return null;
      v3.set(CAKE_SITE.x + p.x, topY + p.y, CAKE_SITE.z + p.z).project(camera);
      const w = ctx.canvas.clientWidth || 390;
      const h = ctx.canvas.clientHeight || 780;
      return { x: (v3.x * 0.5 + 0.5) * w, y: (1 - (v3.y * 0.5 + 0.5)) * h };
    },
  };

  return {
    bus: act.bus,
    update(dt) {
      if (!waitForTouch) kickoff();
      if (frozen) return;
      act.step(dt); // the machine caps a long frame, and holds the clock at the end (the sky is empty again)
    },
    render(tSec) {
      const now = readT();
      backdrop.update(frozen ? frozenAt : tSec, camera);
      ground.update(frozen ? frozenAt : tSec, camera);
      lighting.update(frozen ? frozenAt : tSec);
      cake.update(frozen ? frozenAt : tSec);
      lanterns.update(now);
      glitter.update(now - RELEASE.hushS);
    },
    resize(aspect, w, h) {
      backdrop.setPixelRatio(pr());
      ground.setPixelRatio(pr());
      glitter.setPixelRatio(pr());
      hNow = h;
      place(aspect);
      cake.setView(h, fovNow, pr());
      void w;
    },
    setTier(tier) {
      backdrop.setTier(tier);
      ground.setTier(tier);
      lighting.setTier(tier);
      lanterns.setTier(tier);
      glitter.setTier(tier);
    },
    dispose() {
      act.dispose();
      lanterns.dispose();
      glitter.dispose();
      cake.dispose();
      lighting.dispose();
    },
  };
}
