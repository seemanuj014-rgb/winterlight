import { createBus, type Bus, type WinterEvents } from '../state/events';
import { FinaleMachine, type FinaleEvent, type FinalePhase } from './finaleMath';

// Phase 28: the finale act, joined to the card's events. The rules and the timing are in `finaleMath.ts` (`FinaleMachine`, tested); a view reads the machine's progress numbers.
// This file turns the machine's events into bus events and starts by itself when the letter is put away:
//   `act:enter {6}` + `finale:start` (shapes lift) ... `finale:join` ... `finale:swell` (aurora, the music box) ... `finale:pullback` ... `finale:done` + `act:done {6}`
// It replays when she asks: `stay:exit {to: 'replay'}` on `chainFrom` calls `machine.replay()`. It draws nothing, has no words and asks nothing of the viewer.
// NOT wired yet (next session, see PHASE_STATUS): the pictures, the audio (`engine.birthday()` on `finale:swell`), and what "the letter put away" means in the full card.

export interface FinaleActOptions {
  bus?: Bus<WinterEvents>;
  /** start by itself when the letter on this bus says `act:done {act: 5}`; replay when it says `stay:exit {to: 'replay'}` */
  chainFrom?: Bus<WinterEvents>;
  reducedMotion?: boolean;
}

export interface FinaleAct {
  readonly machine: FinaleMachine;
  readonly bus: Bus<WinterEvents>;
  start(): void;
  replay(): boolean;
  step(dt: number): void;
  state(): { phase: FinalePhase; time: number; started: boolean; done: boolean; timesStarted: number; progress: number };
  dispose(): void;
}

export function createFinaleAct(o: FinaleActOptions = {}): FinaleAct {
  const bus = o.bus ?? createBus<WinterEvents>();
  const onEvent = (e: FinaleEvent): void => {
    if (e.type === 'start') {
      bus.emit('act:enter', { act: 6 });
      bus.emit('finale:start');
    } else if (e.type === 'join') bus.emit('finale:join');
    else if (e.type === 'swell') bus.emit('finale:swell');
    else if (e.type === 'pullback') bus.emit('finale:pullback');
    else {
      bus.emit('finale:done');
      bus.emit('act:done', { act: 6 });
    }
  };
  const machine = new FinaleMachine({ reducedMotion: o.reducedMotion, onEvent });
  const offs: Array<() => void> = [];
  if (o.chainFrom) {
    offs.push(o.chainFrom.on('act:done', (e) => (e.act === 5 ? machine.start() : undefined)));
    offs.push(o.chainFrom.on('stay:exit', (e) => (e.to === 'replay' ? void machine.replay() : undefined)));
  }
  return {
    machine,
    bus,
    start: () => machine.start(),
    replay: () => machine.replay(),
    step: (dt) => machine.step(dt),
    state: () => ({ phase: machine.phase, time: machine.time, started: machine.started, done: machine.finished, timesStarted: machine.timesStarted, progress: machine.progress }),
    dispose: () => offs.forEach((f) => f()),
  };
}
