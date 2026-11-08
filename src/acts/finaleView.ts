import * as THREE from 'three';
import type { Stage } from '../core/renderer';
import { createBackdrop, type Backdrop } from '../world/backdrop';
import { createGround, type Ground } from '../world/ground';
import { createCabin, type Cabin } from '../world/cabin';
import { createWorldLighting, type Lighting } from '../world/lighting';
import { loadContent } from '../content';
import { createFinaleAct, type FinaleAct } from './act6_finale';
import { finaleMessageFor } from './finaleMath';
import { createFinaleSky, type FinaleSky } from './finaleSky';
import { auroraGain, finaleCamera, finaleFade } from './finaleSkyMath';
import type { Bus, WinterEvents } from '../state/events';

// Phase 28 test view: `?finale` = the pictures of the finale, driven only by the finale machine's progress numbers (`acts/finaleMath.ts`):
//   lifting   the five finished shapes lift off their patches in the sky
//   joining   they drift into one row, a crown across the upper sky, and the owner's message (`finale_sky_message` in content/credits.json, as given) fades in under it
//   swelling  the aurora swells (its strength goes up by `AURORA_SWELL_GAIN`); the music box plays here (`finale:swell` -> `engine.birthday()`, only under `&sound`)
//   pulling   the camera pulls back and up through the pines until the cabin glows small in the valley (the `finale` shot); reduced motion = no travel, a dip to night and back
//   done      it holds there (stay a while begins; not in this view)
// NO Chamgadad, no input, no microphone: a plain clock. Knobs:
//   &at=<s>      freeze at that many seconds after the START (a repeatable frame); without it the finale plays once and holds at the valley
//   &text=...    a made-up message in place of content/credits.json (layout tests ONLY: the real card never reads this); `&long` is a long made-up one
//   &sound       (main.ts) the sound button appears and the card's events make the sounds; the finale then WAITS for the first touch or key press
//   &reduced, &nopost, &debug&tier=low|mid|high   as on every test view; `&bloom=0..1` the glow gain of the post pass (default 0.4, set in main.ts)
// State is on `window.__finale`.

export interface FinaleView {
  /** the bus the finale's events go out on */
  readonly bus: Bus<WinterEvents>;
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

declare global {
  interface Window {
    __finale?: {
      t(): number;
      phase(): string;
      /** the five progress numbers: lift, join, swell, pull, whole */
      progress(): { lift: number; join: number; swell: number; pull: number; whole: number };
      log(): { type: string; at: number }[];
      busLog(): { at: number; name: string }[];
      /** draw calls of the last frame (the whole renderer) and what the sky object adds */
      draws(): number;
      skyDraws(): number;
      /** the message as drawn, line by line, and how it was fitted */
      message(): { text: string; lines: string[]; fontPx: number; grew: boolean };
      /** where a shape's first star is, and the message panel's box, on the screen (px) */
      shapeAt(id: string): { x: number; y: number } | null;
      messageBox(): { x0: number; y0: number; x1: number; y1: number } | null;
      aurora(): number;
      fade(): number;
      camera(): { eye: [number, number, number]; fov: number; pitchDeg: number };
    };
  }
}

const LONG =
  'A very long made-up message for the layout test only. It goes on and on across the sky, with a Hinglish bit in the middle (yeh dil se hai, sach mein) and a long word: pneumonoultramicroscopicsilicovolcanoconiosis, to see that nothing is cut.';

export function createFinaleView(ctx: { stage: Stage; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean }): FinaleView {
  const { stage, scene, camera, params } = ctx;
  const reduced = ctx.reduced;
  const pr = (): number => Math.min(window.devicePixelRatio || 1, stage.settings.maxPixelRatio);
  scene.background = new THREE.Color(0x0d1b2e);

  const backdrop: Backdrop = createBackdrop({ tier: stage.tier, reducedMotion: reduced, pixelRatio: pr() });
  scene.add(backdrop.root);
  const ground: Ground = createGround({ tier: stage.tier, reducedMotion: reduced, pixelRatio: pr() });
  scene.add(ground.root);
  const cabin: Cabin = createCabin({ tier: stage.tier, reducedMotion: reduced, pixelRatio: pr() });
  scene.add(cabin.root);
  cabin.setDoorOpen(0);
  const lighting: Lighting = createWorldLighting({ tier: stage.tier, reducedMotion: reduced, cabinRoot: cabin.root });
  scene.add(lighting.root);

  const { content } = loadContent();
  // the owner's string through the one door; `&text=` / `&long` are layout tests only
  const message = params.has('long') ? LONG : params.get('text') ?? finaleMessageFor(content.credits);

  let aspect = Math.max(0.2, (window.innerWidth || 390) / Math.max(1, window.innerHeight || 780));
  let wNow = window.innerWidth || 390;
  let hNow = window.innerHeight || 780;
  const sky: FinaleSky = createFinaleSky({
    scene,
    camera,
    constellations: content.names.constellations,
    message,
    tier: stage.tier,
    reducedMotion: reduced,
    pixelRatio: pr(),
    aspect,
  });

  // reduced motion: the camera cannot travel, so the screen dips to night and back while it changes places
  const fade = document.createElement('div');
  fade.id = 'finale-fade';
  fade.style.cssText = 'position:fixed;inset:0;background:#0d1b2e;opacity:0;pointer-events:none;z-index:3';
  fade.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fade);

