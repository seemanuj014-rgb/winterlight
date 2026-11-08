import * as THREE from 'three';
import type { Stage } from './core/renderer';
import { createBackdrop, placeBackdropCamera, type Backdrop } from './world/backdrop';
import { createInput, createHaptics, type Input } from './input';
import { createSky, type Sky } from './constellations/sky';
import type { EngineEvent } from './constellations';
import { skyViewFor } from './constellations/skyLayoutMath';
import { loadContent } from './content';
import { createProgress, type ProgressStore } from './state/progress';
import { events } from './state/events';
import { createSkyText, type SkyText } from './ui/skyText';
import { replayControls } from './ui/replayControls';

// Phase 22 test view: `?sky` = the night sky with the five names (Strawberry, Bumblebee, Rose, Kaaju Katli, Cutie Patootie) as five shapes to connect, each opening its wish card.
// It is the proof for the phase and the first draft of how the sky act will be wired (Phase 28 will own the real thing).
//   drag / tap / keys   exactly as in `?stars` (Phase 21), over all five shapes; finish one and its name appears under it and its wish card opens (tap it or Esc to put it away)
//   a finished shape is saved (localStorage); reload and it comes back finished, silently; tap one of its stars and its wish shows again
// Test knobs: `&done=<id,id>` mark those shapes finished before the page starts (they are saved), `&fresh` forget all progress first, `&pre=<id>:<n>` draw the first n lines of one
// shape (not saved), `&drag=<star>@<x>,<y>` start a drag from a star with the finger at that plane point, `&at=<s>` run that many seconds and freeze, `&reduced`, `&nopost`, `&nohud`,
// `&debug&tier=`. State, events, names and the card are on `window.__sky`; the last events are printed at the bottom of the page.

