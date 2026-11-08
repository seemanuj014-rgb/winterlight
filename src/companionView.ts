import * as THREE from 'three';
import { TOON_LIGHT_INTENSITY } from './render/toon/material';
import type { Critter, Frame, Pose } from './character/companion/engine';
import { createCat, type Cat } from './character/cat/cat';
import { CAT_GESTURE_NAMES, CAT_STATE_NAMES } from './character/cat/states';
import { createBunny, type Bunny } from './character/bunny/bunny';
import { BUNNY_GESTURE_NAMES, BUNNY_STATE_NAMES } from './character/bunny/states';
import { FIXED_DT } from './core/loop';

// Phase 16 test views. `?cat` and `?bunny` = the animal alone in a small studio (key light, soft fill, a plain background), seen by a normal camera.
//   `&state=<name>` or `&seq=hop@0.5,sit@6` ask for states at those seconds; `&gesture=earFlickL@1` the gestures; `&at=<seconds>` runs that much fixed-step time and freezes (a repeatable frame);
//   `&view=3q|side|back|top` or `&yaw=` `&pitch=` (degrees) walk round it; `&bg=white|light|snow`; `&reduced`; `&still` stops the automatic blinks, flicks and twitches;
//   `&pose=head.rx:0.3,body.rx:1` sets pose numbers by hand (authoring aid; it replaces the state's pose); `&look=x,y` looks somewhere (-1..1); `&debug` logs the counts;
//   `?bunny&bank` (on by default for `hide` and `peek`) puts a low snow bank in front so a peek can be seen; `&ground` lays a snow-coloured disc under it.
// Nothing here runs without `?cat` or `?bunny`. In the world views the animals are added by `main.ts` (`?nook&cat`, `?world&cabin&bunny`).

export interface Studio {
  group: THREE.Group;
  lights: THREE.Object3D[];
  companion: Cat | Bunny;
  /** The radius to frame and the height of the middle, for the camera. */
  frameRadius: number;
  frameMid: number;
  advance(dt: number): void;
  /** Run `seconds` of fixed-step time at once (the `&at=` freeze). */
  run(seconds: number): void;
  dispose(): void;
}

interface Req {
  at: number;
  what: string;
  kind: 'state' | 'gesture';
}

export function parsePairs(text: string | null, kind: Req['kind']): Req[] {
  return (text ?? '').split(',').filter(Boolean).map((item) => {
    const [what, at] = item.split('@');
    return { at: Number(at ?? 0), what: what!, kind };
  });
}

export function parsePose(text: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of (text ?? '').split(',').filter(Boolean)) {
    const [k, v] = item.split(':');
    if (k && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

export function createStudio(kind: 'cat' | 'bunny', params: URLSearchParams, opts: { reduced: boolean }): Studio {
  const reduced = opts.reduced || params.has('reduced');
  const still = params.has('still');
  const companion: Cat | Bunny = kind === 'cat' ? createCat({ reducedMotion: reduced, auto: !still && !reduced }) : createBunny({ reducedMotion: reduced, auto: !still && !reduced });
  const b = companion.behaviour as Critter<string, string>;
  const stateNames: readonly string[] = kind === 'cat' ? CAT_STATE_NAMES : BUNNY_STATE_NAMES;
  const gestureNames: readonly string[] = kind === 'cat' ? CAT_GESTURE_NAMES : BUNNY_GESTURE_NAMES;
  const requests: Req[] = [];
  const st = params.get('state');
  if (st) requests.push({ at: 0, what: st, kind: 'state' });
  requests.push(...parsePairs(params.get('seq'), 'state'), ...parsePairs(params.get('gesture'), 'gesture'));
  requests.sort((a, b2) => a.at - b2.at);
  const manual = parsePose(params.get('pose'));
  const hasManual = Object.keys(manual).length > 0;

  const group = new THREE.Group();
  const turn = new THREE.Group();
  const view = params.get('view') ?? '';
  const defaultYaw = view === '3q' ? 38 : view === 'side' ? 90 : view === 'back' ? 180 : 0;
  const yaw = params.has('yaw') ? Number(params.get('yaw')) : defaultYaw;
  const pitch = params.has('pitch') ? Number(params.get('pitch')) : view === 'top' ? 70 : 0;
  turn.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, 'YXZ');
  const mid = kind === 'cat' ? 0.17 : 0.17;
  const holder = new THREE.Group();
  holder.position.set(0, -mid, 0);
  holder.add(companion.root);
  turn.add(holder);
  group.add(turn);

  if (kind === 'bunny' && (params.has('bank') || st === 'hide' || st === 'peek' || /peek|hide/.test(params.get('seq') ?? ''))) {
    // a low bank of snow in front of the bunny, for the peek: a flattened sphere in the snow tone, no ink (background things use colour, not line)
    const bank = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshToonMaterial({ color: '#dfe9f2' }));
    bank.scale.set(0.45, 0.14, 0.2);
    bank.position.set(0, 0.0, 0.21);
    holder.add(bank);
  }
  if (params.has('ground')) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshToonMaterial({ color: '#e8f1f8' }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.002;
    holder.add(disc);
  }

  const key = new THREE.DirectionalLight('#ffffff', TOON_LIGHT_INTENSITY);
  key.position.set(3, 4, 5);
  const fill = new THREE.HemisphereLight('#bcd0ee', '#5a6d92', 0.55);

  let sim = 0;
  const lookp = params.get('look');
  if (lookp) {
    const [lx, ly] = lookp.split(',').map(Number);
    companion.lookAt(lx ?? 0, ly ?? 0);
  }
  const advance = (dt: number): void => {
    sim += dt;
    while (requests.length && requests[0]!.at <= sim) {
      const r = requests.shift()!;
      if (r.kind === 'state' && stateNames.includes(r.what)) b.request(r.what);
      else if (r.kind === 'gesture' && gestureNames.includes(r.what)) b.gesture(r.what);
    }
    const f: Frame<string, string> = companion.update(dt) as Frame<string, string>;
    void f;
    if (hasManual) (companion.applyPose as (p: Pose) => void)(manual);
  };
  if (params.has('debug')) console.log(`[${kind}]`, JSON.stringify(companion.stats()));
  advance(0);
  return {
    group,
    lights: [key, fill],
    companion,
    frameRadius: kind === 'cat' ? 0.42 : 0.42,
    frameMid: mid,
    advance,
    run(seconds) {
      const steps = Math.round(seconds / FIXED_DT);
      for (let i = 0; i < steps; i++) advance(FIXED_DT);
    },
    dispose() {
      companion.dispose();
    },
  };
}

/** Place a perspective camera so the studio's animal fits whatever the aspect is. */
export function fitStudioCamera(camera: THREE.PerspectiveCamera, studio: Studio, aspect: number): void {
  camera.aspect = aspect;
  camera.fov = 30;
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const d = Math.max(studio.frameRadius / t, studio.frameRadius / (t * aspect));
  camera.position.set(0, 0.02, d);
  camera.lookAt(0, 0, 0);
  camera.near = 0.05;
  camera.far = 40;
  camera.updateProjectionMatrix();
}
