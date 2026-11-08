import type { ActWorld } from '../world/actWorld';
import { SHOTS } from '../world/shots';
import type { Frame } from '../core/directorMath';
import { Act2Machine, type Act2Out, type LogEntry } from './actsMath';
import type { ActIO } from './act1_nook';

// Phase 19, Act 2: the door. Chamgadad waves you along (the end of Act 1), hops across the room, leans on the door and it swings open; the camera is pushed out through the
// cabin's front door into the snow, walks to the stage and she waves. Nothing is asked of the viewer here: it is a short walk to watch (the eyes still follow the finger).
// The rules and the timing are in `actsMath.ts` (`Act2Machine`, tested); this file only writes them onto the world.

export interface Act2 {
  start(): void;
  step(dt: number, frame: Frame): Act2Out;
  readonly machine: Act2Machine;
  readonly done: boolean;
  readonly log: LogEntry[];
}

export function createAct2(w: ActWorld, io: ActIO): Act2 {
  let machine!: Act2Machine;
  let done = false;
  const api: Act2 = {
    get machine() {
      return machine;
    },
    get done() {
      return done;
    },
    get log() {
      return machine.log;
    },
    start() {
      machine = new Act2Machine({ reduced: io.reduced, startYaw: w.holder.rotation.y });
    },
    step(dt, frame) {
      const o = machine.update(dt, { shot: frame.shot, shotElapsed: frame.elapsed });
      if (o.enter) io.bus.emit('act:enter', { act: 2 });
      if (o.shot) {
        w.cameraRig.director.play(SHOTS[o.shot], { cut: o.cut });
        for (const n of o.then) w.cameraRig.director.then(SHOTS[n]);
      }
      if (o.chamgadad) w.actor.behaviour.request(o.chamgadad, o.lean ? { side: o.lean } : {});
      if (o.cat) w.cat.behaviour.request(o.cat);
      if (o.spot && w.location === 'nook') w.placeInNook(o.spot.x, o.spot.y, o.spot.z, o.spot.yaw);
      w.nook.setDoorOpen(o.nookDoor);
      if (o.haptic) io.haptics.pulse(o.haptic);
      // her eyes still look for the finger on the way
      if (o.phase === 'walking' || o.phase === 'opening') {
        const p = io.script.pointer ?? (io.input.pointer.active ? ([io.input.pointer.x, io.input.pointer.y] as const) : null);
        if (p) w.actor.behaviour.setPointer(p[0], p[1]);
      }
      if (o.done && !done) {
        done = true;
        io.bus.emit('act:done', { act: 2 });
      }
      return o;
    },
  };
  return api;
}
