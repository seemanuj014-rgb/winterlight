import './ui/theme.css';
import * as THREE from 'three';
import { createStage } from './core/renderer';
import { createLoop, FIXED_DT } from './core/loop';
import { PowerGovernor } from './core/power';
import { showInAppNote } from './ui/fallback';
import silhouetteJson from '../character/traced/chamgadad_ref_01_head_front.silhouette.json';
import type { Silhouette } from './core/silhouette';
import { setToonViewport } from './render/toon/outline';
import { buildToonRig } from './render/toon/rig';
import { createChamgadadHead, createHeadKeyLight, type ChamgadadHead } from './character/chamgadad/head';
import { createReferenceCamera, fitReferenceCamera } from './character/refCamera';
import { createFace, type Face } from './character/chamgadad/face';
import { GAZE_TARGETS, type GazeName } from './character/chamgadad/gaze';
import { createEarDriver, type EarDriver } from './character/chamgadad/earMotion';
import type { EarName } from './character/chamgadad/earSpring';
import { createChamgadad, type Chamgadad } from './character/chamgadad/body';
import { createStethoscope, createPartyHat } from './character/chamgadad/accessories';
import type { PoseName } from './character/chamgadad/pose';
import { createRig, type Rig } from './character/chamgadad/rig';
import { STATE_NAMES, type StateName } from './character/chamgadad/states';
import { createBackdrop, placeBackdropCamera, type Backdrop } from './world/backdrop';
import { createGround, type Ground } from './world/ground';
import { createCabin, type Cabin } from './world/cabin';
import { createNook, type Nook } from './world/nook';
import { createDoorProps, type DoorProps } from './world/props';
import { createCat, type Cat } from './character/cat/cat';
import { createBunny, type Bunny } from './character/bunny/bunny';
import { CAT_STATE_NAMES } from './character/cat/states';
import { BUNNY_STATE_NAMES } from './character/bunny/states';
import { CABIN_SITE, terrainHeight } from './world/groundMath';
import { NOOK } from './world/cabinMath';
import { createStudio, fitStudioCamera, type Studio } from './companionView';
import { createWorldLighting, createNookLighting, type Lighting } from './world/lighting';
import { adoptBootScreen } from './ui/boot';
import { createTour, type Tour } from './tourView';
import { createInputView, type InputView } from './inputView';
import { createActs, type Acts } from './acts';
import { createPet, type Pet } from './interaction/pet';
import { createStarsView, type StarsView } from './starsView';
import { createSkyView, type SkyView } from './skyView';
import { createCakeView, type CakeView } from './acts/cakeView';
import { createReleaseView, type ReleaseView } from './acts/releaseView';
import { createLetterView } from './acts/letterView';
import { createEnvelopeView, type EnvelopeView } from './acts/envelopeView';
import { createFinaleView, type FinaleView } from './acts/finaleView';
import { createStayView, type StayView } from './acts/stayView';
import { createCardView, type CardView } from './acts/cardView';
import { createAudioView } from './audioView';
import { createAudioEngine, createMuteButton, replayMusicBox, type AudioEngine } from './audio';
import { replayControls } from './ui/replayControls';
import { events } from './state/events';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Phase 17: the loading screen is already on the page (index.html); this takes it over. No WebGL at all is a plain-words screen, not a blank page.
const splash = adoptBootScreen({ reducedMotion: reduced });
let stage: ReturnType<typeof createStage>;
try {
  stage = createStage({ canvas, reducedMotion: reduced });
} catch (e) {
  splash.fail('webgl');
  throw e;
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1b2e);
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 6);

