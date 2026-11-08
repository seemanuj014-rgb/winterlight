import { createBus, type Bus, type WinterEvents } from '../state/events';
import { LetterMachine, type LetterDelivery, type LetterEvent, type LetterPhase } from './letterMath';

// Phase 27: the letter act, joined to the card's events. The rules are in `letterMath.ts` (`LetterMachine`, tested); the reader page is `ui/letterReader.ts`.
// This file turns the machine's events into bus events and starts the delivery by itself when the release is over:
//   `act:enter {5}` then `letter:arrive` ... (the envelope comes down) ... `letter:open` (the reader opens) ... `letter:read` (once) ... `letter:close`
// It draws nothing and has NO words: the envelope's picture and the sign-off text are wired in the next session (see PHASE_STATUS), the letter text is the reader's.
// The envelope waits for ever: nothing here auto-opens it.

export interface LetterActOptions {
  bus?: Bus<WinterEvents>;
  /** start by itself when the release on this bus says `release:done` */
  chainFrom?: Bus<WinterEvents>;
  delivery?: LetterDelivery;
  reducedMotion?: boolean;
  /** she has read it on an earlier visit (from the progress store) */
  alreadyRead?: boolean;
}

export interface LetterAct {
  readonly machine: LetterMachine;
  readonly bus: Bus<WinterEvents>;
  start(): void;
  step(dt: number): void;
  open(): boolean;
  close(): boolean;
  readAgain(): boolean;
  reportProgress(p: number): void;
  state(): { phase: LetterPhase; time: number; read: boolean; canOpen: boolean; canReadAgain: boolean; timesOpened: number };
  dispose(): void;
}

export function createLetterAct(o: LetterActOptions = {}): LetterAct {
  const bus = o.bus ?? createBus<WinterEvents>();
  const onEvent = (e: LetterEvent): void => {
    if (e.type === 'arrive') {
      bus.emit('act:enter', { act: 5 });
      bus.emit('letter:arrive');
    } else if (e.type === 'open') bus.emit('letter:open');
    else if (e.type === 'read') bus.emit('letter:read');
    else if (e.type === 'close') {
      bus.emit('letter:close');
      bus.emit('act:done', { act: 5 });
    }
  };
  const machine = new LetterMachine({ delivery: o.delivery, reducedMotion: o.reducedMotion, onEvent });
  if (o.alreadyRead) machine.markReadFromProgress();
  const off = o.chainFrom?.on('release:done', () => machine.start());
  return {
    machine,
    bus,
    start: () => machine.start(),
    step: (dt) => machine.step(dt),
    open: () => machine.open(),
    close: () => machine.close(),
    readAgain: () => machine.readAgain(),
    reportProgress: (p) => machine.reportProgress(p),
    state: () => ({
      phase: machine.phase,
      time: machine.time,
      read: machine.read,
      canOpen: machine.canOpen,
      canReadAgain: machine.canReadAgain,
      timesOpened: machine.timesOpened,
    }),
    dispose: () => off?.(),
  };
}
