// Phase 21: the rules of connecting stars. Pure (no three, no DOM, no clock): every call carries its own time in SECONDS, so the same calls always give the same answer.
//
// What the viewer can do (the input layer turns touch, mouse and keys into these calls):
//   drag   press on a star, drag: a line grows from it and follows the finger; when the finger comes near the NEXT valid star the line snaps on and the chain goes on from
//          there. Let go and the half-made line simply goes away (nothing drawn is lost). A wrong star is a soft "not that one", never a penalty.
//   tap    tap a star to pick it up, tap its neighbour to join them (the way for keys, and for a thumb that would rather not drag).
//   undo   takes back the last line.
// Forgiving on purpose: a line can be drawn from either end; touching a star that is already joined to this one is a quiet no-op; a finger that skims past a star that is
// not valid only gets a single soft "wrong" and the drag carries on; the snap circle is generous and the shape's definition is checked so no two stars are closer than it.
// If the def has an `order`, only the next line in that order is valid (from either end). Hint: 8 s of nothing and the engine names the next line to glow.

import { SNAP_DEFAULT, validateDef, type ConstellationDef } from './defs';

/** `[A]` seconds of nothing before the hint (the phase said 8; the owner asked for 0.8) */
export const HINT_AFTER = 0.8;
/** `[A]` a skimmed wrong star complains at most this often (s), and a star only after the finger has left it */
export const WRONG_COOLDOWN = 0.1;

export type EngineEvent =
  | { type: 'start'; star: string; t: number }
  | { type: 'select'; star: string; t: number }
  | { type: 'deselect'; star: string; t: number }
  | { type: 'connect'; edge: number; from: string; to: string; t: number; drawn: number; of: number }
  | { type: 'wrong'; star: string; why: 'noLine' | 'notNext' | 'notJoined' | 'done'; t: number }
  | { type: 'already'; star: string; t: number }
  | { type: 'release'; t: number; partial: boolean }
  | { type: 'undo'; edge: number; t: number; drawn: number }
  | { type: 'complete'; t: number }
  | { type: 'hint'; from: string; to: string; edge: number; t: number }
  | { type: 'hintEnd'; t: number }
  | { type: 'reset'; t: number };

export interface EngineState {
  /** edge indices in the order they were drawn */
  drawn: readonly number[];
  /** the star a line is coming out of right now (a drag, or a tapped star), or null */
  anchor: string | null;
  dragging: boolean;
  /** where the finger is, in plane units (only while dragging) */
  finger: { x: number; y: number } | null;
  complete: boolean;
  /** the line to glow, or null */
  hint: { from: string; to: string; edge: number } | null;
  /** stars the anchor may be joined to right now (they pulse softly while a line is out) */
  targets: readonly string[];
  progress: number;
}

export interface EngineOptions {
  /** multiplies the snap radius (a finger gets more than a mouse). Default 1. */
  snapScale?: number;
  hintAfter?: number;
}

export class ConstellationMachine {
  readonly def: ConstellationDef;
  readonly log: EngineEvent[] = [];
  private readonly pos = new Map<string, { x: number; y: number }>();
  private readonly edgeOf = new Map<string, number>(); // "a|b" sorted -> edge index
  private readonly drawn: number[] = [];
  private anchor: string | null = null;
  private dragging = false;
  private finger: { x: number; y: number } | null = null;
  private complete = false;
  private hint: { from: string; to: string; edge: number } | null = null;
  private lastInput = 0;
  private lastT = 0;
  private lastWrong = -Infinity;
  private over: string | null = null; // the wrong star the finger is on, so it complains once per visit
  private snapScale: number;
  private readonly hintAfter: number;
  private out: EngineEvent[] = [];

  constructor(def: ConstellationDef, opts: EngineOptions = {}) {
    const rep = validateDef(def);
    if (!rep.ok) throw new Error(`constellation "${def?.id}" is not playable: ${rep.errors.join('; ')}`);
    this.def = def;
    this.snapScale = Number.isFinite(opts.snapScale) && opts.snapScale! > 0 ? opts.snapScale! : 1;
    this.hintAfter = opts.hintAfter ?? HINT_AFTER;
    for (const n of def.nodes) this.pos.set(n.id, { x: n.x, y: n.y });
    def.edges.forEach(([a, b], i) => this.edgeOf.set(key(a, b), i));
  }