const params = new URLSearchParams(window.location.search);
// The plain link (no `?...` at all) is the real card, with sound. Every `?view` below is still a test view.
if (window.location.search === '') {
  params.set('card', '');
  params.set('sound', '');
}
const rigParam = params.get('rig'); // null = off, '' = grid, 'big' = large three only
// Phase 6 test view: `?head` = the 3D head through the reference camera (her drawing's framing); `?head=3q|side|back` turns it;
// `&yaw=<deg>` and `&pitch=<deg>` override; `&bg=white|light` for a paper background. Without `?head` nothing here runs.
// Phase 7 test view: `?face` = the same, with eyes and brows (`?face=3q|side|back` turns it). `&gaze=center|up|down|left|right` or `&gx=&gy=` (-1..1)
// looks somewhere, `&blink=0..1` holds a blink, `&still` stops the automatic blinks. Without `?face` nothing here runs.
// Phase 8 test view: `?ears` = the `?face` view plus ear motion. `&flick=upright|angled|both` flicks at the start; `&drive=roll|yaw|pitch|slide`
// swings the head so the ears follow through; `&sway` forces the low-tier sine sway; `&still` also stops automatic flicks and idle sway;
// `&scrub=<seconds>` runs that much fixed-step time and then freezes (a repeatable frame for screenshots). Without `?ears` nothing here runs.
// Phase 9 test view: `?body` = the whole Chamgadad (head, eyes, body, arms, legs, tail) seen by a normal camera. `&pose=sit|curl`, `&yaw=` and `&pitch=` (degrees)
// walk round it (`?body=3q|side|back|top` are shortcuts), `&hat` and `&steth` switch the two accessories ON (both are off by default), `&bg=white|light`.
// Without `?body` nothing here runs; `?head`, `?face` and `?ears` are unchanged.
// Phase 10 test view: `?behave` = the whole Chamgadad moving by the behaviour state machine (rig.ts), seen like `?body` (`&view=3q|side|back|top`,
// `&yaw=`, `&pitch=`, `&bg=`). `&state=<name>` or `&seq=hop@0.5,sleep@4` ask for states at those seconds (rest, breathe, sleep, wake, sitLookUp,
// findFinger, curiousLean, hop, wave); `&gesture=slowBlink@1` or `earFlick@1` the face gestures; `&pointer=x,y` is her finger (-1..1); `&side=-1|1` the lean;
// `&at=<seconds>` runs that much fixed-step time and freezes (a repeatable frame); `&fit` centres the figure in the pose it froze in;
// `&reduced` is reduced motion; `&still` stops the automatic blinks and ear flicks; `&hat` `&steth` as in `?body`. Nothing here runs without `?behave`;
// `?body`, `?head`, `?face`, `?ears` and the default page are unchanged.
// Phase 11 test view (gate G0): `?body=ref` or `?behave&view=ref` (add `&bg=white&still`) = the whole figure through the reference camera, exactly
// her drawing's framing, for `tools/fidelity.py --whole`. `&yaw=` or `&pitch=` turn it back into the normal centred view.
// Phase 12 test view: `?world` = the night backdrop (sky, stars, moon, aurora, four mountain layers) seen from eye height, no Chamgadad.
// `&at=<seconds>` freezes the sky at that time (a repeatable frame); `&yaw=<deg>` and `&pitch=<deg>` look around; `&reduced` is reduced motion
// (no twinkle, no drift, a frozen aurora, fewer stars); `&debug&tier=low|mid|high` as everywhere. Nothing here runs without `?world`.
// Phase 13 adds the snow ground, the snowfall and the pines to `?world` (`&noground` shows the Phase 12 backdrop alone; `&at=` freezes the snow and the
// glitter too; `&reduced` halves the flakes and stops the sway). With `&debug`, the instance counts for the tier are printed to the console.
// Phase 17 test view: `?tour` = the whole scene (nook, cabin, snow, Chamgadad, the cat, the bunny) with the camera director walking through it, after the boot screen has run the real build.
// `&shot=<name>` plays one shot, `&at=<seconds>` freezes that far into it (frame sequences), `&from=<name>` starts the tour at a shot, `&reduced`, `&nopost`, `&debug&tier=`; see `tourView.ts`.
// Phase 18 test view: `?input` = a few plain balls wired to the whole input layer (tap, hold, drag, multi-touch, keyboard, tilt, buzz) with the events printed on the page and kept in
// `window.__inputLog`; see `inputView.ts`. `&reduced` turns the parallax off. Nothing here runs without `?input`.
const inputParam = params.has('input');
let inputView: InputView | null = null;
// Phase 19 test view: `?acts` = the same world as `?tour`, but the viewer plays Acts 1 and 2: hold (or tap, or hold Enter after Tab) to wake Chamgadad, wait to find "let her sleep", then she
// hops to the door and the camera is pushed out into the snow (see `src/acts/`). Test knobs: `&hold=3-7,20-22` and `&tap=9,10` script a viewer (seconds), `&pointer=0.4,0.2` her finger (-1..1),
// `&at=<s>` runs that much fixed-step time and freezes; `&reduced`, `&nopost`, `&debug&tier=` as in `?tour`. State: `window.__acts.state()` and `.log()`. Nothing here runs without `?acts`.
const actsParam = params.has('acts');
let acts: Acts | null = null;
// Phase 20 test view: `?pet` = the nook close on Chamgadad and the cat, `?pet=bunny` = the stage close on Chamgadad and the snow bunny. Drag over the cat (or hold a hand on her) to pet her; hold a
// finger on the snow near the bunny and she hops toward it, tap on or near her and she runs off to hide (see `src/interaction/`). Keyboard: Tab to the animal, then Enter / Space (and the arrows
// while held). Test knobs: `&stroke=3-9`, `&rest=3-9`, `&tapcat=4`, `&finger=2-9@x:z`, `&tapat=6@x:z` script a viewer (seconds; x:z are world metres), `&catstate=sleep`, `&at=<s>` runs that much
// fixed-step time and freezes; `&reduced`, `&nopost`, `&debug&tier=` as in `?tour`. State: `window.__pet.state()` and `.log()`. Nothing here runs without `?pet`.
const petParam = params.has('pet');
let pet: Pet | null = null;
// Phase 21 test view: `?stars` = the night sky with one plain demo constellation (`?stars=path` is the ordered one) wired to the constellation engine and the input layer: drag from a star to the
// next, or tap one then its neighbour (Tab + Enter works too); the line draws like frost and a finished shape bursts softly. Test knobs: `&pre=<n>`, `&drag=<star>@<x>,<y>`, `&at=<s>` (8+ s = the hint),
// `&reduced`, `&nopost`, `&debug&tier=`; see `starsView.ts`. State: `window.__stars`. Nothing here runs without `?stars`.
const starsParam = params.has('stars');
let starsView: StarsView | null = null;
// Phase 22 test view: `?sky` = the night sky with the five names as five shapes to connect, each opening its wish card (text from content/wishes.json); finished shapes are saved and come back finished.
// Test knobs: `&done=<id,id>`, `&fresh`, `&pre=<id>:<n>`, `&drag=`, `&at=<s>`, `&reduced`, `&nopost`, `&nohud`, `&debug&tier=`; see `skyView.ts`. State: `window.__sky`. Nothing here runs without `?sky`.
const skyParam = params.has('sky');
// Phase 25 test view: `?cake` = the snow-table, the cake and five candles under the night sky (no Chamgadad). Knobs `&at=<s>`, `&blow=a-b`, `&tap=<s>[:n]`, `&reduced`, `&nopost`, `&nohud`, `&debug&tier=`; see `acts/cakeView.ts`. State: `window.__cake`.
const cakeParam = params.has('cake');
let cakeView: CakeView | null = null;
// Phase 26 test view: `?release` = the beat after the candles: a hush, a snow-glitter burst, paper lanterns rising into the aurora (no Chamgadad). Knobs `&at=<s>`, `&reduced`, `&nopost`, `&debug&tier=`; see `acts/releaseView.ts`. State: `window.__release`.
const releaseParam = params.has('release');
let releaseView: ReleaseView | null = null;
// Phase 27 test view: `?envelope` = the real envelope picture: a lantern drifts down over the cake table carrying an envelope, it waits, a tap opens it, the reader opens on content/letter.md. Knobs `&at=<s>`, `&opened`, `&reduced`, `&nopost`, `&debug&tier=`; see `acts/envelopeView.ts`. State: `window.__envelope`.
const envelopeParam = params.has('envelope');
let envelopeView: EnvelopeView | null = null;
// Phase 28 test view: `?finale` = the pictures of the finale: the five finished shapes lift and join into a crown over the owner's message, the aurora swells, the camera pulls back through the pines to the cabin. Knobs `&at=<s>`, `&text=`, `&long`, `&reduced`, `&nopost`, `&debug&tier=`; see `acts/finaleView.ts`. State: `window.__finale`.
const finaleParam = params.has('finale');
let finaleView: FinaleView | null = null;
// Phase 28 test view: `?stay` = the picture of stay a while (the valley as the finale ended, a slow sway, a drag or the arrow keys turn the view, the five shapes come home to their patches). Knobs `&at=<s>`, `&pan=<yaw>,<pitch>`, `&reduced`, `&nopost`, `&debug&tier=`; see `acts/stayView.ts`. State: `window.__stay`.
const stayParam = params.has('stay');
let stayView: StayView | null = null;
// Phase 28 `?card`: the whole card in order, one stage at a time (`acts/cardView.ts`, rules in `cardMath.ts`; `&from=<stage>` starts mid-way).
const cardParam = params.has('card');
let cardView: CardView | null = null;
let skyView: SkyView | null = null;
// Phase 23 test view: `?audio` = a plain page with a button for every sound (stars, finished phrase, wish card and letter ducking, a step in snow, the purr, the two moods of the beds, the music-box
// "Happy Birthday") and the always-visible mute button; nothing sounds until the first tap. `&reduced` calms the beds; see `audioView.ts`. State and the offline renderer: `window.__audio`.
// On the older test views (`?stars`, `?sky`, `?acts`, `?pet`) sound is opt-in with `&sound` (the mute button appears, the card's own events make the sounds); Phase 28 turns it on for the card itself.
const audioParam = params.has('audio');
// Phase 24 test view: `?letter` = the letter reader open on content/letter.md (`&text=` for a made-up layout test, `&reduced`); see `acts/letterView.ts`; Phase 27: `&ritual` runs the whole letter ritual with a test stand-in envelope. Nothing here runs without `?letter`.
const letterParam = params.has('letter');
let audio: AudioEngine | null = null;
const tourParam = params.has('tour') || actsParam || petParam;
let tour: Tour | null = null;
const worldParam = params.get('world');
const behaveParam = params.get('behave');
const bodyParam = params.get('body') ?? (behaveParam !== null ? (params.get('view') ?? '') : null);
const earsParam = params.get('ears');
const faceParam = params.get('face') ?? earsParam;
const headParam = params.get('head') ?? faceParam;
let face: Face | null = null;
let ears: EarDriver | null = null;
let driver: THREE.Group | null = null;
let frozen = false;
let head: ChamgadadHead | null = null;
let refCam: THREE.OrthographicCamera | null = null;
let turn: THREE.Group | null = null;
let rig: ReturnType<typeof buildToonRig> | null = null;
let whole: Chamgadad | null = null;
let actor: Rig | null = null;
let holder: THREE.Group | null = null;
const requests: { at: number; what: string; kind: 'state' | 'gesture' }[] = [];
let flat: THREE.Mesh | null = null;
let camDist = 6.4;
let backdrop: Backdrop | null = null;
let ground: Ground | null = null;
let cabin: Cabin | null = null;
let nook: Nook | null = null;
let doorProps: DoorProps | null = null;
let lighting: Lighting | null = null;
let studio: Studio | null = null;
// Phase 16 world placements: `?nook&cat` puts the cat on the blanket, `?world&cabin&bunny` puts the snow bunny in the snow beside the cabin (behind a low bank). `&state=<name>` and `&at=` as in `?cat` / `?bunny`.
let worldCat: Cat | null = null;
let worldBunny: Bunny | null = null;
// Phase 15: the world views (`?world`, `?nook`) get the lighting rig (moon key, cool fill, warm point lights) and, on the mid and high tiers, the post pass (bloom, and the grade on high).
// `&nopost` draws them without the post pass (to compare); `&debug` shows the post line. The lighting rig and the post pass are never built for Chamgadad's own views.
// Phase 14 test views: `?world&cabin` adds the cabin on its clearing (the view turns toward it unless `&yaw=` is given); `&door=0..1` opens the door; `&turn=<deg>` turns the cabin to see its sides; `&plaque=<text>` and
// `&sign=<text>` switch the two optional door props on with that text (they are off, and have no words, without these); `?nook` = the sleepy nook alone, from the open
// side (`&door=0..1` opens its door, `&lamp=0..1`). `&at=` freezes smoke, steam and light; `&reduced`, `&debug&tier=` as everywhere.
if (params.has('sound') && !audioParam) {
  audio = createAudioEngine({ reducedMotion: reduced || params.has('reduced'), musicUrl: params.has('nomusic') ? undefined : `${import.meta.env.BASE_URL}audio/bgm.mp3` });
  createMuteButton(audio);
  if (starsParam || skyParam) audio.listen(events);
  // Phase 24: the music-box replay button (the wishes one is added by the sky view); the same column under the sound button
  if (skyParam) {
    const eng = audio;
    replayControls().add('music', () => void replayMusicBox(eng));
  }
}
const worldYaw = params.has('yaw') ? Number(params.get('yaw')) : params.has('cabin') ? 22 : 0;

