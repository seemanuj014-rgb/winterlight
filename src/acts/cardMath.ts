// Phase 28: the order of the whole card, as plain rules (no three, no DOM, no words). `CardMachine` says which stage is showing and what the bus told it; the page (`cardView.ts`) builds the picture.
//   acts (the nook, waking Chamgadad, the door and the push-out into the snow: Phases 19) -> sky (the five names) -> cake -> release -> envelope (the letter) -> finale -> stay a while
// Stage by stage, one scene at a time: each stage is the picture already looked at on its own `?` view, so each keeps its own draw-call count (the plan that mattered when everything shared one
// scene is moot: the scene is cleared between stages and there is a dip to night between them). Reduced motion: the dip is instant.
// Stay a while is the end of the line and is never left except through its two exits: `replay` plays the finale again and comes back; `letter` is handled inside stay a while itself (the real reader).
// DECISION `[A]` (owner may flip): the sky stage ends when ALL FIVE names are done (storyboard Act 3: "order is free", then Act 4); nothing is timed and nothing is forced, and what she has finished is kept
// between visits (the progress store), so a reload comes back to where she was.

export const CARD_STAGES = ['acts', 'sky', 'cake', 'release', 'envelope', 'finale', 'stay'] as const;
export type CardStage = (typeof CARD_STAGES)[number];

/** how many of the five names are done before the sky hands over */
export const SKY_NEEDED = 5;
/** `[A]` the dip to night between two stages (s): half to cover, half to uncover; reduced motion 0 */
export const DIP_S = 0.9;

export type CardEvent =
  | { type: 'acts:done' }
  | { type: 'sky:count'; done: number }
  | { type: 'cake:done' }
  | { type: 'release:done' }
  | { type: 'letter:done' }
  | { type: 'finale:done' }
  | { type: 'stay:replay' };

export function isStage(s: string | null | undefined): s is CardStage {
  return !!s && (CARD_STAGES as readonly string[]).includes(s);
}

/** which stage follows `stage` when `ev` happens, or null if nothing changes */
export function nextStage(stage: CardStage, ev: CardEvent): CardStage | null {
  switch (stage) {
    case 'acts':
      return ev.type === 'acts:done' ? 'sky' : null;
    case 'sky':
      return ev.type === 'sky:count' && ev.done >= SKY_NEEDED ? 'cake' : null;
    case 'cake':
      return ev.type === 'cake:done' ? 'release' : null;
    case 'release':
      return ev.type === 'release:done' ? 'envelope' : null;
    case 'envelope':
      return ev.type === 'letter:done' ? 'finale' : null;
    case 'finale':
      return ev.type === 'finale:done' ? 'stay' : null;
    case 'stay':
      return ev.type === 'stay:replay' ? 'finale' : null;
  }
}

/** the dip between two stages: 0 = clear, 1 = fully night. `t` seconds since the change was asked for. */
export function dipLevel(t: number, reduced: boolean): number {
  if (reduced || !(t > 0)) return 0;
  const h = DIP_S / 2;
  if (t >= DIP_S) return 0;
  return t < h ? t / h : (DIP_S - t) / h;
}

/** the stage's switch happens at the darkest moment */
export function switchesAt(reduced: boolean): number {
  return reduced ? 0 : DIP_S / 2;
}
