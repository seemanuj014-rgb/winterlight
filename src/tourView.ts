import * as THREE from 'three';
import type { Stage } from './core/renderer';
import type { BootTask } from './core/bootTasks';
import { createCameraRig, type CameraRig } from './core/director';
import type { Frame } from './core/directorMath';
import { FIXED_DT } from './core/loop';
import type { QualityTier } from './core/quality';
import { createBackdrop, type Backdrop } from './world/backdrop';
import { createGround, type Ground } from './world/ground';
import { createCabin, type Cabin } from './world/cabin';
import { createNook, type Nook } from './world/nook';
import { createWorldLighting, createNookLighting, type Lighting } from './world/lighting';
import { createChamgadad, type Chamgadad } from './character/chamgadad/body';
import { createRig, type Rig } from './character/chamgadad/rig';
import { createHeadKeyLight } from './character/chamgadad/head';
import { createCat, type Cat } from './character/cat/cat';
import { createBunny, type Bunny } from './character/bunny/bunny';
import { CHAMGADAD_SCALE, SHOTS, SHOT_NAMES, SPOTS, TOUR, locationOfEye, type Location, type ShotName } from './world/shots';
import { NOOK_ORIGIN } from './world/cabinMath';
import type { ActWorld, ActsHook } from './world/actWorld';

// Phase 17 test view (and the first look at gate G1): `?tour` = the whole scene, everything in its place, and the camera director walking through it:
//   the nook (Chamgadad asleep on the bed, the cat on the blanket) -> the door push-out (a cut: the nook is 50 m up) -> a walk through the snow -> the stage
//   (Chamgadad waves, the bunny peeks and hops) -> the sky -> the finale pull-back. It starts with the boot screen running the real build tasks.
//   `&shot=<name>` plays one shot (cut to its first frame; names: see SHOTS), `&at=<seconds>` runs that much fixed-step time into it and freezes (a repeatable frame: use it
//   for frame sequences), `&from=<name>` starts the whole tour at that shot, `&reduced` is reduced motion, `&nopost` draws without the post pass, `&debug&tier=` as everywhere.
// Placement of the cast is a TEST placement (Chamgadad scaled by `CHAMGADAD_SCALE`, the bunny by the stage); the acts own the real ones from Phase 19.
// The nook hangs 50 m above the snow, so each place is hidden while the camera is in the other (fewer draw calls, and no ground under the bed).

export interface Tour {
  /** what the boot screen runs, in order */
  tasks: BootTask[];
  /** call once the tasks are done: places the cast and starts the first shot */
  begin(): void;
  /** fixed step: director, cast, door */
  update(dt: number): void;
  /** every frame: the world's own time-driven parts */
  render(tSec: number): void;
  resize(aspect: number): void;
  setTier(tier: QualityTier): void;
  readonly camera: CameraRig;
  /** Phase 19 (`?acts`): the parts the acts are handed, once the tasks have run */
  readonly world: ActWorld;
  /** Phase 19: with a hook set, `begin` starts the acts instead of the tour, and the hook runs inside every fixed step */
  setActs(hook: ActsHook): void;
  readonly frozen: boolean;
  readonly location: Location;
  /** the shot playing now, for the debug line */
  readonly frame: Frame;
  stats(): Record<string, unknown>;
}

export interface TourContext {
  stage: Stage;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  params: URLSearchParams;
  reduced: boolean;
}

const NOOK_VOID = new THREE.Color(0x1a1512);
const NIGHT_VOID = new THREE.Color(0x0d1b2e);

const isShot = (n: string | null): n is ShotName => !!n && (SHOT_NAMES as readonly string[]).includes(n);

