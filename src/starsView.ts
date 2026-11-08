import * as THREE from 'three';
import type { Stage } from './core/renderer';
import { createBackdrop, placeBackdropCamera, type Backdrop } from './world/backdrop';
import { fitBackdropView } from './world/backdropMath';
import { createInput, createHaptics, type Input } from './input';
import { events } from './state/events';
import { createConstellationPlay, DEMO_DEFS, type ConstellationDef, type EngineEvent, type Play } from './constellations';

// Phase 21 test view: `?stars` = the night sky with ONE plain demo constellation (`?stars=path` is the ordered one) wired to the whole engine and the input layer.
// It is the proof for the phase, not part of the card (the five real shapes and where they sit come in Phase 22).
//   drag    press a star and drag to the next one; the line follows the finger and snaps on; let go and the half-made line goes away
//   tap     tap a star, then its neighbour
//   keys    Tab to a star, Enter picks it up, Tab / arrows to its neighbour, Enter joins them (a held Enter and the arrows also drag); `u` or the button takes back a line
// Test knobs: `&pre=<n>` draws the first n lines at once, `&drag=<star>@<x>,<y>` starts a drag from that star with the finger at that plane point (-1..1), `&at=<s>` runs that many
// seconds of fixed-step time and then freezes (8+ s with nothing touched = the hint), `&reduced`, `&nopost`, `&debug&tier=` as everywhere.
// State and events are on `window.__stars` (state(), log(), screenOf(id), planeAt(x, y)); the events are printed at the bottom of the page.

