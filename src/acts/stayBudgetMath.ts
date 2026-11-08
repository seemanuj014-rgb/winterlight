// Phase 28: the draw-call plan for stay a while, as data. PURE (no three, no DOM, no words). Every cost below was READ FROM THE PAGE (`&debug&tier=low`, software WebGL, session 10) or from the
// part's own tests, not guessed: `?stay` level 29 and looking up 25; `?pet=bunny` 54; `?pet` (cat, nook) 53; `?world&cabin` 19 (backdrop + ground + cabin). Chamgadad 30, cat 17, bunny 9 are the Phase 9 / 16 numbers.
// The rule it carries: pets and the five sky shapes are NEVER drawn together. Looking level (wander) shows the valley, Chamgadad and the bunny; looking up (constellations) shows the valley and the
// sky and hides both animals. The cat lives in the nook, which is not in the valley, so she is not part of stay a while's world. Nothing here touches the page's buttons: they are DOM, no draw calls.

export type Look = 'level' | 'up';
export type PartId = 'backdrop' | 'ground' | 'cabin' | 'sky' | 'chamgadad' | 'bunny';

/** `[A]` the draw calls each part costs at the low tier (limit 60), measured as the header says */
export const PART_CALLS: Readonly<Record<PartId, number>> = { backdrop: 8, ground: 4, cabin: 7, sky: 10, chamgadad: 30, bunny: 9 };

/** `[A]` the scene's draw-call limit per tier (PERF_BUDGET): low 60, mid 90, high 130 (post passes are counted apart) */
export const CALL_LIMIT = { low: 60, mid: 90, high: 130 } as const;

export interface StayPlan {
  readonly look: Look;
  readonly visible: readonly PartId[];
  readonly calls: number;
}

/** which parts are drawn for where she is looking; the valley is always there, the animals and the sky never together */
export function planStay(look: Look): StayPlan {
  const visible: PartId[] = ['backdrop', 'ground', 'cabin', ...(look === 'up' ? (['sky'] as const) : (['chamgadad', 'bunny'] as const))];
  return { look, visible, calls: visible.reduce((n, id) => n + PART_CALLS[id], 0) };
}

/** the look from the world's own activity label: looking up at the constellations = up, anything else = level */
export function lookForActivity(activity: string): Look {
  return activity === 'constellations' ? 'up' : 'level';
}

/** is a part drawn right now (what the view toggles `visible` with) */
export function shows(look: Look, id: PartId): boolean {
  return planStay(look).visible.includes(id);
}
