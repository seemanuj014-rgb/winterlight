import { createBus, type Bus, type WinterEvents } from '../state/events';
import { ReleaseMachine, type ReleaseEvent, type ReleasePhase } from '../fx/releaseMath';

// Phase 26: the release beat after the candles, joined to the card's events. The rules and the timing are in `fx/releaseMath.ts` (`ReleaseMachine`, tested); the pictures are
// `fx/lanterns.ts` and `fx/glitter.ts`, which a view drives from `machine.time`. This file only turns the machine's three events into bus events:
//   `release:start`  the quiet beat begins (the sound hushes)
//   `release:burst`  the hush ends (glitter, first lantern, the sound swells)
//   `release:done`   the last lantern is gone (Phase 27's letter may begin)
// It can wait for the cake: `chainFrom` is the bus the cake act (`act4_cake.ts`) emits on; when that says `act:done {act: 4}` the release starts by itself. Phase 28 wires the real card;
// `?release` runs it on its own clock. It draws nothing and asks for nothing from the viewer: no input, no microphone.

export interface ReleaseActOptions {
  bus?: Bus<WinterEvents>;
  /** start by itself when the cake act on this bus says `act:done {act: 4}` */
  chainFrom?: Bus<WinterEvents>;
}

export interface ReleaseAct {
  readonly machine: ReleaseMachine;
  readonly bus: Bus<WinterEvents>;
  start(): void;
  step(dt: number): void;
  state(): { phase: ReleasePhase; time: number; started: boolean; done: boolean };
  dispose(): void;
}

export function createReleaseAct(o: ReleaseActOptions = {}): ReleaseAct {
  const bus = o.bus ?? createBus<WinterEvents>();
  const onEvent = (e: ReleaseEvent): void => {
    if (e.type === 'start') bus.emit('release:start');
    else if (e.type === 'burst') bus.emit('release:burst');
    else bus.emit('release:done');
  };
  const machine = new ReleaseMachine({ onEvent });
  const off = o.chainFrom?.on('act:done', (e) => {
    if (e.act === 4) machine.start();
  });
  return {
    machine,
    bus,
    start: () => machine.start(),
    step: (dt) => machine.step(dt),
    state: () => ({ phase: machine.phase, time: machine.time, started: machine.started, done: machine.finished }),
    dispose: () => off?.(),
  };
}
