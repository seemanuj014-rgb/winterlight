import { createLetterReader, type LetterReader } from '../ui/letterReader';
import { loadContent } from '../content';
import { createLetterAct, type LetterAct } from './act5_letter';
import { createLetterFlow, type LetterFlow } from './letterFlow';
import { createProgress } from '../state/progress';
import { createBus, type WinterEvents } from '../state/events';
import type { LetterDelivery } from './letterMath';

// Phase 24 test view: `?letter` = a dark page with the letter reader open on content/letter.md (a placeholder shows as it is).
// Phase 27 test view: `?letter&ritual` = the whole ritual on a dark page with a plain TEST stand-in for the envelope (no picture, no words; the real picture waits for the owner's delivery choice):
//   it arrives, waits for a tap / Enter / Space, the reader opens, scroll to the end counts as read, close, a "read again" button appears.
//   knobs: `&at=<s>` fast-forward the machine, `&opened` start with the reader already open, `&delivery=table`, `&reduced`, `&signoff=a|b` made-up sign-off lines (layout checks only).
// TEST knobs: `&text=<made-up text>` replaces the text (for layout checks only; never put real words in a URL), `&reduced`. State: `window.__letter`.
// TEST ONLY: the real opening is wired into the card in Phase 28. The two labels are plain functional words, flagged for the owner like the loading words.

declare global {
  interface Window {
    __letter?: {
      reader: LetterReader;
      isOpen(): boolean;
      progress(): number;
      act?: LetterAct;
      state?: () => ReturnType<LetterAct['state']>;
      log?: () => { type: string; at: number }[];
      busLog?: () => { name: string }[];
      readCount?: () => number;
    };
  }
}

export function createLetterView(ctx: { params: URLSearchParams; reduced: boolean }): { dispose(): void } {
  document.body.style.background = '#0d1b2e';
  const fromUrl = ctx.params.get('text');
  const content = loadContent().content;
  const text = fromUrl !== null ? fromUrl.replace(/\\n/g, '\n') : content.letter;

  if (!ctx.params.has('ritual')) {
    const reader = createLetterReader({ text, reducedMotion: ctx.reduced, closeLabel: 'Close the letter', panelLabel: 'Letter' });
    reader.open();
    window.__letter = { reader, isOpen: () => reader.isOpen, progress: () => reader.progress() };
    return { dispose: () => reader.dispose() };
  }

  const bus = createBus<WinterEvents>();
  const busLog: { name: string }[] = [];
  for (const k of ['act:enter', 'letter:arrive', 'letter:open', 'letter:read', 'letter:close', 'act:done'] as const) bus.on(k, () => busLog.push({ name: k }));
  const progress = createProgress();
  const delivery: LetterDelivery = ctx.params.get('delivery') === 'table' ? 'table' : 'lantern';
  const act = createLetterAct({ bus, delivery, reducedMotion: ctx.reduced, alreadyRead: progress.get().letterRead });
  let reads = 0;
  const so = ctx.params.get('signoff');
  const credits = so !== null ? { sign_off: so.split('|')[0] ?? '', made_by: so.split('|')[1] ?? '' } : content.credits;
  const flow: LetterFlow = createLetterFlow({
    act,
    letter: text,
    credits,
    reducedMotion: ctx.reduced,
    onRead: () => {
      reads++;
      progress.markLetterRead();
    },
  });

  // the stand-in envelope: shown while it is arriving (fading in) and waiting; a tap, Enter or Space opens it
  const env = document.createElement('button');
  env.type = 'button';
  env.className = 'wl-envelope-stub';
  env.setAttribute('aria-label', 'Open the envelope');
  env.hidden = true;
  env.style.opacity = '0';
  document.body.appendChild(env);
  env.addEventListener('click', () => {
    act.open();
  });

  act.start();
  const at = Number(ctx.params.get('at'));
  if (Number.isFinite(at) && at > 0) for (let t = 0; t < at; t += 1 / 30) act.step(1 / 30);
  if (ctx.params.has('opened')) {
    for (let i = 0; i < 400 && !act.machine.canOpen; i++) act.step(1 / 30); // let it arrive first
    act.open();
    for (let i = 0; i < 400; i++) act.step(1 / 30);
  }

  let last = performance.now();
  let raf = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    act.step(dt);
    const ph = act.machine.phase;
    env.hidden = !(ph === 'arriving' || ph === 'waiting' || ph === 'opening');
    env.style.opacity = ph === 'opening' ? String(1 - act.machine.openProgress) : String(act.machine.arriveProgress);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  window.__letter = {
    reader: flow.reader,
    isOpen: () => flow.reader.isOpen,
    progress: () => flow.reader.progress(),
    act,
    state: () => act.state(),
    log: () => act.machine.log.map((e) => ({ type: e.type, at: e.at })),
    busLog: () => busLog,
    readCount: () => reads,
  };
  return {
    dispose() {
      cancelAnimationFrame(raf);
      flow.dispose();
      act.dispose();
      env.remove();
    },
  };
}
