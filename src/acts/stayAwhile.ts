import { createBus, type Bus, type WinterEvents } from '../state/events';
import { StayAwhileMachine, type StayActivity, type StayEvent, type StayExit, type StayPhase } from './stayAwhileMath';

// Phase 28: stay a while, joined to the card's events. The rules are in `stayAwhileMath.ts` (`StayAwhileMachine`, tested): no timer, no ending, both exits always on offer.
//   enters on `finale:done` (`chainFrom`) -> `stay:enter`; `exit('letter' | 'replay')` -> `stay:exit {to}`; activities -> `stay:activity`.
// It draws nothing and has no words. The two exit controls are `stayControls.ts` (plain DOM, calls the letter's read-again). NOT wired yet: the wander camera and ground (the full card).
// Only an exit TO THE LETTER comes back when the letter is put away; an exit to the replay comes back on `finale:done`, so a letter opened during a replay cannot end it early.

export interface StayAwhileActOptions {
  bus?: Bus<WinterEvents>;
  /** enter by itself when the finale on this bus says `finale:done`; enter again when the letter is put away again (`act:done {act: 5}` after an exit to it) */
  chainFrom?: Bus<WinterEvents>;
}

export interface StayAwhileAct {
  readonly machine: StayAwhileMachine;
  readonly bus: Bus<WinterEvents>;
  enter(): boolean;
  exit(to: StayExit): boolean;
  setActivity(a: StayActivity): boolean;
  state(): { phase: StayPhase; staying: boolean; activity: StayActivity; exits: readonly StayExit[]; timesEntered: number };
  dispose(): void;
}

export function createStayAwhileAct(o: StayAwhileActOptions = {}): StayAwhileAct {
  const bus = o.bus ?? createBus<WinterEvents>();
  let lastExit: StayExit | null = null;
  const onEvent = (e: StayEvent): void => {
    if (e.type === 'enter') bus.emit('stay:enter');
    else if (e.type === 'exit') {
      lastExit = e.to;
      bus.emit('stay:exit', { to: e.to });
    }
    else bus.emit('stay:activity', { activity: e.activity });
  };
  const machine = new StayAwhileMachine({ onEvent });
  const offs: Array<() => void> = [];
  if (o.chainFrom) {
    offs.push(o.chainFrom.on('finale:done', () => void machine.enter()));
    // she went to the letter from here and put it away again: she comes back to stay a while (a replay comes back through `finale:done`)
    offs.push(o.chainFrom.on('act:done', (e) => (e.act === 5 && machine.phase === 'left' && lastExit === 'letter' ? void machine.enter() : undefined)));
  }
  return {
    machine,
    bus,
    enter: () => machine.enter(),
    exit: (to) => machine.exit(to),
    setActivity: (a) => machine.setActivity(a),
    state: () => ({ phase: machine.phase, staying: machine.staying, activity: machine.activity, exits: machine.exits, timesEntered: machine.timesEntered }),
    dispose: () => offs.forEach((f) => f()),
  };
}
