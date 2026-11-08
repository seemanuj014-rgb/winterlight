// Phase 18: the keyboard way through the whole card. Pure (no three, no DOM, no clock).
// Everything a finger can do, keys can do, through the SAME gesture classifier (so a held Enter is a hold, a tap of Space is a tap):
//   Tab / Shift+Tab, Right / Down, Left / Up   move the focus along the targets (the ends of Tab let go, so focus is never trapped in the canvas)
//   Enter or Space                             press on the focused target (the first target if none is focused yet)
//   an arrow while Enter / Space is held       drags by 40 px a press
//   Escape                                     cancels what is being held, or clears the focus
// The adapter turns keys into focus changes and synthetic pointer samples (id -1, kind 'key'); input.ts feeds the samples to the classifier.

import type { Sample } from './gestureMath';

export type KeyAction = { kind: 'focus'; id: string | null; index: number } | { kind: 'sample'; sample: Sample } | { kind: 'cancel' };

export interface KeyInput {
  key: string;
  type: 'down' | 'up';
  repeat?: boolean;
  shift?: boolean;
  /** Ctrl, Alt or Meta: the browser's own shortcuts, not ours */
  modified?: boolean;
  /** ms */
  t: number;
}

export interface KeyResult {
  actions: KeyAction[];
  /** true = the page should call preventDefault (we used the key) */
  handled: boolean;
}

export const KEY_POINTER_ID = -1;
export const KEY_NUDGE_PX = 40;

const NEXT = new Set(['ArrowRight', 'ArrowDown']);
const PREV = new Set(['ArrowLeft', 'ArrowUp']);
const PRESS = new Set(['Enter', ' ', 'Spacebar']);

export interface KeyboardNavOptions {
  /** the targets that can be focused now, in reading order */
  ids: () => readonly string[];
  /** where a target is on screen (px), or null if it is not visible */
  positionOf: (id: string) => { x: number; y: number } | null;
  nudgePx?: number;
}

export class KeyboardNav {
  private focus: string | null = null;
  private held: { key: string; x: number; y: number } | null = null;
  private readonly o: KeyboardNavOptions;
  private readonly nudge: number;

  constructor(o: KeyboardNavOptions) {
    this.o = o;
    this.nudge = o.nudgePx ?? KEY_NUDGE_PX;
  }

  get focusId(): string | null {
    return this.focus;
  }
  get pressing(): boolean {
    return this.held !== null;
  }

  /** the mouse or a finger took over: the ring goes away */
  clearFocus(): KeyAction[] {
    if (this.focus === null) return [];
    this.focus = null;
    return [{ kind: 'focus', id: null, index: -1 }];
  }

  private setFocus(i: number, ids: readonly string[]): KeyAction[] {
    const id = ids[i] ?? null;
    if (id === this.focus) return [];
    this.focus = id;
    return [{ kind: 'focus', id, index: id === null ? -1 : i }];
  }

  key(e: KeyInput): KeyResult {
    const none: KeyResult = { actions: [], handled: false };
    if (e.modified) return none;
    const ids = this.o.ids();
    const actions: KeyAction[] = [];

    // the focused thing went away (a target was removed by the act): drop the ring, and any press on it
    if (this.focus !== null && !ids.includes(this.focus)) {
      if (this.held) {
        actions.push({ kind: 'sample', sample: this.sample('cancel', this.held.x, this.held.y, e.t) });
        this.held = null;
      }
      actions.push(...this.clearFocus());
    }

    if (e.type === 'up') {
      if (this.held && e.key === this.held.key) {
        actions.push({ kind: 'sample', sample: this.sample('up', this.held.x, this.held.y, e.t) });
        this.held = null;
        return { actions, handled: true };
      }
      return { actions, handled: actions.length > 0 };
    }

    if (e.key === 'Escape') {
      if (this.held) {
        actions.push({ kind: 'sample', sample: this.sample('cancel', this.held.x, this.held.y, e.t) });
        this.held = null;
        actions.push({ kind: 'cancel' });
        return { actions, handled: true };
      }
      const cleared = this.clearFocus();
      return { actions: [...actions, ...cleared], handled: cleared.length > 0 };
    }

    if (PRESS.has(e.key)) {
      if (e.repeat) return { actions, handled: true }; // auto-repeat must not re-press or re-focus
      if (ids.length === 0) return { actions, handled: actions.length > 0 };
      if (this.focus === null) {
        actions.push(...this.setFocus(0, ids));
        return { actions, handled: true };
      }
      const at = this.o.positionOf(this.focus);
      if (!at) return { actions, handled: true };
      this.held = { key: e.key, x: at.x, y: at.y };
      actions.push({ kind: 'sample', sample: this.sample('down', at.x, at.y, e.t) });
      return { actions, handled: true };
    }

    const forward = NEXT.has(e.key) || (e.key === 'Tab' && !e.shift);
    const back = PREV.has(e.key) || (e.key === 'Tab' && !!e.shift);
    if (!forward && !back) return { actions, handled: actions.length > 0 };

    if (this.held) {
      // arrows while pressing = drag; Tab does nothing while pressing
      if (e.key === 'Tab') return { actions, handled: true };
      const dx = e.key === 'ArrowRight' ? this.nudge : e.key === 'ArrowLeft' ? -this.nudge : 0;
      const dy = e.key === 'ArrowDown' ? this.nudge : e.key === 'ArrowUp' ? -this.nudge : 0;
      this.held.x += dx;
      this.held.y += dy;
      actions.push({ kind: 'sample', sample: this.sample('move', this.held.x, this.held.y, e.t) });
      return { actions, handled: true };
    }

    if (ids.length === 0) return { actions, handled: actions.length > 0 };
    const cur = this.focus === null ? -1 : ids.indexOf(this.focus);
    if (e.key === 'Tab') {
      // the ends let go, so Tab can leave the canvas
      const next = cur + (forward ? 1 : -1);
      if (cur === -1) {
        actions.push(...this.setFocus(forward ? 0 : ids.length - 1, ids));
        return { actions, handled: true };
      }
      if (next < 0 || next >= ids.length) {
        actions.push(...this.clearFocus());
        return { actions, handled: false };
      }
      actions.push(...this.setFocus(next, ids));
      return { actions, handled: true };
    }
    const n = ids.length;
    const to = cur === -1 ? (forward ? 0 : n - 1) : (cur + (forward ? 1 : -1) + n) % n;
    actions.push(...this.setFocus(to, ids));
    return { actions, handled: true };
  }

  /** the element lost focus or the page went away: let go of anything held, and clear the ring */
  blur(t: number): KeyAction[] {
    const out: KeyAction[] = [];
    if (this.held) {
      out.push({ kind: 'sample', sample: this.sample('cancel', this.held.x, this.held.y, t) });
      this.held = null;
    }
    out.push(...this.clearFocus());
    return out;
  }

  private sample(phase: Sample['phase'], x: number, y: number, t: number): Sample {
    return { id: KEY_POINTER_ID, phase, x, y, t, kind: 'key' };
  }
}
