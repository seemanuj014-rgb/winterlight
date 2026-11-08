import * as THREE from 'three';
import type { Input } from '../input';
import type { PointerKind } from '../input/gestureMath';
import type { Bus, WinterEvents } from '../state/events';
import type { ProgressStore } from '../state/progress';
import { createConstellationPlay, type Play } from './index';
import type { EngineEvent } from './engine';
import type { ConstellationDef } from './defs';
import type { Tier } from './fx';
import { SHAPES } from './shapes';
import { layoutFor } from './skyLayoutMath';
import { SkyRouter, currentShape } from './routeMath';

// Phase 22: the five names in the sky. One `createConstellationPlay` per shape, one input layer over all of them, progress that survives a reload.
//   - what the viewer sees: five patches of stars, placed by `skyLayoutMath` for the screen's shape; finish one and its name appears softly and its wish card opens
//   - input: ONE combined `resolve` (the nearest star on screen wins) and ONE `keyboard` (discovery order); `SkyRouter` decides which play each gesture belongs to
//   - progress: a finished shape is saved by id; on the next visit it is drawn finished at once (no burst, no buzz, no wish card), and tapping any of its stars shows its wish again
//   - hints: only the shape being worked on may glow a hint (five hints at once would be noise)
// The words (names, wishes) are the owner's and are only passed along; nothing in here writes any text.

export interface SkyOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** content/names.json `constellations` (id, name, shape key) in discovery order */
  constellations: readonly { id: string; name: string; shape: string }[];
  progress: ProgressStore;
  bus?: Bus<WinterEvents>;
  tier: Tier;
  reducedMotion: boolean;
  pixelRatio?: number;
  aspect: number;
  haptics?: { pulse(name: 'tick' | 'tap' | 'soft' | 'done'): void };
  /** every engine event of every shape, as it happens */
  onEvent?: (constellation: string, e: EngineEvent) => void;
  /** a shape was finished just now (not on a restore) */
  onComplete?: (constellation: string) => void;
  /** the five are all done (called once, and only when the last one is finished in this visit) */
  onAllDone?: () => void;
  /** a finished shape was tapped: show its wish again */
  onReshow?: (constellation: string) => void;
  /** test override: shapes by key (default = the five) */
  shapes?: Record<string, ConstellationDef>;
}

export interface Sky {
  readonly ids: readonly string[];
  play(id: string): Play;
  resolve: (x: number, y: number, kind: PointerKind) => string | null;
  keyboard: { ids: () => readonly string[]; positionOf: (id: string) => { x: number; y: number } | null };
  attach(input: Pick<Input, 'on'>): () => void;
  isDone(id: string): boolean;
  readonly doneIds: readonly string[];
  readonly allDone: boolean;
  /** which shape a star belongs to */
  ownerOf(star: string): string | null;
  /** the shape being worked on (the one that may hint), or null when all are done */
  current(): string | null;
  /** screen position (px) for a name label under a shape: the middle of it, just under its lowest star; null when off screen */
  labelAnchor(id: string): { x: number; y: number } | null;
  screenOf(star: string): { x: number; y: number; radiusPx: number } | null;
  update(dt: number, tSec?: number): void;
  resize(widthPx: number, heightPx: number, aspect: number): void;
  setTier(t: Tier): void;
  setPixelRatio(pr: number): void;
  drawCalls(): number;
  /** forget everything drawn and saved (the test view's `reset`) */
  reset(): void;
  dispose(): void;
}

/** draw a finished shape at once: replay its lines through the engine (silently), then show that state */
export function restoreShape(play: Play): void {
  const def = play.engine.def;
  const order = def.order ?? def.edges.map((_, i) => i);
  for (const i of order) {
    const [a, b] = def.edges[i]!;
    const pa = play.engine.position(a)!;
    const pb = play.engine.position(b)!;
    play.engine.beginDrag(a, pa.x, pa.y, 0);
    play.engine.move(pb.x, pb.y, 0);
    play.engine.release(0);
  }
  play.fx.snapTo(play.engine.state());
}

