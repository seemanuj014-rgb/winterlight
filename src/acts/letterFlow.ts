import { createLetterReader, type LetterReader } from '../ui/letterReader';
import { replayControls, type ReplayControls } from '../ui/replayControls';
import { signOffLines } from './letterMath';
import type { LetterAct } from './act5_letter';

// Phase 27: joins the letter act (`act5_letter.ts`) to the page she reads on (`ui/letterReader.ts`) and to the "read again" button. Plain DOM, no three, no draw calls.
//   letter:open   the reader opens (the first time after the envelope, every other time from "read again")
//   her scroll    is reported to the act (`read` fires once at the end)
//   the reader's close button or Escape   puts the letter away (the act goes to `closed`), the sign-off was under the letter all along
//   letter:close  the "read again" button appears (and only then; it is never there before she has read it once)
// The letter's text and the sign-off lines come from the caller (content/letter.md and content/credits.json), unchanged. The two labels are plain functional words, flagged.

export interface LetterFlowOptions {
  act: LetterAct;
  letter: string;
  credits: { sign_off: string; made_by: string };
  reducedMotion: boolean;
  /** called when the letter is first read to the end (the page records it in the progress store) */
  onRead?: () => void;
  parent?: HTMLElement;
  controls?: ReplayControls;
}

export interface LetterFlow {
  readonly reader: LetterReader;
  readonly controls: ReplayControls;
  dispose(): void;
}

export function createLetterFlow(o: LetterFlowOptions): LetterFlow {
  const parent = o.parent ?? document.body;
  const controls = o.controls ?? replayControls(parent);
  const reader = createLetterReader({
    parent,
    text: o.letter,
    reducedMotion: o.reducedMotion,
    closeLabel: 'Close the letter',
    panelLabel: 'Letter',
    signOff: signOffLines(o.credits),
    onScroll: () => o.act.reportProgress(reader.progress()),
    onToggle: (open) => {
      if (!open) o.act.close();
    },
  });
  const readAgainButton = controls.add('letter', () => {
    o.act.readAgain();
  }, { visible: false });

  const offs = [
    o.act.bus.on('letter:open', () => {
      controls.setVisible('letter', false);
      reader.open();
      o.act.reportProgress(reader.progress()); // a short letter is already at its end
    }),
    o.act.bus.on('letter:read', () => o.onRead?.()),
    o.act.bus.on('letter:close', () => {
      controls.setVisible('letter', true);
      // The button hides itself when the reader opens (just before the reader notes where focus was), so focus fell to the page and had nowhere to go back to. When the letter is put away
      // and nothing else holds focus, hand it to the button she used (Phase 24 rule: focus returns after each exit).
      // (the browser moves focus off a just-hidden element only at its next update, so a focus still inside the hidden reader counts as none)
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected || a.closest('[hidden]')) {
        try {
          readAgainButton.focus({ preventScroll: true });
        } catch {
          /* nothing to give back to */
        }
      }
    }),
  ];
  return {
    reader,
    controls,
    dispose() {
      for (const off of offs) off();
      reader.dispose();
    },
  };
}