  // ---- reading --------------------------------------------------------------------------------------------------------------------------
  get snap(): number {
    return (this.def.snap ?? SNAP_DEFAULT) * this.snapScale;
  }
  setSnapScale(s: number): void {
    if (Number.isFinite(s) && s > 0) this.snapScale = s;
  }
  get isComplete(): boolean {
    return this.complete;
  }
  get drawnEdges(): readonly number[] {
    return this.drawn;
  }
  state(): EngineState {
    return { drawn: [...this.drawn], anchor: this.anchor, dragging: this.dragging, finger: this.finger ? { ...this.finger } : null, complete: this.complete, hint: this.hint ? { ...this.hint } : null, targets: this.anchor && !this.complete ? this.targetsFrom(this.anchor) : [], progress: this.drawn.length / this.def.edges.length };
  }
  position(id: string): { x: number; y: number } | null {
    return this.pos.get(id) ?? null;
  }
  /** the star nearest to a point, with its distance, or null */
  nearest(x: number, y: number): { id: string; d: number } | null {
    let best: { id: string; d: number } | null = null;
    for (const [id, p] of this.pos) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (best === null || d < best.d) best = { id, d };
    }
    return best;
  }
  isDrawn(edge: number): boolean {
    return this.drawn.includes(edge);
  }
  /** is the line a-b one that may be drawn right now? Returns its index, or -1. */
  validEdge(a: string, b: string): number {
    const i = this.edgeOf.get(key(a, b));
    if (i === undefined || this.drawn.includes(i)) return -1;
    if (this.def.order && this.def.order[this.drawn.length] !== i) return -1;
    return i;
  }
  /** stars that a line from `id` may go to now */
  targetsFrom(id: string): string[] {
    const out: string[] = [];
    this.def.edges.forEach(([a, b], i) => {
      if (a !== id && b !== id) return;
      if (this.drawn.includes(i)) return;
      if (this.def.order && this.def.order[this.drawn.length] !== i) return;
      out.push(a === id ? b : a);
    });
    return out;
  }

  // ---- doing ----------------------------------------------------------------------------------------------------------------------------
  /** a finger (or the mouse, or Enter) went down on a star and started to drag */
  beginDrag(star: string | null, x: number, y: number, t: number): EngineEvent[] {
    this.begin(t);
    if (this.complete || !this.finite(x, y)) return this.flush();
    this.finger = { x, y };
    if (star === null || !this.pos.has(star)) {
      this.dragging = false;
      return this.flush();
    }
    if (this.targetsFrom(star).length > 0) {
      this.anchor = star;
      this.dragging = true;
      this.over = star;
      this.push({ type: 'start', star, t });
    } else {
      this.dragging = false;
      this.anchor = null;
      this.wrong(star, this.stuckReason(star), t);
    }
    return this.flush();
  }

  /** the finger moved (plane units) */
  move(x: number, y: number, t: number): EngineEvent[] {
    this.begin(t);
    if (!this.dragging || this.anchor === null || !this.finite(x, y)) return this.flush();
    this.finger = { x, y };
    // 1. the nearest star the line may go to, inside the snap circle: join it, and the chain goes on from there
    let best: { id: string; d: number } | null = null;
    for (const id of this.targetsFrom(this.anchor)) {
      const p = this.pos.get(id)!;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= this.snap && (best === null || d < best.d)) best = { id, d };
    }
    if (best) {
      this.join(this.anchor, best.id, t);
      this.over = best.id;
      return this.flush();
    }
    // 2. skimming a star that is NOT valid: one soft "wrong" per visit, and not too often
    const near = this.nearest(x, y);
    if (near && near.d <= this.snap * 0.8 && near.id !== this.anchor) {
      if (this.over !== near.id) {
        this.over = near.id;
        const joined = this.edgeOf.get(key(this.anchor, near.id));
        if (joined !== undefined && this.drawn.includes(joined)) this.push({ type: 'already', star: near.id, t });
        else if (t - this.lastWrong >= WRONG_COOLDOWN) this.wrong(near.id, joined === undefined ? 'noLine' : 'notNext', t);
      }
    } else if (!near || near.d > this.snap) this.over = null;
    return this.flush();
  }

  /** the finger lifted (or the drag was cancelled): the half-made line goes away, everything drawn stays */
  release(t: number): EngineEvent[] {
    this.begin(t);
    if (this.dragging || this.anchor !== null) {
      const partial = this.dragging && this.finger !== null;
      this.dragging = false;
      this.finger = null;
      this.anchor = null;
      this.over = null;
      this.push({ type: 'release', t, partial });
    }
    return this.flush();
  }

  /** a tap on a star (or Enter on the keyboard's ring): pick it up, or join it to the picked-up star */
  tap(star: string | null, t: number): EngineEvent[] {
    this.begin(t);
    if (this.complete || star === null || !this.pos.has(star)) return this.flush();
    this.dragging = false;
    this.finger = null;
    if (this.anchor === null) {
      if (this.targetsFrom(star).length > 0) {
        this.anchor = star;
        this.push({ type: 'select', star, t });
      } else this.wrong(star, this.stuckReason(star), t);
      return this.flush();
    }
    if (star === this.anchor) {
      this.anchor = null;
      this.push({ type: 'deselect', star, t });
      return this.flush();
    }
    const i = this.edgeOf.get(key(this.anchor, star));
    if (i !== undefined && this.drawn.includes(i)) {
      this.push({ type: 'already', star, t });
    } else if (this.validEdge(this.anchor, star) >= 0) {
      this.join(this.anchor, star, t);
      if (!this.complete && this.targetsFrom(star).length === 0) this.anchor = null; // nothing more from here: let go of it
    } else if (this.targetsFrom(star).length > 0) {
      // not joinable from the picked-up star, but it is a star with lines left: pick THIS one up instead (forgiving: no scold)
      this.push({ type: 'deselect', star: this.anchor, t });
      this.anchor = star;
      this.push({ type: 'select', star, t });
    } else this.wrong(star, this.stuckReason(star), t);
    return this.flush();
  }

  /** take back the last line (not once the shape is complete) */
  undo(t: number): EngineEvent[] {
    this.begin(t);
    if (this.complete || this.drawn.length === 0) return this.flush();
    const edge = this.drawn.pop()!;
    this.dragging = false;
    this.finger = null;
    this.anchor = null;
    this.push({ type: 'undo', edge, t, drawn: this.drawn.length });
    return this.flush();
  }

  /** start again, keeping nothing */
  reset(t: number): EngineEvent[] {
    this.begin(t);
    this.drawn.length = 0;
    this.anchor = null;
    this.dragging = false;
    this.finger = null;
    this.complete = false;
    this.over = null;
    this.push({ type: 'reset', t });
    return this.flush();
  }

  /** let time pass (seconds, absolute). Raises the hint after `hintAfter` s of nothing. */
  tick(t: number): EngineEvent[] {
    if (!Number.isFinite(t)) return [];
    if (t < this.lastT) t = this.lastT;
    this.lastT = t;
    if (!this.complete && this.hint === null && !this.dragging && t - this.lastInput >= this.hintAfter) {
      const h = this.pickHint();
      if (h) {
        this.hint = h;
        this.push({ type: 'hint', ...h, t });
      }
    }
    return this.flush();
  }

  // ---- inside ---------------------------------------------------------------------------------------------------------------------------
  private begin(t: number): void {
    if (Number.isFinite(t)) {
      if (t < this.lastT) t = this.lastT;
      this.lastT = t;
      this.lastInput = t;
    }
    if (this.hint) {
      this.hint = null;
      this.push({ type: 'hintEnd', t: this.lastT });
    }
  }

  private finite(x: number, y: number): boolean {
    return Number.isFinite(x) && Number.isFinite(y);
  }

  private join(from: string, to: string, t: number): void {
    const edge = this.edgeOf.get(key(from, to))!;
    this.drawn.push(edge);
    this.anchor = to;
    this.push({ type: 'connect', edge, from, to, t, drawn: this.drawn.length, of: this.def.edges.length });
    if (this.drawn.length === this.def.edges.length) {
      this.complete = true;
      this.dragging = false;
      this.finger = null;
      this.anchor = null;
      this.push({ type: 'complete', t });
    }
  }

  private stuckReason(star: string): 'noLine' | 'notNext' | 'done' {
    let any = false;
    let left = false;
    this.def.edges.forEach(([a, b], i) => {
      if (a !== star && b !== star) return;
      any = true;
      if (!this.drawn.includes(i)) left = true;
    });
    if (!any) return 'noLine';
    return left ? 'notNext' : 'done';
  }

  private wrong(star: string, why: 'noLine' | 'notNext' | 'notJoined' | 'done', t: number): void {
    this.lastWrong = t;
    this.push({ type: 'wrong', star, why, t });
  }

  /** ordered: the next line. Unordered: a line out of the star the viewer last reached, else the first one left. */
  private pickHint(): { from: string; to: string; edge: number } | null {
    const nextIdx = this.def.order ? this.def.order[this.drawn.length] : undefined;
    if (nextIdx !== undefined) {
      const [a, b] = this.def.edges[nextIdx]!;
      const last = this.drawn.length ? this.def.edges[this.drawn[this.drawn.length - 1]!]! : null;
      const from = last && (last[0] === b || last[1] === b) && !(last[0] === a || last[1] === a) ? b : a;
      return { from, to: from === a ? b : a, edge: nextIdx };
    }
    if (this.drawn.length) {
      const [la, lb] = this.def.edges[this.drawn[this.drawn.length - 1]!]!;
      for (const reach of [lb, la]) {
        const to = this.targetsFrom(reach)[0];
        if (to !== undefined) return { from: reach, to, edge: this.edgeOf.get(key(reach, to))! };
      }
    }
    for (let i = 0; i < this.def.edges.length; i++) {
      if (!this.drawn.includes(i)) {
        const [a, b] = this.def.edges[i]!;
        return { from: a, to: b, edge: i };
      }
    }
    return null;
  }

  private push(e: EngineEvent): void {
    this.out.push(e);
    this.log.push(e);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }
  private flush(): EngineEvent[] {
    const o = this.out;
    this.out = [];
    return o;
  }
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