export function createSky(o: SkyOptions): Sky {
  const shapes = o.shapes ?? SHAPES;
  const ids = o.constellations.map((c) => c.id);
  const layout = layoutFor(o.aspect);
  const plays = new Map<string, Play>();
  const owner = new Map<string, string>();
  const done = new Set<string>();
  let restoring = true;
  let lastTouched: string | null = null;
  let allDoneFired = false;

  for (const c of o.constellations) {
    const def = shapes[c.shape];
    if (!def) throw new Error(`no shape "${c.shape}" for constellation "${c.id}"`);
    if (def.id !== c.id) throw new Error(`shape "${c.shape}" is for "${def.id}", not "${c.id}"`);
    const play = createConstellationPlay({
      scene: o.scene,
      camera: o.camera,
      def,
      placement: layout[c.id]!,
      tier: o.tier,
      reducedMotion: o.reducedMotion,
      pixelRatio: o.pixelRatio,
      bus: o.bus,
      haptics: o.haptics,
      onEvent: (e) => {
        o.onEvent?.(c.id, e);
        if (e.type === 'complete' && !restoring) finish(c.id);
      },
    });
    play.setHints(false);
    plays.set(c.id, play);
    for (const n of def.nodes) {
      if (owner.has(n.id)) throw new Error(`star id "${n.id}" is used by two shapes`);
      owner.set(n.id, c.id);
    }
  }

  const isDone = (id: string): boolean => done.has(id);
  const router = new SkyRouter({ ownerOf: (s) => owner.get(s) ?? null, isDone }, ids);

  // ---- progress: restore what was finished, silently -----------------------------------------------------------------------------------
  for (const id of o.progress.get().constellations) {
    const p = plays.get(id);
    if (!p || done.has(id)) continue; // an id this card does not know is ignored
    restoreShape(p);
    done.add(id);
  }
  restoring = false;

  function finish(id: string): void {
    if (done.has(id)) return;
    done.add(id);
    o.progress.markConstellation(id);
    o.bus?.emit('wish:show', { id });
    o.onComplete?.(id);
    if (!allDoneFired && done.size === ids.length) {
      allDoneFired = true;
      o.onAllDone?.();
    }
    refreshHints();
  }

  function progressOf(id: string): number {
    return plays.get(id)!.engine.state().progress;
  }
  let hinting: string | null = null;
  function refreshHints(): void {
    const cur = currentShape(ids, isDone, progressOf, lastTouched);
    if (cur === hinting) return;
    hinting = cur;
    const t = [...plays.values()][0]?.clock ?? 0;
    for (const [id, p] of plays) {
      p.setHints(id === cur);
      // a shape that just became the current one starts its 8 s now, and one that stopped being it drops its hint; never touch a line that is being drawn
      const st = p.engine.state();
      if (st.anchor === null && !st.dragging) for (const e of p.engine.release(t)) p.fx.onEvent(e);
    }
  }
  refreshHints();

  // ---- picking: every shape's stars in one pool; the nearest to the finger wins ---------------------------------------------------------
  const resolve = (x: number, y: number, kind: PointerKind): string | null => {
    let best: { id: string; d: number } | null = null;
    for (const p of plays.values()) {
      const id = p.resolve(x, y, kind);
      if (id === null) continue;
      const s = p.picker.screenOf(id);
      const d = s ? Math.hypot(s.x - x, s.y - y) : 0;
      if (best === null || d < best.d) best = { id, d };
    }
    return best?.id ?? null;
  };
  const keyboard = {
    ids: (): readonly string[] => {
      const out: string[] = [];
      for (const cid of ids) {
        const p = plays.get(cid)!;
        // a finished shape offers one star, so a keyboard viewer can read its wish again
        if (done.has(cid)) out.push(p.engine.def.nodes[0]!.id);
        else out.push(...p.keyboard.ids());
      }
      return out;
    },
    positionOf: (id: string): { x: number; y: number } | null => {
      const c = owner.get(id);
      return c ? plays.get(c)!.picker.screenOf(id) : null;
    },
  };

  // ---- gestures: one adapter per play, so each play's own `attach` is used unchanged ---------------------------------------------------
  type Fn = (g: never) => void;
  const adapters = new Map<string, Map<string, Set<Fn>>>();
  for (const id of ids) adapters.set(id, new Map());
  const adapterFor = (id: string): Pick<Input, 'on'> => ({
    on: ((type: string, fn: Fn) => {
      const m = adapters.get(id)!;
      if (!m.has(type)) m.set(type, new Set());
      m.get(type)!.add(fn);
      return () => void m.get(type)?.delete(fn);
    }) as Pick<Input, 'on'>['on'],
  });
  const send = (id: string | null, type: string, g: unknown): void => {
    if (id === null) return;
    for (const fn of [...(adapters.get(id)?.get(type) ?? [])]) fn(g as never);
  };
  const letGo = (list: string[]): void => {
    for (const id of list) {
      const p = plays.get(id)!;
      const s = p.engine.state();
      if (s.anchor !== null || s.dragging) for (const e of p.engine.release(p.clock)) p.fx.onEvent(e);
    }
  };
  const touched = (id: string | null): void => {
    if (id === null || id === lastTouched) return;
    lastTouched = id;
    refreshHints();
  };

  return {
    ids,
    play: (id) => plays.get(id)!,
    resolve,
    keyboard,
    attach(input) {
      const offs = [...plays.entries()].map(([id, p]) => p.attach(adapterFor(id)));
      offs.push(
        input.on('tap', (g) => {
          const r = router.tap(g.target);
          letGo(r.release);
          if (r.reshow !== null) {
            o.bus?.emit('wish:show', { id: r.reshow });
            o.onReshow?.(r.reshow);
          }
          touched(r.to);
          send(r.to, 'tap', g);
        }),
        input.on('dragstart', (g) => {
          const r = router.dragStart(g.target);
          letGo(r.release);
          touched(r.to);
          send(r.to, 'dragstart', g);
        }),
        input.on('drag', (g) => send(router.dragging, 'drag', g)),
        input.on('dragend', (g) => send(router.dragEnd(), 'dragend', g)),
        input.on('cancel', (g) => {
          const id = router.dragEnd();
          send(id, 'cancel', g);
          letGo([...ids]);
        }),
      );
      return () => offs.forEach((f) => f());
    },
    isDone,
    get doneIds() {
      return ids.filter((id) => done.has(id));
    },
    get allDone() {
      return done.size === ids.length;
    },
    ownerOf: (s) => owner.get(s) ?? null,
    current: () => currentShape(ids, isDone, progressOf, lastTouched),
    labelAnchor(id) {
      const p = plays.get(id);
      if (!p) return null;
      let sx = 0;
      let maxY = -Infinity;
      let n = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const nd of p.engine.def.nodes) {
        const s = p.picker.screenOf(nd.id);
        if (!s) return null;
        sx += s.x;
        n++;
        maxY = Math.max(maxY, s.y + s.radiusPx);
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
      }
      void minX;
      void maxX;
      return n ? { x: sx / n, y: maxY } : null;
    },
    screenOf: (s) => {
      const c = owner.get(s);
      return c ? plays.get(c)!.picker.screenOf(s) : null;
    },
    update(dt, tSec) {
      refreshHints();
      for (const p of plays.values()) p.update(dt, tSec);
    },
    resize(w, h, aspect) {
      const L = layoutFor(aspect);
      for (const [id, p] of plays) {
        p.setPlacement(L[id]!);
        p.resize(w, h);
      }
    },
    setTier: (t) => plays.forEach((p) => p.setTier(t)),
    setPixelRatio: (pr) => plays.forEach((p) => p.setPixelRatio(pr)),
    drawCalls: () => [...plays.values()].reduce((a, p) => a + p.fx.stats().drawCalls, 0),
    reset() {
      done.clear();
      allDoneFired = false;
      lastTouched = null;
      o.progress.reset();
      for (const p of plays.values()) p.reset();
      hinting = null;
      refreshHints();
    },
    dispose() {
      for (const p of plays.values()) p.dispose();
    },
  };
}
