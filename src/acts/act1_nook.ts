import type { ActWorld } from '../world/actWorld';
import { SHOTS } from '../world/shots';
import type { Frame } from '../core/directorMath';
import type { Input, Picker, Haptics } from '../input';
import type { Bus } from '../state/events';
import type { WinterEvents } from '../state/events';
import type { ProgressStore } from '../state/progress';
import { Act1Machine, scriptAt, type Act1Out, type LogEntry, type Script } from './actsMath';
import type { Hud } from './hud';

// Phase 19, Act 1: the sleepy nook. Chamgadad asleep under the blanket, the cat on her feet, the lamp low. She holds (or taps, or holds Enter / Space) and the light rises;
// when it is full Chamgadad wakes, stretches and her eyes find the finger. If nobody touches the screen, the sleep deepens and the owner's line appears ("let her sleep").
// All the rules are in `actsMath.ts` (`Act1Machine`, tested); this file only listens to the input layer and writes the machine's answers onto the world.
// What a hold MEANS is decided here, not in the input layer (Phase 18): any hold on the screen wakes her; the keyboard reaches her as the target `chamgadad`.

export const CHAMGADAD_TARGET = 'chamgadad';

export interface ActIO {
  input: Input;
  picker: Picker;
  haptics: Haptics;
  bus: Bus<WinterEvents>;
  progress: ProgressStore;
  hud: Hud;
  script: Script;
  reduced: boolean;
}

export interface Act1 {
  start(): void;
  step(dt: number, frame: Frame): Act1Out;
  readonly machine: Act1Machine;
  readonly done: boolean;
  readonly log: LogEntry[];
  dispose(): void;
}

export function createAct1(w: ActWorld, io: ActIO, line: string | null): Act1 {
  const machine = new Act1Machine(line !== null);
  let pressed = false;
  let holding = false;
  let taps = 0;
  let t = 0;
  let prevT = 0;
  let done = false;
  const off = [
    io.input.on('press', () => void (pressed = true)),
    io.input.on('holdstart', () => void (holding = true)),
    io.input.on('holdend', () => void ((holding = false), (pressed = false))),
    io.input.on('tap', () => {
      pressed = false;
      holding = false;
      taps++;
    }),
    io.input.on('dragstart', () => void ((holding = false), (pressed = false))),
    io.input.on('dragend', () => void ((holding = false), (pressed = false))),
    io.input.on('cancel', () => void ((holding = false), (pressed = false))),
  ];

  return {
    machine,
    get done() {
      return done;
    },
    get log() {
      return machine.log;
    },
    start() {
      w.nook.setLamp(0.55);
      w.nookLights.setLamp(0.55);
      // she is the only thing to hold: one target, so the keyboard has somewhere to go (Tab, then hold Space or Enter)
      io.picker.add({ id: CHAMGADAD_TARGET, object: w.holder, radius: 0.9 });
      io.bus.emit('act:enter', { act: 1 });
    },
    step(dt, frame) {
      prevT = t;
      t += Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      const s = scriptAt(io.script, prevT, t);
      const o = machine.update(dt, { pressed: pressed || s.pressed, holding: holding || s.holding, taps: taps + s.taps });
      taps = 0;
      if (o.shot) w.cameraRig.director.play(SHOTS[o.shot], { cut: frame.shot === null });
      if (o.chamgadad) w.actor.behaviour.request(o.chamgadad);
      w.nook.setLamp(o.lamp);
      w.nookLights.setLamp(o.lamp);
      io.hud.set(o.hint, o.line);
      if (o.haptic) io.haptics.pulse(o.haptic);
      if (o.secret) {
        if (io.progress.markSecret(o.secret)) io.bus.emit('secret:found', { id: o.secret });
      }
      io.picker.setEnabled(CHAMGADAD_TARGET, o.holdable);
      // her eyes find the finger (head frame: the viewer's right is +x, up is +y); a keyboard or a finger that is lifted leaves them where they were looking
      if (o.tracking) {
        const p = io.script.pointer ?? (io.input.pointer.active ? ([io.input.pointer.x, io.input.pointer.y] as const) : null);
        if (p) w.actor.behaviour.setPointer(p[0], p[1]);
        else w.actor.behaviour.setPointer(null);
      }
      if (o.done) {
        done = true;
        io.picker.remove(CHAMGADAD_TARGET);
      }
      return o;
    },
    dispose() {
      for (const f of off) f();
      io.picker.remove(CHAMGADAD_TARGET);
    },
  };
}
