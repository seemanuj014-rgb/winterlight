import * as THREE from 'three';
import { createChamgadad, type Chamgadad } from '../character/chamgadad/body';
import { createRig, type Rig } from '../character/chamgadad/rig';
import { createHeadKeyLight } from '../character/chamgadad/head';
import { createBunny, type Bunny } from '../character/bunny/bunny';
import { CHAMGADAD_SCALE } from '../world/shots';
import { FIXED_DT } from '../core/loop';
import { castSpots, castShows } from './stayCastMath';

// Phase 28: the two animals of stay a while's valley, Chamgadad and the bunny (the cat lives in the nook and is not part of this world). They are only STANDING here for now: awake, idling
// with their own idle motion; petting them is the next session's (it shares the canvas with the drag that turns the view). Draw rule: `stayCastMath.ts` / `stayBudgetMath.ts`.
// No words, no input, nothing that can end or block anything; `setLook(activity, home)` only switches `visible`.

export interface StayCast {
  readonly root: THREE.Group;
  readonly actor: () => Rig | null;
  readonly bunny: Bunny;
  /** her holder (the placement lives on it) and where the bunny's home is, for the petting */
  readonly holder: THREE.Group;
  readonly bunnyHome: { x: number; z: number; yaw: number };
  /** the screen's shape changed: stand them where that shape shows them (the bunny's home moves too; `bunnyHome` is updated in place) */
  setAspect(aspect: number): void;
  /** true once her eyes have arrived (until then she is not drawn, so no blank-eyed Chamgadad) */
  ready(): boolean;
  setLook(activity: string, home: number): void;
  update(dt: number): void;
  setTier(): void;
  dispose(): void;
}

export function createStayCast(ctx: { aspect?: number; scene: THREE.Scene; tier: 'low' | 'mid' | 'high'; reducedMotion: boolean }): StayCast {
  const root = new THREE.Group();
  root.name = 'stayCast';
  let spots = castSpots(ctx.aspect);
  const holder = new THREE.Group();
  const bunny = createBunny({ reducedMotion: ctx.reducedMotion });
  bunny.root.position.set(spots.bunny[0], spots.bunny[1], spots.bunny[2]);
  bunny.root.rotation.y = spots.bunnyYaw;
  root.add(bunny.root);

  let body: Chamgadad | null = createChamgadad();
  let actor: Rig | null = createRig(body, { tier: ctx.tier, reducedMotion: ctx.reducedMotion });
  holder.add(body.group);
  holder.scale.setScalar(CHAMGADAD_SCALE);
  holder.position.set(0, 0, 0);
  root.add(holder, createHeadKeyLight());
  // her lowest point over her origin when seated, so she sits ON the snow (as the tour does it)
  body.applyPose('sit');
  holder.updateMatrixWorld(true);
  const sitLow = new THREE.Box3().setFromObject(body.group).min.y;
  const bunnyHome = { x: spots.bunny[0], z: spots.bunny[2], yaw: spots.bunnyYaw };
  const stand = (): void => {
    holder.position.set(spots.chamgadad[0], spots.chamgadad[1] - sitLow, spots.chamgadad[2]);
    holder.rotation.y = spots.chamgadadYaw;
    bunnyHome.x = spots.bunny[0];
    bunnyHome.z = spots.bunny[2];
    bunnyHome.yaw = spots.bunnyYaw;
    bunny.root.position.set(spots.bunny[0], spots.bunny[1], spots.bunny[2]);
    bunny.root.rotation.y = spots.bunnyYaw;
  };
  stand();
  let ready = false;
  let alive = true;
  holder.visible = false;
  void actor.face.ready.then(() => {
    if (!alive || !actor) return;
    actor.behaviour.request('wake');
    for (let i = 0; i < 360; i++) actor.update(FIXED_DT);
    ready = true;
  });
  ctx.scene.add(root);

  let wantActor = false;
  let wantBunny = false;
  const apply = (): void => {
    holder.visible = wantActor && ready;
    bunny.root.visible = wantBunny;
  };
  let acc = 0;
  return {
    root,
    actor: () => actor,
    bunny,
    holder,
    bunnyHome,
    setAspect(aspect) {
      spots = castSpots(aspect);
      stand();
    },
    ready: () => ready,
    setLook(activity, home) {
      wantActor = castShows(activity, home, 'chamgadad');
      wantBunny = castShows(activity, home, 'bunny');
      apply();
    },
    update(dt) {
      apply();
      // nothing to advance while neither is drawn
      if (!holder.visible && !bunny.root.visible) return;
      acc += Math.min(dt, 0.25);
      while (acc >= FIXED_DT) {
        acc -= FIXED_DT;
        if (ready && actor) actor.update(FIXED_DT);
        bunny.update(FIXED_DT);
      }
    },
    setTier() {},
    dispose() {
      alive = false;
      ctx.scene.remove(root);
      actor = null;
      body = null;
    },
  };
}