export function createTour(ctx: TourContext): Tour {
  const { stage, scene, camera, params } = ctx;
  const reduced = ctx.reduced || params.has('reduced');
  const pr = (): number => Math.min(window.devicePixelRatio || 1, stage.settings.maxPixelRatio);
  const rig = createCameraRig(camera, { reducedMotion: reduced });

  let backdrop: Backdrop;
  let ground: Ground;
  let cabin: Cabin;
  let nook: Nook;
  let worldLights: Lighting;
  let nookLights: Lighting;
  let body: Chamgadad;
  // the pose drives `body.group` itself (position and all), so the placement lives on a holder around it
  const holder = new THREE.Group();
  let actor: Rig;
  let cat: Cat;
  let bunny: Bunny;
  let loc: Location | null = null;
  let frozen = false;
  let simSec = 0;
  let last: Frame = rig.director.frame;
  let started = false;
  let acts: ActsHook | null = null;

  const place = (obj: THREE.Object3D, p: readonly [number, number, number]): void => {
    obj.position.set(p[0], p[1], p[2]);
  };

  // Her lowest point over her origin, in the holder's scale, for the two resting postures. Measured once at build time: a curled sleeper sits higher over her origin than a seated one,
  // so grounding her only once (while curled) sank her into the snow when she woke and sat up.
  const lows = { sit: 0, curl: 0 };
  let spotY = 0;
  const groundTarget = (): number => spotY - (actor.behaviour.state === 'sleep' ? lows.curl : lows.sit);

  /** Chamgadad stands on `spot` (the seat on it), turned to face `toward` (x, z). */
  function standChamgadad(spot: readonly [number, number, number], toward: readonly [number, number]): void {
    holder.scale.setScalar(CHAMGADAD_SCALE);
    spotY = spot[1];
    holder.position.set(spot[0], groundTarget(), spot[2]);
    holder.rotation.y = Math.atan2(toward[0] - spot[0], toward[1] - spot[2]);
  }

  /** Phase 19: a spot in the nook's own frame. The seat is put on the ground there at once (the act moves her, so it must not lag behind her); the hop's own lift is the pose's. */
  function placeInNook(x: number, y: number, z: number, yaw: number): void {
    spotY = y + NOOK_ORIGIN[1];
    holder.position.set(x + NOOK_ORIGIN[0], groundTarget(), z + NOOK_ORIGIN[2]);
    holder.rotation.y = yaw;
  }

  function setLocation(next: Location, quiet = false): void {
    if (next === loc) return;
    const first = loc === null;
    loc = next;
    const inNook = next === 'nook';
    nook.root.visible = inNook;
    nookLights.root.visible = inNook;
    cat.root.visible = inNook;
    ground.root.visible = !inNook;
    // the nook hangs 50 m up: the whole night backdrop (ranges, dome, moon, aurora) would show as a flat blue band under its floor and a moon over its ceiling,
    // so the room sits in a plain dark warm void instead (and the backdrop's draw calls are not spent)
    backdrop.root.visible = !inNook;
    scene.background = inNook ? NOOK_VOID : NIGHT_VOID;
    cabin.root.visible = !inNook;
    worldLights.root.visible = !inNook;
    bunny.root.visible = !inNook;
    stage.setBloomGain(inNook ? 0.3 : 1); // a small lit room wants far less glow than a wide night (Phase 15)
    if (inNook) {
      standChamgadad(SPOTS.chamgadadBed, [SPOTS.chamgadadBed[0] + 0.5, SPOTS.chamgadadBed[2] + 4]);
      if (!first && !quiet) actor.behaviour.request('sleep');
    } else {
      standChamgadad(SPOTS.chamgadadStage, [1.1, -0.3]);
      if (!quiet && actor.behaviour.state === 'sleep') {
        // she is awake out in the snow: when the very first frame is outdoors (`&shot=stage`), let the wake finish unseen
        actor.behaviour.request('wake');
        if (first) for (let i = 0; i < 360; i++) actor.update(FIXED_DT);
      }
    }
  }

  function applyCues(f: Frame): void {
    for (const c of f.cues) {
      if (acts && (c === 'chamgadadWake' || c === 'catWake')) continue; // the acts decide when she wakes (Phase 19)
      if (c === 'chamgadadWake') actor.behaviour.request('wake');
      else if (c === 'chamgadadWave') actor.behaviour.request('wave');
      else if (c === 'catWake') cat.behaviour.request('wake');
      else if (c === 'bunnyPeek') bunny.behaviour.request('peek');
      else if (c === 'bunnyHop') bunny.behaviour.request('hop');
    }
  }

  const tasks: BootTask[] = [
    { id: 'sky', weight: 2, run: () => { backdrop = createBackdrop({ tier: stage.tier, reducedMotion: reduced, pixelRatio: pr() }); scene.add(backdrop.root); } },
    { id: 'ground', weight: 3, run: () => { ground = createGround({ tier: stage.tier, reducedMotion: reduced, pixelRatio: pr() }); scene.add(ground.root); } },
    {
      id: 'cabin',
      weight: 2,
      run: () => {
        cabin = createCabin({ tier: stage.tier, reducedMotion: reduced, pixelRatio: pr() }); scene.add(cabin.root); cabin.setDoorOpen(0);
        // the warm panel in the doorway is lit room seen from OUTSIDE; from the doorway (where the push-out starts) its back would be a solid orange wall, so it is drawn from its front only
        const glow = cabin.root.getObjectByName('cabin-glow') as THREE.Mesh | undefined;
        if (glow) (glow.material as THREE.MeshBasicMaterial).side = THREE.FrontSide;
      },
    },
    { id: 'nook', weight: 2, run: () => { nook = createNook({ tier: stage.tier, reducedMotion: reduced, pixelRatio: pr() }); scene.add(nook.root); nook.setDoorOpen(0); } },
    {
      id: 'light',
      weight: 1,
      run: () => {
        worldLights = createWorldLighting({ tier: stage.tier, reducedMotion: reduced, cabinRoot: cabin.root });
        nookLights = createNookLighting({ tier: stage.tier, reducedMotion: reduced, nookRoot: nook.root });
        scene.add(worldLights.root, nookLights.root);
      },
    },
    {
      id: 'chamgadad',
      weight: 3,
      async run(report) {
        body = createChamgadad();
        actor = createRig(body, { tier: stage.tier, reducedMotion: reduced });
        holder.add(body.group);
        scene.add(holder, createHeadKeyLight());
        holder.scale.setScalar(CHAMGADAD_SCALE);
        holder.position.set(0, 0, 0);
        for (const name of ['sit', 'curl'] as const) {
          body.applyPose(name);
          holder.updateMatrixWorld(true);
          lows[name] = new THREE.Box3().setFromObject(body.group).min.y;
        }
        report(0.4);
        // her eye images arrive over the network: the bar waits for them (a missing one fails the boot in plain words, not a blank-eyed Chamgadad)
        await actor.face.ready;
        // she starts asleep: let the blend to the curl finish before anyone looks
        actor.behaviour.request('sleep');
        for (let i = 0; i < 240; i++) actor.update(FIXED_DT);
      },
    },
    {
      id: 'friends',
      weight: 1,
      run: () => {
        cat = createCat({ reducedMotion: reduced });
        place(cat.root, SPOTS.cat);
        cat.root.rotation.y = 0.35;
        bunny = createBunny({ reducedMotion: reduced });
        place(bunny.root, SPOTS.bunny);
        bunny.root.rotation.y = Math.atan2(1.0 - SPOTS.bunny[0], -0.5 - SPOTS.bunny[2]);
        scene.add(cat.root, bunny.root);
      },
    },
    {
      id: 'warm',
      weight: 3,
      async run(report) {
        // draw each place once, off screen, so the shaders are compiled now and the first cut into the nook (or out of it) does not hitch
        stage.setPost(!params.has('nopost'));
        const shots: ShotName[] = ['nookWide', 'stage'];
        for (let i = 0; i < shots.length; i++) {
          setLocation(i === 0 ? 'nook' : 'outside', true);
          rig.director.play(SHOTS[shots[i]!], { cut: true });
          const f = rig.update(0);
          void f;
          try {
            const gl = stage.gl as unknown as { compileAsync?: (s: THREE.Scene, c: THREE.Camera) => Promise<void>; compile: (s: THREE.Scene, c: THREE.Camera) => void };
            if (gl.compileAsync) await Promise.race([gl.compileAsync(scene, camera), new Promise<void>((r) => setTimeout(r, 6000))]);
            else gl.compile(scene, camera);
          } catch {
            /* compiling ahead is only a courtesy: the first real frame compiles what is missing */
          }
          report((i + 1) / shots.length);
        }
        loc = null;
      },
    },
  ];

  // test only (`?tour&failtask=<id>`): make that boot task throw, to look at the failure screen
  const failId = params.get('failtask');
  if (failId) {
    for (const t of tasks) {
      if (t.id !== failId) continue;
      const real = t.run;
      t.run = async (report) => {
        await real(report);
        throw new Error('test failure in task ' + failId);
      };
    }
  }

  function begin(): void {
    started = true;
    if (acts) {
      // Phase 19: the acts run the camera and the cast (the first shot is theirs); `&at=<s>` runs that much fixed-step time first, with the scripted viewer, and freezes
      acts.start();
      last = rig.update(0);
      setLocation(locationOfEye(last.eye[1]));
      if (params.has('at')) {
        const steps = Math.round(Number(params.get('at')) / FIXED_DT);
        for (let i = 0; i < steps; i++) advance(FIXED_DT);
        frozen = true;
      }
      return;
    }
    const only = params.get('shot');
    const from = params.get('from');
    if (isShot(only)) {
      rig.director.play(SHOTS[only], { cut: true });
    } else {
      const start = isShot(from) ? TOUR.indexOf(from) : 0;
      const list = TOUR.slice(Math.max(0, start));
      rig.director.play(SHOTS[list[0]!], { cut: true });
      for (const n of list.slice(1)) rig.director.then(SHOTS[n]);
    }
    last = rig.update(0);
    setLocation(locationOfEye(last.eye[1]));
    if (params.has('at')) {
      const steps = Math.round(Number(params.get('at')) / FIXED_DT);
      for (let i = 0; i < steps; i++) advance(FIXED_DT);
      frozen = true;
    }
  }

  function advance(dt: number): void {
    simSec += dt;
    acts?.step(dt, last);
    last = rig.update(dt);
    setLocation(locationOfEye(last.eye[1]));
    if (last.values.door !== undefined) cabin.setDoorOpen(last.values.door);
    applyCues(last);
    actor.update(dt);
    // keep her seat on the spot as her posture changes (slowly: a wake takes seconds); the hop's own lift is the pose's, not ours
    holder.position.y += (groundTarget() - holder.position.y) * (1 - Math.exp(-dt / 1.2));
    cat.update(dt);
    bunny.update(dt);
  }

  return {
    tasks,
    begin,
    update(dt) {
      if (!started || frozen) return;
      advance(dt);
    },
    render(tSec) {
      acts?.render();
      const t = params.has('at') ? Number(params.get('at')) : tSec;
      backdrop.update(t, camera);
      if (loc === 'outside') {
        ground.update(t, camera);
        cabin.update(t);
      } else {
        nook.update(t);
      }
      worldLights.update(t);
      nookLights.update(t);
    },
    resize(aspect) {
      rig.setAspect(aspect);
      backdrop?.setPixelRatio(pr());
      rig.apply();
    },
    setTier(tier) {
      backdrop.setTier(tier);
      ground.setTier(tier);
      cabin.setTier(tier);
      nook.setTier(tier);
      worldLights.setTier(tier);
      nookLights.setTier(tier);
    },
    camera: rig,
    get world() {
      return {
        camera,
        cameraRig: rig,
        actor,
        cat,
        bunny,
        nook,
        nookLights,
        cabin,
        holder,
        get location() {
          return loc ?? 'outside';
        },
        placeInNook,
      } satisfies ActWorld;
    },
    setActs(hook) {
      acts = hook;
    },
    get frozen() {
      return frozen;
    },
    get location() {
      return loc ?? 'outside';
    },
    get frame() {
      return last;
    },
    stats() {
      const box = new THREE.Box3().setFromObject(holder);
      return { chamgadad: { pos: holder.position.toArray().map((v) => Number(v.toFixed(2))), scale: holder.scale.x, box: [box.min.toArray(), box.max.toArray()].map((a) => a.map((v) => Number(v.toFixed(2)))) }, shot: last.shot, elapsed: Number(last.elapsed.toFixed(2)), location: loc, sim: Number(simSec.toFixed(2)), cat: cat.stats(), bunny: bunny.stats() };
    },
  };
}
