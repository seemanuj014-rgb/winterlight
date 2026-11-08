import type { Bus, WinterEvents } from '../state/events';
import type { ReplayControls } from '../ui/replayControls';
import type { StayAwhileAct } from './stayAwhile';

// Phase 28: the two ways out of stay a while, as plain controls in the Phase 24 replay column. No three, no draw calls, no words of its own (the accessible names are the plain
// functional ones in `ui/replayControls.ts`, flagged for the owner).
//   "play the ending again"  (kind `finale`)  exists, but is SHOWN only while she is staying. It calls `stay.exit('replay')`; the finale act plays again and `finale:done` brings her back.
//   "read the letter again"  (kind `letter`)  is the Phase 27 button, owned by `letterFlow.ts` and there once she has put the letter away. This file does not touch the button; it listens
//                            to the letter act: when the letter opens while she is staying, the exit to the letter is recorded (`stay:exit {to: 'letter'}`) and she comes back when it is put away.
//   `toLetter()`             the same exit for a caller that has no button (a key, a test): it leaves stay a while only if the letter can really open, so the exit never strands her.
// Never trapped: if the thing she leaves for refuses, she is put straight back into stay a while.

/** the part of the letter act this needs (the real `LetterAct` fits) */
export interface StayLetter {
  readonly bus: Bus<WinterEvents>;
  readonly machine: { readonly canReadAgain: boolean };
  readAgain(): boolean;
}

export interface StayControlsOptions {
  stay: StayAwhileAct;
  letter: StayLetter;
  controls: Pick<ReplayControls, 'add' | 'setVisible'>;
}

export interface StayControls {
  /** go to the letter (its read-again); false and still staying if the letter cannot open now */
  toLetter(): boolean;
  /** play the ending again; false and still staying if it could not start */
  replay(): boolean;
  dispose(): void;
}

export function createStayControls(o: StayControlsOptions): StayControls {
  const { stay, letter, controls } = o;

  const replay = (): boolean => stay.exit('replay');

  const toLetter = (): boolean => {
    if (!stay.machine.staying) return false;
    if (!letter.machine.canReadAgain) return false;
    if (!stay.exit('letter')) return false;
    if (letter.readAgain()) return true;
    stay.enter(); // it refused after all: she is not left outside
    return false;
  };

  controls.add('finale', replay, { visible: stay.machine.staying });

  const offs = [
    stay.bus.on('stay:enter', () => controls.setVisible('finale', true)),
    stay.bus.on('stay:exit', () => controls.setVisible('finale', false)),
    // the letter button (Phase 27) opened the letter while she was staying: that is her exit to the letter, whichever door she used
    letter.bus.on('letter:open', () => void (stay.machine.staying && stay.exit('letter'))),
  ];

  return {
    toLetter,
    replay,
    dispose: () => offs.forEach((f) => f()),
  };
}