if (inputParam) {
  inputView = createInputView({ stage, scene, camera, canvas, reduced: reduced || params.has('reduced') });
} else if (letterParam) {
  createLetterView({ params, reduced: reduced || params.has('reduced') });
} else if (audioParam) {
  createAudioView({ reduced: reduced || params.has('reduced') });
} else if (starsParam) {
  starsView = createStarsView({ stage, scene, camera, canvas, params, reduced: reduced || params.has('reduced') });
  stage.setPost(!params.has('nopost'));
} else if (cakeParam) {
  cakeView = createCakeView({ stage, scene, camera, canvas, params, reduced: reduced || params.has('reduced') });
  stage.setPost(!params.has('nopost'));
} else if (cardParam) {
  cardView = createCardView({ stage, scene, camera, canvas, params, reduced: reduced || params.has('reduced'), onBus: (b) => audio?.listen(b) });
} else if (finaleParam) {
  finaleView = createFinaleView({ stage, scene, camera, canvas, params, reduced: reduced || params.has('reduced') });
  audio?.listen(finaleView.bus);
  stage.setPost(!params.has('nopost'));
  stage.setBloomGain(params.has('bloom') ? Number(params.get('bloom')) : 0.4);
} else if (stayParam) {
  stayView = createStayView({ stage, scene, camera, canvas, params, reduced: reduced || params.has('reduced') });
  audio?.listen(stayView.bus);
  stage.setPost(!params.has('nopost'));
  stage.setBloomGain(params.has('bloom') ? Number(params.get('bloom')) : 0.4);
} else if (envelopeParam) {
  envelopeView = createEnvelopeView({ stage, scene, camera, canvas, params, reduced: reduced || params.has('reduced') });
  stage.setPost(!params.has('nopost'));
  stage.setBloomGain(params.has('bloom') ? Number(params.get('bloom')) : 0.4); // same glow gain as the release: a lantern washes to white at full gain `[A]`
} else if (releaseParam) {
  releaseView = createReleaseView({ stage, scene, camera, canvas, params, reduced: reduced || params.has('reduced') });
  // Phase 26: under `&sound` the card's own events make the hush and the swell (the view waits for the first touch so the phone's audio is unlocked)
  audio?.listen(releaseView.bus);
  stage.setPost(!params.has('nopost'));
  stage.setBloomGain(params.has('bloom') ? Number(params.get('bloom')) : 0.4); // Phase 26: at full gain the lanterns on mid and high wash to white `[A]`; 0.4 keeps their shape (`&bloom=0..1` to tune)
} else if (skyParam) {
  skyView = createSkyView({ stage, scene, camera, canvas, params, reduced: reduced || params.has('reduced') });
  stage.setPost(!params.has('nopost'));
} else if (tourParam) {
  scene.background = new THREE.Color(0x0d1b2e);
  tour = createTour({ stage, scene, camera, params, reduced });
} else if (worldParam !== null) {
  const isReduced = reduced || params.has('reduced');
  backdrop = createBackdrop({ tier: stage.tier, reducedMotion: isReduced, pixelRatio: Math.min(window.devicePixelRatio || 1, stage.settings.maxPixelRatio) });
  scene.add(backdrop.root);
  scene.background = new THREE.Color(0x0d1b2e);
  if (!params.has('noground')) {
    ground = createGround({ tier: stage.tier, reducedMotion: isReduced, pixelRatio: Math.min(window.devicePixelRatio || 1, stage.settings.maxPixelRatio) });
    scene.add(ground.root);
    if (params.has('debug')) console.log('[world] ground', stage.tier, JSON.stringify(ground.stats()));
  }
  if (params.has('cabin')) {
    cabin = createCabin({ tier: stage.tier, reducedMotion: isReduced, pixelRatio: Math.min(window.devicePixelRatio || 1, stage.settings.maxPixelRatio) });
    scene.add(cabin.root);
    cabin.setDoorOpen(Number(params.get('door') ?? 0));
    if (params.has('turn')) cabin.root.rotation.y += (Number(params.get('turn')) * Math.PI) / 180; // test only: walk round it (the gable ends, the back)
    if (params.has('plaque') || params.has('sign')) {
      doorProps = createDoorProps(cabin.door, { plaque: params.get('plaque') ?? undefined, sign: params.get('sign') ?? undefined });
      doorProps.setVisible('plaque', true);
      doorProps.setVisible('sign', true);
    }
    if (params.has('debug')) console.log('[world] cabin', stage.tier, JSON.stringify(cabin.stats()));
  }
  // Phase 15: a cool moon key from where the sky's moon stands, a cool fill, and (with the cabin) warm point lights at its lantern and windows
  lighting = createWorldLighting({ tier: stage.tier, reducedMotion: isReduced, cabinRoot: cabin?.root ?? null });
  scene.add(lighting.root);
  if (params.has('debug')) console.log('[world] lights', stage.tier, JSON.stringify(lighting.stats()));
  if (params.has('bunny')) {
    // in the snow between the camera and the cabin, a little off the door's line (close enough to be read); the bank is plain snow-coloured (a test stand-in until the world has its own)
    const facing = Math.atan2(-CABIN_SITE.x, -CABIN_SITE.z);
    const bx = CABIN_SITE.x * 0.45 + Math.cos(facing) * 0.8;
    const bz = CABIN_SITE.z * 0.45 - Math.sin(facing) * 0.8;
    worldBunny = createBunny({ reducedMotion: isReduced });
    worldBunny.root.position.set(bx, terrainHeight(bx, bz), bz);
    worldBunny.root.rotation.y = facing + 0.3;
    const st = params.get('state');
    if (st && (BUNNY_STATE_NAMES as readonly string[]).includes(st)) worldBunny.behaviour.request(st as never);
    scene.add(worldBunny.root);
    // a low bank of snow in front of her, so `hide` and `peek` can be seen (a test stand-in; plain snow colour, no ink line, like the snow around it)
    const bank = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshToonMaterial({ color: '#dfe9f2' }));
    bank.scale.set(0.5, 0.16, 0.22);
    bank.position.set(bx + Math.sin(facing + 0.3) * 0.21, terrainHeight(bx, bz), bz + Math.cos(facing + 0.3) * 0.21);
    bank.rotation.y = facing + 0.3;
    scene.add(bank);
    if (params.has('debug')) console.log('[world] bunny', JSON.stringify(worldBunny.stats()));
  }
  stage.setPost(!params.has('nopost'));
} else if (params.has('nook')) {
  const isReduced = reduced || params.has('reduced');
  scene.background = new THREE.Color(0x0d1b2e);
  nook = createNook({ tier: stage.tier, reducedMotion: isReduced, pixelRatio: Math.min(window.devicePixelRatio || 1, stage.settings.maxPixelRatio) });
  scene.add(nook.root);
  nook.setDoorOpen(Number(params.get('door') ?? 0));
  lighting = createNookLighting({ tier: stage.tier, reducedMotion: isReduced, nookRoot: nook.root });
  scene.add(lighting.root);
  if (params.has('lamp')) {
    nook.setLamp(Number(params.get('lamp')));
    lighting.setLamp(Number(params.get('lamp')));
  }
  if (params.has('cat')) {
    // on the blanket's lump (its top there is 0.73; the cat's belly sits a hair into it; `NOOK.catSpot` is left as Phase 14 set it, it is at the very edge of the blanket)
    worldCat = createCat({ reducedMotion: isReduced });
    worldCat.root.position.set(NOOK.bed.x + 0.46, 0.765, NOOK.bed.z).add(nook.root.position);
    worldCat.root.rotation.y = 0.35;
    const st = params.get('state');
    if (st && (CAT_STATE_NAMES as readonly string[]).includes(st)) worldCat.behaviour.request(st as never);
    scene.add(worldCat.root);
    if (params.has('debug')) console.log('[world] cat', JSON.stringify(worldCat.stats()));
  }
  if (params.has('debug')) console.log('[world] nook lights', stage.tier, JSON.stringify(lighting.stats()));
  stage.setPost(!params.has('nopost'));
  stage.setBloomGain(params.has('bloom') ? Number(params.get('bloom')) : 0.3); // a small lit room needs far less glow than a wide night (`&bloom=` to tune)
  if (params.has('debug')) console.log('[world] nook', stage.tier, JSON.stringify(nook.stats()));
} else if (params.has('cat') || params.has('bunny')) {
  // Phase 16 test view: `?cat` / `?bunny` = the animal alone in a small studio (see `companionView.ts` for the parameters)
  const bg = params.get('bg');
  scene.background = new THREE.Color(bg === 'white' ? 0xffffff : bg === 'light' ? 0xf4f3ee : bg === 'snow' ? 0xe8f1f8 : 0x0d1b2e);
  studio = createStudio(params.has('cat') ? 'cat' : 'bunny', params, { reduced });
  scene.add(studio.group, ...studio.lights);
  if (params.has('at')) {
    studio.run(Number(params.get('at')));
    frozen = true;
  }
} else if (rigParam !== null) {
  // Phase 3 toon test rig. `&bg=light` puts it on paper white, like her drawing.
  scene.background = new THREE.Color(params.get('bg') === 'light' ? 0xf4f3ee : 0x0d1b2e);
  rig = buildToonRig(rigParam === 'big' ? 'big' : 'grid');
  scene.add(rig.group);
} else if (bodyParam !== null) {
  const bg = params.get('bg');
  scene.background = new THREE.Color(bg === 'white' ? 0xffffff : bg === 'light' ? 0xf4f3ee : 0x0d1b2e);
  whole = createChamgadad();
  if (behaveParam !== null) {
    const isReduced = reduced || params.has('reduced');
    actor = createRig(whole, { reducedMotion: isReduced });
    face = actor.face;
    if (params.has('still')) {
      actor.face.blinker.auto = false;
      actor.ears.motion.auto = false;
    }
    if (params.has('side')) actor.behaviour.request('rest', { side: Number(params.get('side')) < 0 ? -1 : 1 });
    const st = params.get('state');
    if (st) requests.push({ at: 0, what: st, kind: 'state' });
    for (const item of (params.get('seq') ?? '').split(',').filter(Boolean)) {
      const [name, at] = item.split('@');
      requests.push({ at: Number(at ?? 0), what: name!, kind: 'state' });
    }
    for (const item of (params.get('gesture') ?? '').split(',').filter(Boolean)) {
      const [name, at] = item.split('@');
      requests.push({ at: Number(at ?? 0), what: name!, kind: 'gesture' });
    }
    requests.sort((a, b) => a.at - b.at);
    const pt = params.get('pointer');
    if (pt) {
      const [px, py] = pt.split(',').map(Number);
      actor.behaviour.setPointer(px ?? 0, py ?? 0);
    }
    actor.update(0);
  } else {
    face = createFace(whole.head, { reducedMotion: true });
    face.snapGaze();
    const pose: PoseName = params.get('pose') === 'curl' ? 'curl' : 'sit';
    whole.applyPose(pose);
  }
  if (params.has('hat')) createPartyHat(whole).setVisible(true);
  if (params.has('steth')) createStethoscope(whole).setVisible(true);
  const view = bodyParam;
  const defaultYaw = view === '3q' ? 38 : view === 'side' ? 90 : view === 'back' ? 180 : 0;
  const yaw = params.has('yaw') ? Number(params.get('yaw')) : defaultYaw;
  const pitch = params.has('pitch') ? Number(params.get('pitch')) : view === 'top' ? 70 : 0;
  turn = new THREE.Group();
  holder = new THREE.Group();
  if (view === 'ref' && !params.has('yaw') && !params.has('pitch')) {
    // Phase 11 (gate G0): the whole figure through the reference camera, her drawing's own framing, no centring, no turn
    refCam = createReferenceCamera(1);
  } else {
    // the middle of the whole figure (its bounding box, in the pose it is in), so it turns in place and stays in frame
    // (a holder group carries the offset: the pose drives `whole.group` itself, so the offset must not live on it)
    whole.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(whole.group);
    const mid = box.getCenter(new THREE.Vector3());
    holder.position.sub(mid);
  }
  holder.add(whole.group);
  turn.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, 'YXZ');
  turn.add(holder);
  scene.add(turn, createHeadKeyLight());
  camera.position.set(0, 0, 13);
} else if (headParam !== null) {
  const bg = params.get('bg');
  scene.background = new THREE.Color(bg === 'white' ? 0xffffff : bg === 'light' ? 0xf4f3ee : 0x0d1b2e);
  head = createChamgadadHead();
  turn = new THREE.Group();
  const view = headParam === '' ? 'ref' : headParam;
  const defaultYaw = view === '3q' ? 35 : view === 'side' ? 90 : view === 'back' ? 180 : 0;
  const yaw = params.has('yaw') ? Number(params.get('yaw')) : defaultYaw;
  const pitch = params.has('pitch') ? Number(params.get('pitch')) : 0;
  if (view === 'ref' && !params.has('yaw')) {
    refCam = createReferenceCamera(1); // exactly her framing; no centring, no turn
  } else {
    // turn about the middle of the head so it stays in frame
    head.group.position.set(-head.built.head.centre[0], -head.built.head.centre[1], -head.built.head.frontZMax / 2);
  }
  if (faceParam !== null) {
    face = createFace(head, { reducedMotion: reduced || params.has('still') });
    const g = params.get('gaze');
    if (g && g in GAZE_TARGETS) face.lookAt(g as GazeName);
    else if (params.has('gx') || params.has('gy')) face.lookAt([Number(params.get('gx') ?? 0), Number(params.get('gy') ?? 0)]);
    if (params.has('blink')) face.holdBlink(Number(params.get('blink')));
    face.snapGaze();
  }
  if (earsParam !== null) {
    ears = createEarDriver(head, { reducedMotion: reduced || params.has('still'), mode: params.has('sway') ? 'sway' : 'spring' });
    const f = params.get('flick');
    if (f === 'upright' || f === 'angled' || f === 'both') ears.flick(f as EarName | 'both');
    // a pivot group at the middle of the head, so a driven roll, turn or nod happens about the head and stays in frame
    const c = head.group.position.clone().add(new THREE.Vector3(head.built.head.centre[0], head.built.head.centre[1], 0));
    driver = new THREE.Group();
    driver.position.copy(c);
    head.group.position.sub(c);
    driver.add(head.group);
    ears.resync();
  }
  turn.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0);
  turn.add(driver ?? head.group);
  scene.add(turn, createHeadKeyLight());
} else {
  const sil = silhouetteJson as unknown as Silhouette;
  const shape = new THREE.Shape();
  sil.points.forEach(([x, y], i) => {
    const px = (x - 0.5) * 4;
    const py = (0.5 - y) * 4;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  });
  flat = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xa7b9c3, side: THREE.DoubleSide }));
  scene.add(flat);
}

