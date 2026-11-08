import { createBus, type Bus } from '../state/events';
import { GestureClassifier, normalizePointer, type GestureConfig, type GestureEvent, type PointerKind, type Sample } from './gestureMath';
import { KeyboardNav, type KeyAction } from './keyboardMath';

// Phase 18: the one input layer. Touch, mouse, pen and keyboard all come out as the same gestures (press, tap, hold, drag, cancel), each carrying the
// target that was under the finger when it began. Meaning (what a hold does) is the acts' business; this file only says what happened and where.
//
// What it does for you: touch-action none (the browser never scrolls or zooms under a gesture), no text selection or callout or context menu on a long press,
// pointer capture (a drag that leaves the canvas still ends properly), a second finger cancels, losing focus or hiding the page cancels, and a thrown error in a
// listener never stops the others (the bus).

export interface GesturePayload extends GestureEvent {
  /** id of the target under the finger when the gesture began (kept for the whole gesture), or null */
  target: string | null;
}

export interface InputEvents {
  press: GesturePayload;
  tap: GesturePayload;
  holdstart: GesturePayload;
  holdend: GesturePayload;
  dragstart: GesturePayload;
  drag: GesturePayload;
  dragend: GesturePayload;
  cancel: GesturePayload;
  /** keyboard focus moved (null = no ring) */
  focus: { id: string | null; index: number };
}

export interface PointerState {
  /** -1..1 across the element, y UP */
  x: number;
  y: number;
  /** a finger is down, or the mouse is over the element */
  active: boolean;
  kind: PointerKind | 'none';
}

export interface InputOptions {
  element: HTMLElement;
  /** which target is at this point (px in the element's box), or null. Usually `picker.pick`. */
  resolve?: (x: number, y: number, kind: PointerKind) => string | null;
  /** the keyboard's way through the targets. Omit to leave the keyboard to the page. */
  keyboard?: { ids: () => readonly string[]; positionOf: (id: string) => { x: number; y: number } | null };
  gesture?: Partial<GestureConfig>;
  /** the label a screen reader says for the canvas (the owner's words come from content/; there is no default) */
  label?: string;
}

export interface Input {
  readonly bus: Bus<InputEvents>;
  on: Bus<InputEvents>['on'];
  /** where the pointer is, updated on every move, hover included */
  readonly pointer: PointerState;
  readonly focusId: string | null;
  /** ignore everything (and cancel what is in progress) while false, e.g. during a cut-scene */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  dispose(): void;
}

const kindOf = (t: string): PointerKind => (t === 'mouse' || t === 'pen' ? t : 'touch');

