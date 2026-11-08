import type { StayAwhileAct } from './stayAwhile';
import type { StayWorld } from './stayWorld';
import { STAY_WORLD } from './stayWorldMath';

// Phase 28: the page's hands for stay a while. Plain DOM events, no three, no draw calls, no words. It feeds `StayWorld.drag` / `key` and nothing else.
//   * a one-finger (or mouse) drag on the stage turns the view (the world follows the finger); a second finger is ignored; it never calls preventDefault on a tap
//   * the arrow keys and Home turn / recentre the view, but ONLY when the key is not meant for something else: not when a button, link, field or dialog has the focus (so Enter, Space and
//     the arrows in the letter reader or the replay column keep their own meaning), not with Ctrl / Alt / Meta held, and not when something else already handled it
//   * it does nothing at all unless she is staying, and it can never remove an exit: it has no way to reach them
// The view sets `touch-action: none` on the stage so a drag is not taken for a scroll (the view's job; the CSS is not here).

interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  button?: number;
  target?: unknown;
}
interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
  preventDefault(): void;
}
type Listener<E> = (e: E) => void;
// the real `addEventListener` takes a listener for a DOM event type; this loose one lets the real canvas and window be passed in as they are
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyListener = (e: any) => void;
export interface StageLike {
  addEventListener(type: string, fn: AnyListener, opts?: unknown): void;
  removeEventListener(type: string, fn: AnyListener, opts?: unknown): void;
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
  readonly clientWidth?: number;
}
export interface KeyTargetLike {
  addEventListener(type: string, fn: AnyListener, opts?: unknown): void;
  removeEventListener(type: string, fn: AnyListener, opts?: unknown): void;
}

export interface StayInputOptions {
  stay: StayAwhileAct;
  world: StayWorld;
  /** the element a drag happens on (the canvas) */
  stage: StageLike;
  /** where keys are heard (the window) */
  keys: KeyTargetLike;
  /** the screen's width in px for the drag scale (a function, so a resize is seen) */
  width: () => number;
  /** Phase 28: a press that something else owns (a press ON an animal pets it): if this says yes the press is NOT the start of a turn. Never used for keys. */
  claim?: (clientX: number, clientY: number, pointerType?: string) => boolean;
}

const OWN_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home']);
/** free roaming on a keyboard: W / S walk forward / back, A / D step left / right */
const WALK_KEYS: Record<string, [number, number]> = { w: [1, 0], s: [-1, 0], a: [0, -1], d: [0, 1] };
const OTHERS = 'button, a, input, textarea, select, [contenteditable], [role="dialog"], [role="dialog"] *, dialog, dialog *';

/** is this key for something other than the view? (the focused thing is a control, a field, the letter reader or any dialog) */
export function keyBelongsToSomethingElse(target: unknown): boolean {
  const t = target as { closest?: (s: string) => unknown } | null | undefined;
  if (!t || typeof t.closest !== 'function') return false;
  try {
    return !!t.closest(OTHERS);
  } catch {
    return false;
  }
}

export function createStayInput(o: StayInputOptions): { dispose(): void } {
  let id: number | null = null;
  let lx = 0;
  let ly = 0;
  // two fingers = a pinch: spreading them walks forward (zooms in), pinching walks back. The first finger's turn pauses while it lasts.
  const pts = new Map<number, { x: number; y: number }>();
  let pinchDist: number | null = null;
  const spread = (): number => {
    const [a, b] = [...pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const down: Listener<PointerLike> = (e) => {
    if (!o.stay.machine.staying) return;
    if (id !== null && e.pointerId !== id && pts.size === 1 && (e.button === undefined || e.button === 0)) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinchDist = spread();
      return;
    }
    if (id !== null) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (o.claim && o.claim(e.clientX, e.clientY, (e as { pointerType?: string }).pointerType)) return;
    id = e.pointerId;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lx = e.clientX;
    ly = e.clientY;
    try {
      o.stage.setPointerCapture?.(e.pointerId);
    } catch {
      /* a pointer that is already gone is fine */
    }
  };
  const move: Listener<PointerLike> = (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchDist !== null) {
      if (!o.stay.machine.staying) {
        pinchDist = null;
        return;
      }
      const d = spread();
      o.world.zoom(d - pinchDist, STAY_WORLD.pinchMPerPx);
      pinchDist = d;
      lx = e.clientX;
      ly = e.clientY;
      return;
    }
    if (id === null || e.pointerId !== id) return;
    if (!o.stay.machine.staying) {
      id = null;
      return;
    }
    o.world.drag(e.clientX - lx, e.clientY - ly, o.width());
    lx = e.clientX;
    ly = e.clientY;
  };
  const up: Listener<PointerLike> = (e) => {
    pts.delete(e.pointerId);
    if (pinchDist !== null) {
      // a finger left the pinch: the turn starts fresh (no jump) on the next press
      if (pts.size < 2) {
        pinchDist = null;
        pts.clear();
        id = null;
      }
      return;
    }
    if (id === null || e.pointerId !== id) return;
    try {
      o.stage.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    id = null;
  };
  const wheel: Listener<{ deltaY: number; preventDefault(): void }> = (e) => {
    if (!o.stay.machine.staying || !Number.isFinite(e.deltaY)) return;
    o.world.zoom(-e.deltaY);
    e.preventDefault();
  };
  const key: Listener<KeyLike> = (e) => {
    const step = WALK_KEYS[e.key.length === 1 ? e.key.toLowerCase() : ''];
    if (step && o.stay.machine.staying && !e.defaultPrevented && !e.ctrlKey && !e.altKey && !e.metaKey && !keyBelongsToSomethingElse(e.target)) {
      o.world.walk(step[0] * STAY_WORLD.keyWalkM, step[1] * STAY_WORLD.keyWalkM);
      e.preventDefault();
      return;
    }
    if (!o.stay.machine.staying || !OWN_KEYS.has(e.key)) return;
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    if (keyBelongsToSomethingElse(e.target)) return;
    o.world.key(e.key);
    e.preventDefault();
  };

  const pairs: Array<[string, AnyListener]> = [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
    ['wheel', wheel as AnyListener],
  ];
  for (const [t, f] of pairs) o.stage.addEventListener(t, f);
  o.keys.addEventListener('keydown', key);
  return {
    dispose() {
      for (const [t, f] of pairs) o.stage.removeEventListener(t, f);
      o.keys.removeEventListener('keydown', key);
      id = null;
      pts.clear();
      pinchDist = null;
    },
  };
}
