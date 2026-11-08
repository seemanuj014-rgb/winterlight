import * as THREE from 'three';
import type { Stage } from '../core/renderer';
import { createBackdrop, type Backdrop } from '../world/backdrop';
import { createGround, type Ground } from '../world/ground';
import { createWorldLighting, type Lighting } from '../world/lighting';
import { createCake, type Cake, type CandleLook } from '../world/cake';
import { CAKE_SITE, CAKE_TOP_Y, CANDLE_COUNT, cakeGroundY } from '../world/cakeMath';
import { createEnvelope, type Envelope } from '../world/envelope';
import { HOVER, envelopeCamera } from '../world/envelopeMath';
import { loadContent } from '../content';
import { createProgress } from '../state/progress';
import { createLetterAct, type LetterAct } from './act5_letter';
import type { Bus, WinterEvents } from '../state/events';
import { createLetterFlow, type LetterFlow } from './letterFlow';
import { createEnvelopePick, type EnvelopePick } from './envelopePick';

// Phase 27 test view: `?envelope` = the real envelope picture. A paper lantern drifts down over the cake table (flames out) carrying an envelope on two threads; it hangs there for as long as she
// likes (the machine has no timer); a tap or Enter on the envelope (the Phase 18 picker, `envelopePick.ts`, as the cake) opens it: the flap swings up and over, the letter slides out of the top, and the reader opens on content/letter.md (a placeholder shows as it is). Close puts it away;
// the "read again" button comes back. NO Chamgadad (Phase 28 places her).
// Knobs: `&at=<s>` runs the machine that many seconds first, `&freeze` then stops the clock (a repeatable frame), `&openfor=<s>` opens it and runs that many seconds of the opening, `&opened` goes on to the open envelope with the reader closed, `&delivery=table` is NOT drawn here (the owner
// chose the lantern), `&reduced`, `&nopost`, `&debug&tier=`, `&text=` (made-up text for layout only), `&signoff=a|b`. State: `window.__envelope`.