stage.onResize(({ aspect, width, height, pixelRatio }) => {
  setToonViewport(height * pixelRatio);
  if (inputView) {
    inputView.resize(aspect, width, height);
    return;
  }
  if (starsView) {
    starsView.resize(aspect, width, height);
    return;
  }
  if (skyView) {
    skyView.resize(aspect, width, height);
    return;
  }
  if (cakeView) {
    cakeView.resize(aspect, width, height);
    return;
  }
  if (releaseView) {
    releaseView.resize(aspect, width, height);
    return;
  }
  if (envelopeView) {
    envelopeView.resize(aspect, width, height);
    return;
  }
  if (finaleView) {
    finaleView.resize(aspect, width, height);
    return;
  }
  if (cardView) {
    cardView.resize(aspect, width, height);
    return;
  }
  if (stayView) {
    stayView.resize(aspect, width, height);
    return;
  }
  if (tour) {
    tour.resize(aspect);
    acts?.resize(width, height);
    pet?.resize(width, height);
    return;
  }
  if (backdrop) {
    backdrop.setPixelRatio(pixelRatio);
    cabin?.setPixelRatio(pixelRatio);
    ground?.setPixelRatio(pixelRatio);
    placeBackdropCamera(camera, aspect, worldYaw, Number(params.get('pitch') ?? 0));
    return;
  }
  if (nook) {
    nook.setPixelRatio(pixelRatio);
    camera.aspect = aspect;
    camera.fov = 42;
    camera.near = 0.1;
    camera.far = 80;
    // from the open side of the room; a tall phone steps back so the whole bed and the window stay in frame
    const back = 5.5 / Math.min(1, aspect / 0.95);
    camera.position.set(0.1, 1.35, back).add(nook.root.position);
    camera.lookAt(new THREE.Vector3(-0.05, 0.95, -1.2).add(nook.root.position));
    camera.updateProjectionMatrix();
    return;
  }
  if (studio) {
    fitStudioCamera(camera, studio, aspect);
    return;
  }
  if (refCam) fitReferenceCamera(refCam, aspect);
  camera.aspect = aspect;
  camDist = rig ? rig.layout(aspect, camera.fov) : whole ? (aspect < 1 ? 13 / aspect : 13) : aspect < 1 ? 6.4 / aspect : 6.4;
  camera.position.z = camDist;
  camera.updateProjectionMatrix();
});