  const act: FinaleAct = createFinaleAct({ reducedMotion: reduced });
  const busLog: { at: number; name: string }[] = [];
  for (const name of ['finale:start', 'finale:join', 'finale:swell', 'finale:pullback', 'finale:done'] as const) act.bus.on(name, () => void busLog.push({ at: Number(act.machine.time.toFixed(2)), name }));

  const frozen = params.has('at');
  const frozenAt = Number(params.get('at') ?? 0);
  const FIXED = 1 / 60;
  let kicked = false;
  let pitchDeg = 0;
  let eyeNow: [number, number, number] = [0, 0, 0];
  let fovNow = 46;
  const dirV = new THREE.Vector3();

  function placeCamera(): void {
    const m = act.machine;
    const c = finaleCamera(aspect, m.pullProgress, reduced);
    camera.aspect = aspect;
    camera.fov = c.fovDeg;
    camera.near = 0.05;
    camera.far = 400;
    camera.position.set(c.eye[0], c.eye[1], c.eye[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.look[0], c.look[1], c.look[2]);
    camera.updateProjectionMatrix();
    eyeNow = [c.eye[0], c.eye[1], c.eye[2]];
    fovNow = c.fovDeg;
    dirV.set(c.look[0] - c.eye[0], c.look[1] - c.eye[1], c.look[2] - c.eye[2]).normalize();
    pitchDeg = (Math.asin(dirV.y) * 180) / Math.PI;
  }

  /** one fixed step: the machine, then the camera, then everything that rides the camera */
  function step(dt: number): void {
    act.step(dt);
    placeCamera();
    const m = act.machine;
    sky.set(m.liftProgress, m.joinProgress);
    sky.update(dt, m.time);
  }
  // `&sound` (main.ts): a phone has no sound before a touch, so the finale WAITS for the first touch or key press, and then the music box can be heard on `finale:swell`.
  const waitForTouch = params.has('sound') && !frozen;
  let armed = !waitForTouch;
  const kickoff = (): void => {
    if (kicked || !armed) return;
    kicked = true;
    act.start();
    placeCamera();
    sky.set(0, 0);
    sky.update(0, 0);
    if (frozen) {
      const steps = Math.round(Math.max(0, frozenAt) / FIXED);
      for (let i = 0; i < steps; i++) step(FIXED);
    }
  };

  if (waitForTouch) {
    const onGesture = (): void => {
      armed = true;
      kickoff();
    };
    for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, onGesture, { once: true });
  }

  window.__finale = {
    t: () => act.machine.time,
    phase: () => act.machine.phase,
    progress: () => ({ lift: act.machine.liftProgress, join: act.machine.joinProgress, swell: act.machine.auroraSwell, pull: act.machine.pullProgress, whole: act.machine.progress }),
    log: () => act.machine.log.map((e) => ({ type: e.type, at: e.at })),
    busLog: () => [...busLog],
    draws: () => stage.gl.info.render.calls,
    skyDraws: () => sky.drawCalls(),
    message: () => ({ text: message, lines: sky.lines(), fontPx: sky.layout().fontPx, grew: sky.layout().grew }),
    shapeAt: (id) => sky.screenOf(id),
    messageBox: () => sky.messageBox(wNow, hNow),
    aurora: () => auroraGain(act.machine.auroraSwell),
    fade: () => finaleFade(act.machine.pullProgress, reduced),
    camera: () => ({ eye: eyeNow, fov: fovNow, pitchDeg }),
  };

  return {
    bus: act.bus,
    update(dt) {
      kickoff();
      if (frozen) return;
      step(dt);
    },
    render(tSec) {
      kickoff();
      const t = frozen ? frozenAt : tSec;
      const m = act.machine;
      backdrop.aurora.setGain(auroraGain(m.auroraSwell));
      backdrop.update(t, camera);
      ground.update(t, camera);
      cabin.update(t);
      lighting.update(t);
      fade.style.opacity = String(finaleFade(m.pullProgress, reduced));
    },
    resize(a, w, h) {
      aspect = a;
      wNow = w;
      hNow = h;
      backdrop.setPixelRatio(pr());
      ground.setPixelRatio(pr());
      cabin.setPixelRatio(pr());
      sky.setPixelRatio(pr());
      sky.resize(w, h, a);
      placeCamera();
      sky.update(0, act.machine.time);
    },
    setTier(tier) {
      backdrop.setTier(tier);
      ground.setTier(tier);
      cabin.setTier(tier);
      lighting.setTier(tier);
      sky.setTier(tier);
    },
    dispose() {
      act.dispose();
      sky.dispose();
      fade.remove();
      cabin.dispose();
      lighting.dispose();
    },
  };
}
