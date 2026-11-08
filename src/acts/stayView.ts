import * as THREE from 'three';
import type { Stage } from '../core/renderer';
import { createBackdrop, type Backdrop } from '../world/backdrop';
import { createGround, type Ground } from '../world/ground';
import { createCabin, type Cabin } from '../world/cabin';
import { createWorldLighting, type Lighting } from '../world/lighting';
import { loadContent } from '../content';
import { finaleMessageFor } from './finaleMath';
import { createFinaleSky, type FinaleSky } from './finaleSky';
import { auroraGain } from './finaleSkyMath';
import { createStayAwhileAct, type StayAwhileAct } from './stayAwhile';
import { createFinaleAct, type FinaleAct } from './act6_finale';
import { createLetterAct, type LetterAct } from './act5_letter';
import { createLetterFlow, type LetterFlow } from './letterFlow';
import { createStayControls, type StayControls } from './stayControls';
import { createStayWorld, type StayWorld } from './stayWorld';
import { createStayInput, keyBelongsToSomethingElse } from './stayInput';
import { createStayCast, type StayCast } from './stayCast';
import { castShows } from './stayCastMath';
import { createStayPet, type StayPet } from './stayPet';
import { createSkyText, type SkyText } from '../ui/skyText';
import { replayControls } from '../ui/replayControls';
import { createBus, type Bus, type WinterEvents } from '../state/events';

// Phase 28 test view: `?stay` = the PICTURE of stay a while: the valley exactly as the finale ended (the cabin glowing small, the aurora at its fullest), swaying a very little, turned by
// a drag or the arrow keys (Home recentres), and the five finished shapes coming home from the crown to their patches in the sky (look up to see them). It starts staying at once.
// Driven only by `StayWorld` (`stayWorldMath.ts`): camera, pan and the shapes' home progress. The wishes replay button is here (the Phase 24 button, the Phase 24 wish card).
// The TWO EXITS are here too (session 9): "play the ending again" and "read the letter again" in the Phase 24 replay column, wired through `createStayControls`. The letter and the finale are
// driven silently to their ends before she arrives (she is here AFTER them, as in the card), so the letter button is there from the start. A press of either leaves stay a while for real
// (the letter opens in the real reader with content/letter.md as given; the ending runs its machine and its events) and she comes back. NOT here: the finale's PICTURE during a replay (the
// full card plays it; here the valley just stays), Chamgadad, pets, sound.
// Knobs:
//   &at=<s>      freeze at that many seconds into stay a while (a repeatable frame)
//   &pan=<yaw>,<pitch>   start turned that many degrees (clamped like a hand turn)
//   &reduced, &nopost, &debug&tier=low|mid|high   as on every test view; `&bloom=0..1` the glow gain (default 0.4, set in main.ts)
// State is on `window.__stay`.

