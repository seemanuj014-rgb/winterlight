// A thumb joystick for walking, bottom-left. Plain DOM; it reports a vector (x right, y forward, each -1..1) and nothing else. It has its own pointer, so a finger on it never turns the view
// and a finger on the view never moves it. Hidden until `show(true)`. No words.
export interface Joystick {
  readonly el: HTMLElement;
  /** the current push, -1..1 on each axis (0,0 when let go) */
  value(): { x: number; y: number };
  show(on: boolean): void;
  dispose(): void;
}

export function createJoystick(parent: HTMLElement = document.body, onTurnAround?: () => void): Joystick {
  const base = document.createElement('div');
  base.setAttribute('aria-hidden', 'true');
  base.style.cssText =
    'position:fixed;left:calc(18px + env(safe-area-inset-left,0px));bottom:calc(22px + env(safe-area-inset-bottom,0px));width:112px;height:112px;border-radius:50%;' +
    'background:rgba(207,227,242,.14);border:1.5px solid rgba(207,227,242,.35);touch-action:none;user-select:none;-webkit-user-select:none;z-index:15;display:none;';
  const knob = document.createElement('div');
  knob.style.cssText =
    'position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;background:rgba(207,227,242,.55);box-shadow:0 2px 10px rgba(0,0,0,.3);pointer-events:none;';
  base.append(knob);
  parent.append(base);
  // a small round button above the stick: a half turn on the spot (so "look behind me" is one tap)
  const turn = document.createElement('button');
  turn.type = 'button';
  turn.setAttribute('aria-label', 'turn around');
  turn.textContent = '\u21BB';
  turn.style.cssText =
    'position:fixed;left:calc(60px + env(safe-area-inset-left,0px));bottom:calc(144px + env(safe-area-inset-bottom,0px));width:44px;height:44px;border-radius:50%;font:22px/1 system-ui,sans-serif;' +
    'color:#cfe3f2;background:rgba(207,227,242,.14);border:1.5px solid rgba(207,227,242,.35);touch-action:manipulation;z-index:15;display:none;padding:0;';
  turn.addEventListener('click', () => onTurnAround?.());
  parent.append(turn);
  let id: number | null = null;
  let vx = 0;
  let vy = 0;
  const R = 44;
  const set = (cx: number, cy: number): void => {
    const r = base.getBoundingClientRect();
    let dx = cx - (r.left + r.width / 2);
    let dy = cy - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    vx = dx / R;
    vy = -dy / R;
    knob.style.transform = `translate(${dx}px,${dy}px)`;
  };
  const reset = (): void => {
    id = null;
    vx = vy = 0;
    knob.style.transform = '';
  };
  const down = (e: PointerEvent): void => {
    if (id !== null) return;
    id = e.pointerId;
    try {
      base.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    set(e.clientX, e.clientY);
    e.preventDefault();
  };
  const move = (e: PointerEvent): void => {
    if (e.pointerId === id) set(e.clientX, e.clientY);
  };
  const up = (e: PointerEvent): void => {
    if (e.pointerId === id) reset();
  };
  base.addEventListener('pointerdown', down);
  base.addEventListener('pointermove', move);
  base.addEventListener('pointerup', up);
  base.addEventListener('pointercancel', up);
  return {
    el: base,
    value: () => ({ x: vx, y: vy }),
    show(on) {
      base.style.display = on ? 'block' : 'none';
      turn.style.display = on && onTurnAround ? 'block' : 'none';
      if (!on) reset();
    },
    dispose() {
      base.remove();
      turn.remove();
    },
  };
}