export interface EnvelopeView {
  /** Phase 28: the letter's events go out here (the card chains on `act:done {5}`) */
  readonly bus: Bus<WinterEvents>;
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

declare global {
  interface Window {
    __envelope?: {
      state(): ReturnType<LetterAct['state']>;
      log(): { type: string; at: number }[];
      pose(): ReturnType<Envelope['pose']>;
      draws(): number;
      /** the envelope's centre on screen (px) */
      screen(): { x: number; y: number };
      isReaderOpen(): boolean;
      open(): boolean;
      /** the picker's view of the envelope (px, canvas space) while it can be opened, else null; and the keyboard stop */
      picked(): { x: number; y: number; radiusPx: number } | null;
      focus(): string | null;
    };
  }
}

export function createEnvelopeView(ctx: { stage: Stage; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean }): EnvelopeView {
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
  const out: CandleLook[] = Array.from({ length: CANDLE_COUNT }, () => ({ state: 'out', flame: 0, dyingFor: 1, outAt: 0, bend: 0 }));
  cake.set(out, 1, 0, 99);

  const topY = cakeGroundY() + CAKE_TOP_Y;
  const envelope: Envelope = createEnvelope({ reducedMotion: ctx.reduced, pixelRatio: pr() });
  envelope.setTable(CAKE_SITE.x, topY, CAKE_SITE.z);
  scene.add(envelope.root);

  let hNow = 780;
  let fovNow = 40;
  const place = (aspect: number): void => {
    const c = envelopeCamera(aspect);
    const hx = CAKE_SITE.x + HOVER[0];
    const hy = topY + HOVER[1];
    const hz = CAKE_SITE.z + HOVER[2];
    camera.aspect = aspect;
    camera.fov = c.fovDeg;
    camera.near = 0.05;
    camera.far = 400;
    camera.position.set(hx + c.eye[0], hy + c.eye[1], hz + c.eye[2]);
    camera.lookAt(hx + c.look[0], hy + c.look[1], hz + c.look[2]);
    camera.updateProjectionMatrix();
    fovNow = c.fovDeg;
    envelope.setView(hNow, fovNow, pr());
  };
  place(Math.max(0.2, (window.innerWidth || 390) / Math.max(1, window.innerHeight || 780)));

  // the ritual: the real machine, the real reader, the real "read again" button
  const content = loadContent().content;
  const fromUrl = params.get('text');
  const text = fromUrl !== null ? fromUrl.replace(/\\n/g, '\n') : content.letter;
  const so = params.get('signoff');
  const credits = so !== null ? { sign_off: so.split('|')[0] ?? '', made_by: so.split('|')[1] ?? '' } : content.credits;
  const progress = createProgress();
  const act: LetterAct = createLetterAct({ delivery: 'lantern', reducedMotion: ctx.reduced, alreadyRead: progress.get().letterRead });
  const flow: LetterFlow = createLetterFlow({
    act,
    letter: text,
    credits,
    reducedMotion: ctx.reduced,
    onRead: () => progress.markLetterRead(),
  });

  // the Phase 18 picker: a tap or click on the envelope opens it (only while it waits), one keyboard stop (Tab, then Enter or Space); nothing here draws
  const pick: EnvelopePick = createEnvelopePick({ camera, canvas: ctx.canvas, envelope, act });
  pick.resize(ctx.canvas.clientWidth || 390, ctx.canvas.clientHeight || 780);

  act.start();
  const at = Number(params.get('at'));
  const FIXED = 1 / 60;
  const frozen = params.has('freeze');
  if (Number.isFinite(at) && at > 0) for (let t = 0; t < at; t += FIXED) act.step(FIXED);
  // `&openfor=<s>`: from the waiting envelope, open it and run that many seconds of the opening (a frame in the middle of the flap or the letter); use with `&at=12&freeze`
  const openFor = Number(params.get('openfor'));
  if (Number.isFinite(openFor) && openFor > 0) {
    for (let i = 0; i < 1200 && !act.machine.canOpen; i++) act.step(FIXED);
    act.open();
    for (let t = 0; t < openFor; t += FIXED) act.step(FIXED);
  }
  if (params.has('opened')) {
    for (let i = 0; i < 1200 && !act.machine.canOpen; i++) act.step(FIXED);
    act.open();
    for (let i = 0; i < 400 && act.machine.phase === 'opening'; i++) act.step(FIXED);
    // the reader opened itself on `letter:open`; `&opened` shows the open envelope instead, so put the letter away (the "read again" button appears)
    act.close();
  }

  const v3 = new THREE.Vector3();
  const screen = (): { x: number; y: number } => {
    envelope.centreWorld(v3);
    v3.project(camera);
    const w = ctx.canvas.clientWidth || 390;
    const h = ctx.canvas.clientHeight || 780;
    return { x: (v3.x * 0.5 + 0.5) * w, y: (1 - (v3.y * 0.5 + 0.5)) * h };
  };
  window.__envelope = {
    state: () => act.state(),
    log: () => act.machine.log.map((e) => ({ type: e.type, at: e.at })),
    pose: () => envelope.pose(),
    draws: () => stage.gl.info.render.calls,
    screen,
    isReaderOpen: () => flow.reader.isOpen,
    open: () => act.open(),
    picked: () => (act.machine.canOpen ? pick.screenOf() : null),
    focus: () => pick.focus(),
  };

  return {
    bus: act.bus,
    update(dt) {
      if (frozen) return; // `&freeze`: a repeatable frame (the machine was already run to `&at=`)
      act.step(dt);
    },
    render(tSec) {
      backdrop.update(tSec, camera);
      ground.update(tSec, camera);
      lighting.update(tSec);
      cake.update(tSec);
      envelope.set(act.machine.arriveProgress, act.machine.openProgress, act.machine.time);
      pick.render();
    },
    resize(aspect, w, h) {
      backdrop.setPixelRatio(pr());
      ground.setPixelRatio(pr());
      hNow = h;
      place(aspect);
      pick.resize(w, h);
      cake.setView(h, fovNow, pr());
    },
    setTier(tier) {
      backdrop.setTier(tier);
      ground.setTier(tier);
      lighting.setTier(tier);
    },
    dispose() {
      flow.dispose();
      act.dispose();
      pick.dispose();
      envelope.dispose();
      cake.dispose();
      lighting.dispose();
    },
  };
}