export function createInput(opts: InputOptions): Input {
  const el = opts.element;
  const bus = createBus<InputEvents>();
  const cls = new GestureClassifier(opts.gesture);
  const pointer: PointerState = { x: 0, y: 0, active: false, kind: 'none' };
  let enabled = true;
  let target: string | null = null;
  let timer = 0;
  const now = (): number => performance.now();

  // ---- the element --------------------------------------------------------------------------------------------------------------------
  const st = el.style;
  st.touchAction = 'none';
  st.userSelect = 'none';
  (st as unknown as Record<string, string>).webkitUserSelect = 'none';
  (st as unknown as Record<string, string>).webkitTouchCallout = 'none';
  (st as unknown as Record<string, string>).webkitTapHighlightColor = 'transparent';
  const hadTabIndex = el.hasAttribute('tabindex');
  if (opts.keyboard && !hadTabIndex) el.tabIndex = 0;
  if (opts.label !== undefined) {
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', opts.label);
  }

  const local = (e: { clientX: number; clientY: number }): { x: number; y: number; w: number; h: number } => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  // ---- gesture events -> the bus -------------------------------------------------------------------------------------------------------
  const emit = (events: GestureEvent[]): void => {
    for (const g of events) bus.emit(g.type, { ...g, target });
    schedule();
  };

  /** the hold timer follows what the classifier says it is waiting for */
  function schedule(): void {
    window.clearTimeout(timer);
    timer = 0;
    const due = cls.holdDeadline();
    if (due === null) return;
    timer = window.setTimeout(() => emit(cls.tick(now())), Math.max(0, due - now()) + 2);
  }

  const feed = (s: Sample): void => {
    if (!enabled) return;
    if (s.phase === 'down' && !cls.ignoring && cls.state === 'idle') {
      // the target is decided at the moment of the press and then kept for the whole gesture
      const picked = opts.resolve ? opts.resolve(s.x, s.y, s.kind) : null;
      const events = cls.push(s);
      target = picked;
      for (const g of events) bus.emit(g.type, { ...g, target });
      schedule();
      return;
    }
    emit(cls.push(s));
  };

  const cancelAll = (): void => {
    const events = cls.reset(now());
    for (const g of events) bus.emit(g.type, { ...g, target });
    schedule();
    applyKeys(nav?.blur(now()) ?? []);
  };

  // ---- pointer events ----------------------------------------------------------------------------------------------------------------
  const onDown = (e: PointerEvent): void => {
    const p = local(e);
    const kind = kindOf(e.pointerType);
    pointer.kind = kind;
    pointer.active = true;
    Object.assign(pointer, normalizePointer(p.x, p.y, p.w, p.h));
    if (e.pointerType === 'mouse' && e.button !== 0) return; // only the main button is a gesture
    applyKeys(nav?.clearFocus() ?? []); // a touch or a click takes over from the keyboard ring
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers refuse for synthetic pointers; the gesture still works inside the element */
    }
    feed({ id: e.pointerId, phase: 'down', x: p.x, y: p.y, t: now(), kind });
  };
  const onMove = (e: PointerEvent): void => {
    const p = local(e);
    pointer.kind = kindOf(e.pointerType);
    pointer.active = true;
    Object.assign(pointer, normalizePointer(p.x, p.y, p.w, p.h));
    feed({ id: e.pointerId, phase: 'move', x: p.x, y: p.y, t: now(), kind: pointer.kind as PointerKind });
  };
  const onUp = (e: PointerEvent): void => {
    const p = local(e);
    const kind = kindOf(e.pointerType);
    if (e.pointerType !== 'mouse') pointer.active = false; // a finger that is up is not "pointing"; a mouse still hovers
    feed({ id: e.pointerId, phase: 'up', x: p.x, y: p.y, t: now(), kind });
  };
  const onCancel = (e: PointerEvent): void => {
    const p = local(e);
    if (e.pointerType !== 'mouse') pointer.active = false;
    feed({ id: e.pointerId, phase: 'cancel', x: p.x, y: p.y, t: now(), kind: kindOf(e.pointerType) });
  };
  const onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') pointer.active = false;
  };
  const stop = (e: Event): void => e.preventDefault();

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onCancel as EventListener); // after a normal 'up' the classifier already ignores this one
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('contextmenu', stop); // a long press must not open a menu
  el.addEventListener('dragstart', stop);
  el.addEventListener('selectstart', stop);
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') cancelAll();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('blur', cancelAll);

  // ---- keyboard ----------------------------------------------------------------------------------------------------------------------
  const nav = opts.keyboard ? new KeyboardNav(opts.keyboard) : null;
  function applyKeys(actions: KeyAction[]): void {
    for (const a of actions) {
      if (a.kind === 'focus') bus.emit('focus', { id: a.id, index: a.index });
      else if (a.kind === 'sample') {
        if (a.sample.phase === 'down') {
          // the keyboard's target is the focused id, not a pick
          if (!enabled) continue;
          const events = cls.push(a.sample);
          target = nav?.focusId ?? null;
          for (const g of events) bus.emit(g.type, { ...g, target });
          schedule();
        } else feed(a.sample);
      }
      // 'cancel' (Escape while pressing): the sample cancel already ended the gesture
    }
  }
  const onKey = (type: 'down' | 'up') => (e: KeyboardEvent): void => {
    if (!nav) return;
    const r = nav.key({ key: e.key, type, repeat: e.repeat, shift: e.shiftKey, modified: e.ctrlKey || e.altKey || e.metaKey, t: now() });
    applyKeys(r.actions);
    if (r.handled) e.preventDefault();
  };
  const kd = onKey('down');
  const ku = onKey('up');
  const kb = (): void => applyKeys(nav?.blur(now()) ?? []);
  if (nav) {
    el.addEventListener('keydown', kd);
    el.addEventListener('keyup', ku);
    el.addEventListener('blur', kb);
  }

  return {
    bus,
    on: bus.on,
    pointer,
    get focusId() {
      return nav?.focusId ?? null;
    },
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      if (on === enabled) return;
      if (!on) cancelAll();
      enabled = on;
    },
    dispose() {
      window.clearTimeout(timer);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onCancel as EventListener);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('contextmenu', stop);
      el.removeEventListener('dragstart', stop);
      el.removeEventListener('selectstart', stop);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', cancelAll);
      if (nav) {
        el.removeEventListener('keydown', kd);
        el.removeEventListener('keyup', ku);
        el.removeEventListener('blur', kb);
        if (!hadTabIndex) el.removeAttribute('tabindex');
      }
      bus.clear();
    },
  };
}