const boot = document.getElementById('boot');
if (boot) boot.textContent = rig || head || whole || backdrop || nook || studio || tour || inputView || starsView || skyView || cakeView || releaseView || envelopeView || finaleView || stayView || cardView || letterParam ? '' : 'Phase 0 starter: unlocked';
// Same slow turn as Phase 0 (sin(t/1500 ms) * 0.5), now driven by the fixed-step clock.
let simSec = 0;
const driveMode = params.get('drive');
function advance(dt: number): void {
  simSec += dt;
  if (driver && driveMode) {
    const w = Math.sin(simSec * 2 * Math.PI * 0.8); // 0.8 swings a second, a lively head turn
    driver.rotation.set(driveMode === 'pitch' ? w * 0.25 : 0, driveMode === 'yaw' ? w * 0.5 : 0, driveMode === 'roll' ? w * 0.2 : 0);
    driver.position.x = (driveMode === 'slide' ? w * 0.25 : 0) + (driver.userData.baseX ??= driver.position.x);
  }
  if (actor) {
    while (requests.length && requests[0]!.at <= simSec) {
      const r = requests.shift()!;
      if (r.kind === 'state' && (STATE_NAMES as readonly string[]).includes(r.what)) {
        actor.behaviour.request(r.what as StateName, params.has('side') ? { side: Number(params.get('side')) < 0 ? -1 : 1 } : {});
      } else if (r.kind === 'gesture' && (r.what === 'slowBlink' || r.what === 'earFlick')) actor.behaviour.gesture(r.what);
    }
    actor.update(dt);
    return;
  }
  if (studio) {
    studio.advance(dt);
    return;
  }
  worldCat?.update(dt);
  worldBunny?.update(dt);
  face?.update(dt);
  ears?.update(dt);
}
if (params.has('scrub') && ears) {
  const steps = Math.round(Number(params.get('scrub')) / FIXED_DT);
  for (let i = 0; i < steps; i++) advance(FIXED_DT);
  frozen = true;
}
if (params.has('at') && (worldCat || worldBunny)) {
  const steps = Math.round(Number(params.get('at')) / FIXED_DT);
  for (let i = 0; i < steps; i++) advance(FIXED_DT);
  frozen = true;
}
if (params.has('at') && actor) {
  const steps = Math.round(Number(params.get('at')) / FIXED_DT);
  for (let i = 0; i < steps; i++) advance(FIXED_DT);
  frozen = true;
  if (params.has('fit') && whole && holder) {
    holder.position.set(0, 0, 0);
    holder.updateMatrixWorld(true);
    // the body and head only (the Zs float well above it and would push the figure down)
    const box = new THREE.Box3().setFromObject(whole.parts.torso).union(new THREE.Box3().setFromObject(whole.joint));
    holder.position.sub(box.getCenter(new THREE.Vector3()));
  }
}
// Phase 31: low power. Draw at most 30 times a second once the card is at its lowest tier and still slow (or with `?lowpower`).
const power = new PowerGovernor();
if (params.has('lowpower')) power.enter();
let skippedSec = 0;
const loop = createLoop({
  step(dt) {
    if (inputView) inputView.update(dt);
    else if (starsView) starsView.update(dt);
    else if (skyView) skyView.update(dt);
    else if (cakeView) cakeView.update(dt);
    else if (releaseView) releaseView.update(dt);
    else if (envelopeView) envelopeView.update(dt);
    else if (finaleView) finaleView.update(dt);
    else if (stayView) stayView.update(dt);
    else if (cardView) cardView.update(dt);
    else if (tour) tour.update(dt);
    else if (!frozen) advance(dt);
  },
  render(alpha, frameSec) {
    const t = simSec + alpha * FIXED_DT;
    if (flat) flat.rotation.y = reduced ? 0 : Math.sin(t / 1.5) * 0.5;
    rig?.update(t, reduced);
    if (backdrop) backdrop.update(params.has('at') ? Number(params.get('at')) : t, camera);
    if (ground) ground.update(params.has('at') ? Number(params.get('at')) : t, camera);
    cabin?.update(params.has('at') ? Number(params.get('at')) : t);
    nook?.update(params.has('at') ? Number(params.get('at')) : t);
    lighting?.update(params.has('at') ? Number(params.get('at')) : t);
    tour?.render(t);
    inputView?.render(t);
    starsView?.render(t);
    skyView?.render(t);
    cakeView?.render(t);
    releaseView?.render(t);
    envelopeView?.render(t);
    finaleView?.render(t);
    stayView?.render(t);
    cardView?.render(t);
    power.push(frameSec * 1000, stage.tier === 'low');
    skippedSec += frameSec;
    if (power.shouldDraw(performance.now())) {
      stage.render(scene, refCam ?? camera, skippedSec);
      skippedSec = 0;
    }
    if (!splash.done) void splash.finish(); // the first picture is up: the loading screen fades away
  },
});
stage.onTierChange((tier) => {
  tour?.setTier(tier);
  starsView?.setTier(tier);
  skyView?.setTier(tier);
  cakeView?.setTier(tier);
  releaseView?.setTier(tier);
  envelopeView?.setTier(tier);
  finaleView?.setTier(tier);
  stayView?.setTier(tier);
  cardView?.setTier(tier);
  backdrop?.setTier(tier);
  ground?.setTier(tier);
  cabin?.setTier(tier);
  nook?.setTier(tier);
  lighting?.setTier(tier);
});
// If the 3D context is lost and does not come back within a few seconds, say so in plain words over the paused picture (it clears itself if it returns).
let lostTimer = 0;
stage.onContextLost(() => {
  loop.pause('context');
  lostTimer = window.setTimeout(() => splash.notice('context'), 4000);
});
stage.onContextRestored(() => {
  window.clearTimeout(lostTimer);
  splash.clearNotice();
  loop.resume('context');
});
if (tour) {
  // the boot screen builds the world a piece at a time (the snow keeps falling); the loop starts when everything is in place
  const t = tour;
  void splash.run(t.tasks).then(() => {
    if (actsParam) {
      acts = createActs(t.world, { canvas, params, reduced: reduced || params.has('reduced') });
      acts.resize(canvas.clientWidth, canvas.clientHeight);
      t.setActs(acts);
      audio?.listen(acts.bus);
    }
    if (petParam && !actsParam) {
      pet = createPet(t.world, { canvas, params, reduced: reduced || params.has('reduced'), place: params.get('pet') === 'bunny' ? 'bunny' : 'cat' });
      pet.resize(canvas.clientWidth, canvas.clientHeight);
      t.setActs(pet);
      audio?.listen(pet.bus);
    }
    t.begin();
    if (params.has('debug')) console.log('[tour]', JSON.stringify(t.stats()));
    loop.start();
  });
} else loop.start();

// Phase 31: offline shell. Production only; `?nosw` turns it off for a test run. A failure to register changes nothing.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !params.has('nosw')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Phase 33: no double-tap or pinch zoom on iOS Safari (it ignores the viewport lock), and a gentle note inside chat-app browsers.
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
if (!params.has('noinapp')) showInAppNote();