export interface StarsView {
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

declare global {
  interface Window {
    __stars?: { state(): Record<string, unknown>; log(): EngineEvent[]; screenOf(id: string): { x: number; y: number; radiusPx: number } | null; planeAt(x: number, y: number): { x: number; y: number } | null; draws(): number; input: Input };
  }
}

export function createStarsView(ctx: { stage: Stage; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean }): StarsView {
  const { scene, camera, canvas, params } = ctx;
  scene.background = new THREE.Color(0x0d1b2e);
  const pr = Math.min(window.devicePixelRatio || 1, ctx.stage.settings.maxPixelRatio);
  const backdrop: Backdrop = createBackdrop({ tier: ctx.stage.tier, reducedMotion: ctx.reduced, pixelRatio: pr });
  scene.add(backdrop.root);

  const which = params.get('stars') ?? '';
  const def: ConstellationDef = DEMO_DEFS[which] ?? DEMO_DEFS.kite!;
  const haptics = createHaptics();
  const lines: string[] = [];
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#d6ecff;background:rgba(5,10,20,.45);pointer-events:none;z-index:5;white-space:pre-wrap';
  const logEl = document.createElement('div');
  const btns = document.createElement('div');
  btns.style.cssText = 'pointer-events:auto;margin-top:4px;display:flex;gap:8px';
  const mkBtn = (id: string, text: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = text;
    b.style.cssText = 'font:inherit;padding:6px 10px;border-radius:6px;border:1px solid #6f86b8;background:#1c3556;color:#d6ecff';
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };
  ui.append(logEl, btns);
  if (!params.has('nohud')) document.body.appendChild(ui);
  const say = (e: EngineEvent): void => {
    lines.push(`${e.type}${'star' in e ? ' ' + e.star : ''}${'edge' in e ? ' #' + e.edge : ''}`);
    while (lines.length > 5) lines.shift();
    logEl.textContent = lines.join('\n');
  };

  // where the patch sits: centred in the sky above the view's middle, sized to the screen (a tall phone has more height than width)
  const placementFor = (aspect: number): { azDeg: number; elDeg: number; halfAngleDeg: number } => {
    const v = fitBackdropView(aspect);
    const halfV = v.fovDeg / 2;
    const halfAngleDeg = Math.min(v.halfHorizontalDeg * 0.66, halfV * 0.56);
    return { azDeg: 0, elDeg: v.pitchDeg + halfV * 0.34, halfAngleDeg };
  };
  placeBackdropCamera(camera, 1);
  const play: Play = createConstellationPlay({ scene, camera, def, placement: placementFor(1), tier: ctx.stage.tier, reducedMotion: ctx.reduced, pixelRatio: pr, haptics, bus: events, onEvent: say });
  const input = createInput({ element: canvas, resolve: play.resolve, keyboard: play.keyboard, label: 'constellation test view' });
  const detach = play.attach(input);
  mkBtn('btn-undo', 'undo', () => play.undo());
  mkBtn('btn-reset', 'reset', () => play.reset());
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'u' || e.key === 'U') play.undo();
  };
  canvas.addEventListener('keydown', onKey);

  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;display:none;border:2px solid #ffd9a0;border-radius:50%;pointer-events:none;z-index:4;transform:translate(-50%,-50%)';
  document.body.appendChild(ring);

  // ---- test knobs -----------------------------------------------------------------------------------------------------------------------
  let started = false;
  const FIXED = 1 / 60;
  let frozen = false;
  let t = 0;
  const kickoff = (): void => {
    if (started) return;
    started = true;
    const pre = Number(params.get('pre') ?? 0);
    const order = def.order ?? def.edges.map((_, i) => i);
    for (let i = 0; i < Math.min(pre, order.length); i++) {
      const [a, b] = def.edges[order[i]!]!;
      const pa = play.engine.position(a)!;
      const pb = play.engine.position(b)!;
      play.engine.beginDrag(a, pa.x, pa.y, 0);
      play.engine.move(pb.x, pb.y, 0);
      play.engine.release(0);
    }
    for (const e of play.engine.log) play.fx.onEvent(e);
    play.fx.snapTo(play.engine.state());
    const d = params.get('drag');
    if (d) {
      const m = /^(\w+)@(-?[\d.]+),(-?[\d.]+)$/.exec(d);
      if (m) for (const e of play.engine.beginDrag(m[1]!, Number(m[2]), Number(m[3]), 0)) play.fx.onEvent(e);
    }
    if (params.has('at')) {
      const steps = Math.round(Number(params.get('at')) / FIXED);
      for (let i = 0; i < steps; i++) play.update(FIXED);
      frozen = true;
    }
  };

  window.__stars = {
    state: () => ({ ...play.engine.state(), t: play.clock }),
    log: () => [...play.engine.log],
    screenOf: (id) => play.picker.screenOf(id),
    planeAt: (x, y) => play.planeAt(x, y),
    draws: () => play.fx.stats().drawCalls,
    input,
  };

  return {
    update(dt) {
      kickoff();
      if (frozen) return;
      t += dt;
      play.update(dt);
    },
    render(tSec) {
      backdrop.update(frozen ? Number(params.get('at') ?? 0) : tSec, camera);
      const f = input.focusId ? play.picker.screenOf(input.focusId) : null;
      if (f) {
        const r = canvas.getBoundingClientRect();
        const d = Math.max(36, f.radiusPx * 2 + 14);
        ring.style.display = 'block';
        ring.style.width = `${d}px`;
        ring.style.height = `${d}px`;
        ring.style.left = `${r.left + f.x}px`;
        ring.style.top = `${r.top + f.y}px`;
      } else ring.style.display = 'none';
    },
    resize(aspect, w, h) {
      backdrop.setPixelRatio(Math.min(window.devicePixelRatio || 1, ctx.stage.settings.maxPixelRatio));
      placeBackdropCamera(camera, aspect);
      play.setPlacement(placementFor(aspect));
      play.resize(w, h);
    },
    setTier(tier) {
      backdrop.setTier(tier);
      play.setTier(tier);
    },
    dispose() {
      detach();
      input.dispose();
      canvas.removeEventListener('keydown', onKey);
      play.dispose();
      ui.remove();
      ring.remove();
      void t;
    },
  };
}