export interface StayView {
  readonly bus: Bus<WinterEvents>;
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

declare global {
  interface Window {
    __stay?: {
      t(): number;
      pan(): { yawDeg: number; pitchDeg: number };
      home(): number;
      activity(): string;
      card(): { open: boolean; id: string | null };
      exits(): readonly string[];
      phase(): string;
      finale(): { phase: string; time: number; done: boolean; timesStarted: number };
      letter(): { phase: string; canReadAgain: boolean; timesOpened: number };
      readerOpen(): boolean;
      /** the same two exits as the buttons, for a key or a test that has no button */
      toLetter(): boolean;
      replay(): boolean;
      draws(): number;
      /** which animals are drawn right now (the draw-call plan) */
      pet(): { mode: string; x: number; z: number; pressing: boolean; hopsSeen: number };
      /** where the bunny is on the screen (client px) or null */
      bunnyAt(): { x: number; y: number; radiusPx: number } | null;
      cast(): { chamgadad: boolean; bunny: boolean; ready: boolean };
      skyDraws(): number;
      camera(): { eye: [number, number, number]; look: [number, number, number]; fov: number };
      /** where a shape's first star is on the screen (px), or null when it is off screen */
      shapeAt(id: string): { x: number; y: number } | null;
      messageAlpha(): number;
      /** feed a drag or a key in without a pointer (a frame tool uses these) */
      drag(dxPx: number, dyPx: number): void;
      key(k: string): void;
    };
  }
}

export function createStayView(ctx: { stage: Stage; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean }): StayView {
  const { stage, scene, camera, canvas, params } = ctx;
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

  const cast: StayCast = createStayCast({ aspect: Math.max(0.2, (window.innerWidth || 390) / Math.max(1, window.innerHeight || 780)), scene, tier: stage.tier, reducedMotion: reduced });
  const { content } = loadContent();
  let aspect = Math.max(0.2, (window.innerWidth || 390) / Math.max(1, window.innerHeight || 780));
  let wNow = window.innerWidth || 390;
  const sky: FinaleSky = createFinaleSky({
    scene,
    camera,
    constellations: content.names.constellations,
    message: finaleMessageFor(content.credits), // the owner's string through the one door; it fades as the shapes leave the crown
    tier: stage.tier,
    reducedMotion: reduced,
    pixelRatio: pr(),
    aspect,
  });
  sky.set(1, 1);
  sky.setHome(0);

  // One bus for the whole chain, as in the card: letter put away -> finale -> stay a while; `stay:exit {replay}` -> finale again -> stay a while; the letter's read-again -> back when it is put away.
  const bus = createBus<WinterEvents>();
  const finale: FinaleAct = createFinaleAct({ bus, chainFrom: bus, reducedMotion: reduced });
  const letter: LetterAct = createLetterAct({ bus, delivery: 'lantern', reducedMotion: reduced });
  {
    // She arrives after the letter and the ending: run both to their ends now, silently (nothing is listening yet but the two acts themselves).
    const DT = 0.1;
    letter.start();
    for (let i = 0; i < 400 && !letter.machine.canOpen; i++) letter.step(DT);
    letter.open();
    for (let i = 0; i < 400 && letter.machine.phase === 'opening'; i++) letter.step(DT);
    letter.close(); // `act:done {5}` starts the finale on the shared bus
    for (let i = 0; i < 1000 && !finale.machine.finished; i++) finale.step(DT);
  }
  const stay: StayAwhileAct = createStayAwhileAct({ bus, chainFrom: bus });
  const world: StayWorld = createStayWorld({ stay, reducedMotion: reduced });
  // Re-reading the wishes: all five shapes are finished in stay a while, so the Phase 24 wishes button is shown from the start and shows every wish in the order of names.json (the card queues them).
  // While a card is open the activity is 'wishes' (the world never overrides it); when the last card closes it goes back to what the turn says.
  const nameOf: Record<string, string> = {};
  for (const c of content.names.constellations) nameOf[c.id] = c.name;
  const text: SkyText = createSkyText({
    canvas,
    names: nameOf,
    wishes: content.wishes,
    reducedMotion: reduced,
    onCard: (open) => {
      if (open) {
        stay.setActivity('wishes');
        bus.emit('wish:show', { id: text.current ?? '' }); // the sound ducks under a wish card (the audio engine listens for this; nothing else on this bus reacts)
      } else
        queueMicrotask(() => {
          if (text.open) return;
          bus.emit('wish:hide');
          stay.setActivity('wander');
          world.drag(0, 0, wNow); // the world's own label for where she is looking
        });
    },
  });
  const replay = replayControls();
  replay.add('wishes', () => {
    for (const c of content.names.constellations) text.showWish(c.id);
  });
  const flow: LetterFlow = createLetterFlow({ act: letter, letter: content.letter, credits: content.credits, reducedMotion: reduced, controls: replay });
  flow.controls.setVisible('letter', true); // she has put the letter away once (above), so "read again" is on offer from the start
  const exitControls: StayControls = createStayControls({ stay, letter, controls: replay });
  // petting the bunny (the Phase 20 rules): a press ON her is hers (it does not turn the view); a press anywhere else turns the view as before
  const pet: StayPet = createStayPet({
    cast,
    camera,
    canvas,
    reducedMotion: reduced,
    onActive: (on) => {
      if (on) {
        if (stay.state().activity === 'wander') stay.setActivity('pet');
      } else if (stay.state().activity === 'pet') {
        stay.setActivity('wander');
        world.drag(0, 0, wNow); // the world's own label for where she is looking
      }
    },
  });
  pet.resize(canvas.clientWidth || window.innerWidth || 390, canvas.clientHeight || window.innerHeight || 780);
  const onPetDown = (e: PointerEvent): void => {
    if (!pet.state().pressing) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that is already gone is fine */
    }
  };
  const onPetMove = (e: PointerEvent): void => pet.move(e.clientX, e.clientY);
  const onPetUp = (e: PointerEvent): void => pet.release(e.clientX, e.clientY);
  const input = createStayInput({ stay, world, stage: canvas, keys: window, width: () => wNow, claim: (x, y, k) => pet.claim(x, y, k) });
  // the keyboard's way to pet her: the B key, tapped or held (not when a control, field or dialog has the focus, nor with a modifier)
  const onPetKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'b' && e.key !== 'B') return;
    if (e.repeat || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!stay.machine.staying || keyBelongsToSomethingElse(e.target)) return;
    if (pet.keyDown()) e.preventDefault();
  };
  const onPetKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'b' || e.key === 'B') pet.keyUp();
  };
  window.addEventListener('keydown', onPetKeyDown);
  window.addEventListener('keyup', onPetKeyUp);
  canvas.addEventListener('pointerdown', onPetDown);
  canvas.addEventListener('pointermove', onPetMove);
  canvas.addEventListener('pointerup', onPetUp);
  canvas.addEventListener('pointercancel', onPetUp);
  canvas.style.touchAction = 'none'; // a drag turns the view; it is not a scroll
  stay.enter();
  if (params.has('pan')) {
    const [yaw, pitch] = (params.get('pan') ?? '').split(',').map(Number);
    // the same door a hand uses: a drag scaled so it comes out as that many degrees (clamped by the world, as always)
    const k = wNow / 70;
    world.drag(-(Number.isFinite(yaw) ? yaw! : 0) * k, (Number.isFinite(pitch) ? pitch! : 0) * k, wNow);
  }

  const frozen = params.has('at');
  const frozenAt = Number(params.get('at') ?? 0);
  const FIXED = 1 / 60;
  let eyeNow: [number, number, number] = [0, 0, 0];
  let lookNow: [number, number, number] = [0, 0, 0];
  let fovNow = 46;

  function placeCamera(): void {
    const c = world.camera(aspect);
    camera.aspect = aspect;
    camera.fov = c.fovDeg;
    camera.near = 0.05;
    camera.far = 400;
    camera.position.set(c.eye[0], c.eye[1], c.eye[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.look[0], c.look[1], c.look[2]);
    camera.updateProjectionMatrix();
    eyeNow = [c.eye[0], c.eye[1], c.eye[2]];
    lookNow = [c.look[0], c.look[1], c.look[2]];
    fovNow = c.fovDeg;
  }
  function step(dt: number): void {
    world.update(dt);
    placeCamera();
    sky.setHome(world.state().home);
    applyPlan();
    sky.update(dt, world.state().time);
    stepCast(dt);
  }
  function stepCast(dt: number): void {
    pet.update(dt, castShows(stay.state().activity, world.state().home, 'bunny'));
    cast.update(dt);
  }
  /** the draw-call plan (`stayCastMath.ts`): the animals and the sky are never drawn together */
  function applyPlan(): void {
    const home = world.state().home;
    const activity = stay.state().activity;
    sky.setVisible(castShows(activity, home, 'sky'));
    cast.setLook(activity, home);
  }
  placeCamera();
  applyPlan();
  sky.update(0, 0);
  if (frozen) for (let i = 0, n = Math.round(Math.max(0, frozenAt) / FIXED); i < n; i++) step(FIXED);

  window.__stay = {
    t: () => world.state().time,
    pan: () => world.state().pan,
    home: () => world.state().home,
    activity: () => stay.state().activity,
    card: () => ({ open: text.open, id: text.current }),
    exits: () => stay.state().exits,
    phase: () => stay.state().phase,
    finale: () => finale.state(),
    letter: () => letter.state(),
    readerOpen: () => flow.reader.isOpen,
    toLetter: () => exitControls.toLetter(),
    replay: () => exitControls.replay(),
    draws: () => stage.gl.info.render.calls,
    pet: () => pet.state(),
    bunnyAt: () => pet.screenOf(),
    cast: () => ({ chamgadad: cast.ready() && castShows(stay.state().activity, world.state().home, 'chamgadad'), bunny: castShows(stay.state().activity, world.state().home, 'bunny'), ready: cast.ready() }),
    skyDraws: () => sky.drawCalls(),
    camera: () => ({ eye: eyeNow, look: lookNow, fov: fovNow }),
    shapeAt: (id) => sky.screenOf(id),
    messageAlpha: () => (sky.messageMesh.material as THREE.MeshBasicMaterial).opacity,
    drag: (dx, dy) => {
      world.drag(dx, dy, wNow);
      placeCamera();
      applyPlan();
      sky.update(0, world.state().time);
    },
    key: (k) => {
      world.key(k);
      placeCamera();
      applyPlan();
      sky.update(0, world.state().time);
    },
  };

  return {
    bus,
    update(dt) {
      if (frozen) {
        // a frozen frame stays put, but a hand on the bunny still works
        if (pet.state().pressing || pet.state().mode !== 'idle') stepCast(dt);
        else pet.update(dt, castShows(stay.state().activity, world.state().home, 'bunny'));
        return;
      }
      letter.step(dt);
      finale.step(dt);
      step(dt);
    },
    render(tSec) {
      const t = frozen ? frozenAt : tSec;
      backdrop.aurora.setGain(auroraGain(1)); // the finale ended with the aurora at its fullest and it stays
      backdrop.update(t, camera);
      ground.update(t, camera);
      cabin.update(t);
      lighting.update(t);
      cast.update(0); // her eyes arrive late: show her the frame they do (also on a frozen frame)
    },
    resize(a, w, h) {
      aspect = a;
      cast.setAspect(a);
      pet.rehome();
      pet.resize(w, h);
      wNow = w;
      backdrop.setPixelRatio(pr());
      ground.setPixelRatio(pr());
      cabin.setPixelRatio(pr());
      sky.setPixelRatio(pr());
      sky.resize(w, h, a);
      placeCamera();
      sky.update(0, world.state().time);
    },
    setTier(tier) {
      backdrop.setTier(tier);
      ground.setTier(tier);
      cabin.setTier(tier);
      lighting.setTier(tier);
      sky.setTier(tier);
    },
    dispose() {
      input.dispose();
      window.removeEventListener('keydown', onPetKeyDown);
      window.removeEventListener('keyup', onPetKeyUp);
      canvas.removeEventListener('pointerdown', onPetDown);
      canvas.removeEventListener('pointermove', onPetMove);
      canvas.removeEventListener('pointerup', onPetUp);
      canvas.removeEventListener('pointercancel', onPetUp);
      pet.dispose();
      exitControls.dispose();
      flow.dispose();
      letter.dispose();
      finale.dispose();
      world.dispose();
      stay.dispose();
      text.dispose();
      sky.dispose();
      cast.dispose();
      cabin.dispose();
      lighting.dispose();
    },
  };
}