export interface SkyView {
  /** Phase 28: the sky's events (the card listens for the five shapes being done) */
  readonly bus: typeof events;
  /** how many of the five names are done now (the card hands over at five) */
  doneCount(): number;
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

declare global {
  interface Window {
    __sky?: {
      state(): Record<string, { drawn: number; of: number; complete: boolean; anchor: string | null; dragging: boolean; hint: boolean }>;
      done(): string[];
      log(): { id: string; type: string; star?: string }[];
      screenOf(star: string): { x: number; y: number; radiusPx: number } | null;
      labelAnchor(id: string): { x: number; y: number } | null;
      edges(id: string): [string, string][];
      draws(): number;
      card(): { open: boolean; id: string | null; text: string };
      named(): string[];
      persisted(): string[];
      current(): string | null;
      t(): number;
      input: Input;
    };
  }
}

export function createSkyView(ctx: { stage: Stage; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; params: URLSearchParams; reduced: boolean }): SkyView {
  const { scene, camera, canvas, params } = ctx;
  scene.background = new THREE.Color(0x0d1b2e);
  const pr = Math.min(window.devicePixelRatio || 1, ctx.stage.settings.maxPixelRatio);
  const backdrop: Backdrop = createBackdrop({ tier: ctx.stage.tier, reducedMotion: ctx.reduced, pixelRatio: pr });
  scene.add(backdrop.root);

  const { content } = loadContent();
  const cons = content.names.constellations;
  const nameOf: Record<string, string> = {};
  for (const c of cons) nameOf[c.id] = c.name;
  const progress: ProgressStore = createProgress({ knownConstellations: cons.map((c) => c.id) });
  if (params.has('fresh')) progress.reset();
  for (const id of (params.get('done') ?? '').split(',').filter(Boolean)) progress.markConstellation(id);

  const haptics = createHaptics();
  const lines: string[] = [];
  const log: { id: string; type: string; star?: string }[] = [];
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#d6ecff;background:rgba(5,10,20,.45);pointer-events:none;z-index:5;white-space:pre-wrap';
  const logEl = document.createElement('div');
  ui.append(logEl);
  if (!params.has('nohud')) document.body.appendChild(ui);
  const say = (id: string, e: EngineEvent): void => {
    log.push({ id, type: e.type, star: 'star' in e ? e.star : undefined });
    if (log.length > 400) log.shift();
    lines.push(`${id} ${e.type}${'star' in e ? ' ' + e.star : ''}`);
    while (lines.length > 4) lines.shift();
    logEl.textContent = lines.join('\n');
  };

  const aspect0 = Math.max(0.2, (window.innerWidth || 390) / Math.max(1, window.innerHeight || 780));
  placeBackdropCamera(camera, aspect0, 0, skyViewFor(aspect0).extraPitchDeg);
  // Phase 23: the sound comes back up when the wish card is put away. A queued second card opens inside the same close, so look once everything has settled.
  const text: SkyText = createSkyText({
    canvas,
    names: nameOf,
    wishes: content.wishes,
    reducedMotion: ctx.reduced,
    onCard: (open) => {
      if (!open) queueMicrotask(() => { if (!text.open) events.emit('wish:hide'); });
    },
  });
  const sky: Sky = createSky({
    scene,
    camera,
    constellations: cons,
    progress,
    bus: events,
    tier: ctx.stage.tier,
    reducedMotion: ctx.reduced,
    pixelRatio: pr,
    aspect: aspect0,
    haptics,
    onEvent: say,
    onComplete: (id) => text.showName(id),
  });
  const offWish = events.on('wish:show', ({ id }) => text.showWish(id));
  // Phase 24: the wishes replay button. It appears once a shape is finished; a press shows every finished shape's wish again, in the order they were found (the card queues them).
  const replay = replayControls();
  const showReplay = (): void => replay.setVisible('wishes', sky.doneIds.length > 0);
  replay.add('wishes', () => {
    for (const id of cons.map((c) => c.id)) if (sky.doneIds.includes(id)) events.emit('wish:show', { id });
  }, { visible: false });
  const offDone = events.on('constellation:done', () => queueMicrotask(showReplay));
  const input = createInput({ element: canvas, resolve: sky.resolve, keyboard: sky.keyboard, label: 'the sky: five constellations to connect' });
  const detach = sky.attach(input);
  // shapes finished on an earlier visit: their names are simply there
  for (const id of sky.doneIds) text.showName(id, true);
  showReplay();

  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;display:none;border:2px solid #ffd9a0;border-radius:50%;pointer-events:none;z-index:4;transform:translate(-50%,-50%)';
  document.body.appendChild(ring);

  // ---- test knobs -----------------------------------------------------------------------------------------------------------------------
  let started = false;
  let frozen = false;
  let t = 0;
  const FIXED = 1 / 60;
  const kickoff = (): void => {
    if (started) return;
    started = true;
    const pre = params.get('pre');
    const pm = pre ? /^([\w-]+):(\d+)$/.exec(pre) : null;
    if (pm && cons.some((c) => c.id === pm[1])) {
      const p = sky.play(pm[1]!);
      const order = p.engine.def.order ?? p.engine.def.edges.map((_, i) => i);
      for (let i = 0; i < Math.min(Number(pm[2]), order.length - 1); i++) {
        const [a, b] = p.engine.def.edges[order[i]!]!;
        const pa = p.engine.position(a)!;
        const pb = p.engine.position(b)!;
        p.engine.beginDrag(a, pa.x, pa.y, 0);
        p.engine.move(pb.x, pb.y, 0);
        p.engine.release(0);
      }
      p.fx.snapTo(p.engine.state());
    }
    const d = params.get('drag');
    const dm = d ? /^([\w-]+)@(-?[\d.]+),(-?[\d.]+)$/.exec(d) : null;
    if (dm) {
      const c = sky.ownerOf(dm[1]!);
      if (c) for (const e of sky.play(c).engine.beginDrag(dm[1]!, Number(dm[2]), Number(dm[3]), 0)) sky.play(c).fx.onEvent(e);
    }
    if (params.has('at')) {
      const steps = Math.round(Number(params.get('at')) / FIXED);
      for (let i = 0; i < steps; i++) sky.update(FIXED);
      frozen = true;
    }
  };

  window.__sky = {
    state: () => {
      const o: ReturnType<NonNullable<Window['__sky']>['state']> = {};
      for (const id of sky.ids) {
        const s = sky.play(id).engine.state();
        o[id] = { drawn: s.drawn.length, of: sky.play(id).engine.def.edges.length, complete: s.complete, anchor: s.anchor, dragging: s.dragging, hint: s.hint !== null };
      }
      return o;
    },
    done: () => [...sky.doneIds],
    log: () => [...log],
    screenOf: (s) => sky.screenOf(s),
    labelAnchor: (id) => sky.labelAnchor(id),
    edges: (id) => sky.play(id).engine.def.edges.map(([a, b]) => [a, b] as [string, string]),
    draws: () => sky.drawCalls(),
    card: () => ({ open: text.open, id: text.current, text: (document.getElementById('wish-card')?.textContent ?? '') }),
    named: () => [...text.named],
    persisted: () => progress.get().constellations,
    current: () => sky.current(),
    t: () => t,
    input,
  };

  return {
    bus: events,
    doneCount: () => sky.doneIds.length,
    update(dt) {
      kickoff();
      if (frozen) return;
      t += dt;
      sky.update(dt);
    },
    render(tSec) {
      backdrop.update(frozen ? Number(params.get('at') ?? 0) : tSec, camera);
      const f = input.focusId ? sky.screenOf(input.focusId) : null;
      if (f) {
        const r = canvas.getBoundingClientRect();
        const dd = Math.max(36, f.radiusPx * 2 + 14);
        ring.style.display = 'block';
        ring.style.width = `${dd}px`;
        ring.style.height = `${dd}px`;
        ring.style.left = `${r.left + f.x}px`;
        ring.style.top = `${r.top + f.y}px`;
      } else ring.style.display = 'none';
      for (const id of text.named) text.place(id, sky.labelAnchor(id));
    },
    resize(aspect, w, h) {
      backdrop.setPixelRatio(Math.min(window.devicePixelRatio || 1, ctx.stage.settings.maxPixelRatio));
      placeBackdropCamera(camera, aspect, 0, skyViewFor(aspect).extraPitchDeg);
      sky.resize(w, h, aspect);
    },
    setTier(tier) {
      backdrop.setTier(tier);
      sky.setTier(tier);
    },
    dispose() {
      offWish();
      offDone();
      replay.dispose();
      detach();
      input.dispose();
      sky.dispose();
      text.dispose();
      ui.remove();
      ring.remove();
    },
  };
}
