// Phase 22: with five shapes in the sky there is one input layer and five plays. This is the (pure) rule for which play a gesture belongs to.
//   tap        goes to the play that owns the star that was tapped; a tap on a FINISHED shape's star is not played, it asks for that shape's wish again; every other play lets go of a
//              half-picked star (so a stray tap elsewhere never leaves two shapes half-picked); a tap on nothing lets every play go
//   drag       the play that owns the star the drag started on gets the whole drag (start, moves, end, cancel); a drag that starts on nothing, or on a finished shape, goes nowhere
// No three, no DOM, no clock.

export interface RouterOptions {
  /** which constellation a star id belongs to, or null */
  ownerOf: (star: string) => string | null;
  isDone: (constellation: string) => boolean;
}

export interface TapRoute {
  /** the play that plays the tap, or null */
  to: string | null;
  /** a finished shape was tapped: show its wish again */
  reshow: string | null;
  /** plays that must let go of a half-picked star or half-made line */
  release: string[];
}

export class SkyRouter {
  private dragOwner: string | null = null;
  constructor(
    private readonly o: RouterOptions,
    private readonly all: readonly string[],
  ) {}

  tap(target: string | null): TapRoute {
    const owner = target === null ? null : this.o.ownerOf(target);
    if (owner === null) return { to: null, reshow: null, release: [...this.all] };
    if (this.o.isDone(owner)) return { to: null, reshow: owner, release: [...this.all] };
    return { to: owner, reshow: null, release: this.all.filter((id) => id !== owner) };
  }

  dragStart(target: string | null): { to: string | null; release: string[] } {
    const owner = target === null ? null : this.o.ownerOf(target);
    this.dragOwner = owner !== null && !this.o.isDone(owner) ? owner : null;
    return { to: this.dragOwner, release: this.all.filter((id) => id !== this.dragOwner) };
  }

  /** the play that gets drag, dragend and cancel (null = nobody) */
  get dragging(): string | null {
    return this.dragOwner;
  }

  dragEnd(): string | null {
    const o = this.dragOwner;
    this.dragOwner = null;
    return o;
  }
}

/** which shape is the one being worked on: the half-finished one touched last, else the first that is not finished (discovery order) */
export function currentShape(order: readonly string[], isDone: (id: string) => boolean, progressOf: (id: string) => number, lastTouched: string | null): string | null {
  if (lastTouched !== null && !isDone(lastTouched) && progressOf(lastTouched) > 0) return lastTouched;
  const started = order.find((id) => !isDone(id) && progressOf(id) > 0);
  if (started !== undefined) return started;
  return order.find((id) => !isDone(id)) ?? null;
}
