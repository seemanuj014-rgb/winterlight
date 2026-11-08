import * as THREE from 'three';
import type { Stage } from '../core/renderer';
import type { Bus, WinterEvents } from '../state/events';
import { createTour } from '../tourView';
import { createActs, type Acts } from './index';
import { runTasks } from '../core/bootTasks';
import { createSkyView, type SkyView } from '../skyView';
import { createCakeView, type CakeView } from './cakeView';
import { createReleaseView, type ReleaseView } from './releaseView';
import { createEnvelopeView, type EnvelopeView } from './envelopeView';
import { createFinaleView, type FinaleView } from './finaleView';
import { createStayView, type StayView } from './stayView';
import { dipLevel, isStage, nextStage, switchesAt, type CardEvent, type CardStage } from './cardMath';

// Phase 28: `?card` = the whole card in the order of the storyboard, one stage at a time (rules in `cardMath.ts`). Every stage is the real view that was looked at on its own (`?sky`, `?cake`,
// `?release`, `?envelope`, `?finale`, `?stay`); this file only builds the next one when the last one says it is done, with a dip to night between (a plain dark layer, no words; none with reduced motion).
// The first stage is `acts` = the real `?acts` world (the nook, waking Chamgadad, the door, the push-out into the snow); its `act:done {2}` hands over to the sky. Act 0 (the lock) is Phase 29.
//   &from=acts|sky|cake|release|envelope|finale|stay   start at that stage (tests, and to look at one stage in the chain)
//   &reduced, &nopost, &debug&tier=               as everywhere. Under `&sound` main.ts hands every stage's bus to the audio engine through `onBus`.
// State on `window.__card`: { stage(), count(), goto(stage), dip() , log() }. Nothing here can block an exit: stay a while keeps both of its own.

type AnyView = ActsStage | SkyView | CakeView | ReleaseView | EnvelopeView | FinaleView | StayView;

/** the `?acts` tour world as one stage: built a piece at a time (boot tasks), then the acts take over; it does nothing until it is ready */
interface ActsStage {
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

export interface CardView {
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  setTier(t: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

declare global {
  interface Window {
    __card?: { stage(): CardStage; goto(s: CardStage): void; dip(): number; log(): { at: number; stage: CardStage }[]; busCount(): number };
  }
}

export interface CardCtx {
  stage: Stage;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  params: URLSearchParams;
  reduced: boolean;
  /** each stage's bus, so the sound can listen to it (main.ts) */
  onBus?: (bus: Bus<WinterEvents>) => void;
}

function wipe(scene: THREE.Scene): void {
  for (const child of [...scene.children]) {
    scene.remove(child);
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose();
    });
  }
}

export function createCardView(ctx: CardCtx): CardView {
  const { stage, scene, camera, canvas } = ctx;
  const start = isStage(ctx.params.get('from')) ? (ctx.params.get('from') as CardStage) : 'acts';
  // what the stage views are given: the card's own flags only (no `&at`, `&sound` or other single-view test knobs leak through)
  const stageParams = (): URLSearchParams => {
    const p = new URLSearchParams();
    for (const k of ['reduced', 'nopost', 'debug', 'tier', 'bloom', 'nohud', 'nomic', 'done', 'fresh']) if (ctx.params.has(k)) p.set(k, ctx.params.get(k) ?? '');
    return p;
  };

  const fade = document.createElement('div');
  fade.id = 'card-dip';
  fade.style.cssText = 'position:fixed;inset:0;background:#0d1b2e;opacity:0;pointer-events:none;z-index:6';
  fade.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fade);

  let current: CardStage = start;
  let view: AnyView | null = null;
  let offBus: Array<() => void> = [];
  let pending: CardStage | null = null;
  let dipT = 0;
  let aspect = Math.max(0.2, (window.innerWidth || 390) / Math.max(1, window.innerHeight || 780));
  let size = { w: canvas.clientWidth || window.innerWidth || 390, h: canvas.clientHeight || window.innerHeight || 780 };
  let t = 0;
  const log: { at: number; stage: CardStage }[] = [];
  let busCount = 0;
  let uncover = false;
  let buildId = 0;

  const gain = (): number => (ctx.params.has('bloom') ? Number(ctx.params.get('bloom')) : current === 'sky' ? 1 : 0.4);

  function feed(ev: CardEvent): void {
    if (pending) return;
    const next = nextStage(current, ev);
    if (next) {
      pending = next;
      dipT = 0;
    }
  }

  function build(s: CardStage): void {
    const id = ++buildId;
    for (const f of offBus) f();
    offBus = [];
    view?.dispose();
    view = null;
    wipe(scene);
    scene.background = new THREE.Color(0x0d1b2e);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    const c = { stage, scene, camera, canvas, params: stageParams(), reduced: ctx.reduced };
    // each stage's bus: hand it to the sound, count its acts (the acts stage has its bus only once it is ready)
    const attach = (b: Bus<WinterEvents>): void => {
      if (id !== buildId) return;
      offBus.push(b.on('act:enter', () => void busCount++));
      ctx.onBus?.(b);
    };
    let bus: Bus<WinterEvents> | null = null;
    switch (s) {
      case 'acts': {
        const t0 = createTour({ stage, scene, camera, params: c.params, reduced: ctx.reduced });
        let acts: Acts | null = null;
        let ready = false;
        fade.style.opacity = '1'; // the night covers the build; it lifts when the world is in place
        view = {
          update: (dt) => ready && t0.update(dt),
          render: (ts) => ready && t0.render(ts),
          resize: (a, w, h) => {
            t0.resize(a);
            acts?.resize(w, h);
          },
          setTier: (tier) => t0.setTier(tier),
          dispose: () => {
            ready = false;
            acts?.dispose();
          },
        } as ActsStage;
        void runTasks(t0.tasks).then(() => {
          if (id !== buildId) return;
          acts = createActs(t0.world, { canvas, params: c.params, reduced: ctx.reduced });
          acts.resize(size.w, size.h);
          t0.setActs(acts);
          t0.resize(aspect);
          t0.begin();
          ready = true;
          offBus.push(acts.bus.on('act:done', (e) => e.act === 2 && feed({ type: 'acts:done' })));
          attach(acts.bus);
          if (ctx.reduced) fade.style.opacity = '0';
          else {
            uncover = true;
            dipT = switchesAt(false);
            fade.style.opacity = '1';
          }
        });
        break;
      }
      case 'sky': {
        const v = createSkyView(c);
        view = v;
        bus = v.bus;
        // the shape's own bookkeeping runs right AFTER this event, so count one tick later (counting now always sees one fewer, and the fifth shape never handed over)
        // she has finished all five before (a reload, or coming back to the link): hand over at once, or the card waits forever for a shape that is already done
        if (v.doneCount() >= 5) queueMicrotask(() => feed({ type: 'sky:count', done: v.doneCount() }));
        offBus.push(v.bus.on('constellation:done', () => queueMicrotask(() => feed({ type: 'sky:count', done: v.doneCount() }))));
        break;
      }
      case 'cake': {
        const v = createCakeView(c);
        view = v;
        bus = v.bus;
        offBus.push(v.bus.on('act:done', (e) => e.act === 4 && feed({ type: 'cake:done' })));
        break;
      }
      case 'release': {
        const v = createReleaseView(c);
        view = v;
        bus = v.bus;
        offBus.push(v.bus.on('release:done', () => feed({ type: 'release:done' })));
        break;
      }
      case 'envelope': {
        const v = createEnvelopeView(c);
        view = v;
        bus = v.bus;
        offBus.push(v.bus.on('act:done', (e) => e.act === 5 && feed({ type: 'letter:done' })));
        break;
      }
      case 'finale': {
        const v = createFinaleView(c);
        view = v;
        bus = v.bus;
        offBus.push(v.bus.on('finale:done', () => feed({ type: 'finale:done' })));
        break;
      }
      case 'stay': {
        const v = createStayView(c);
        view = v;
        bus = v.bus;
        offBus.push(v.bus.on('stay:exit', (e) => e.to === 'replay' && feed({ type: 'stay:replay' })));
        break;
      }
    }
    if (bus) attach(bus);
    stage.setPost(!ctx.params.has('nopost'));
    if (s !== 'acts') stage.setBloomGain(gain());
    view?.resize(aspect, size.w, size.h);
    log.push({ at: Number(t.toFixed(2)), stage: s });
  }

  build(current);
  // the sky may already be finished from an earlier visit (the progress store keeps it): hand over without waiting for a new shape
  if (current === 'sky' && ((view as SkyView | null)?.doneCount() ?? 0) >= 5) feed({ type: 'sky:count', done: 5 });

  window.__card = {
    stage: () => current,
    goto(s) {
      if (isStage(s) && s !== current) {
        pending = s;
        dipT = 0;
      }
    },
    dip: () => dipLevel(dipT, ctx.reduced),
    log: () => [...log],
    busCount: () => busCount,
  };

  return {
    update(dt) {
      t += dt;
      if (pending) {
        dipT += dt;
        if (dipT >= switchesAt(ctx.reduced)) {
          current = pending;
          pending = null;
          build(current);
          if (!ctx.reduced) dipT = switchesAt(ctx.reduced); // keep going: the second half uncovers
          else dipT = 0;
          uncover = !ctx.reduced;
        }
        fade.style.opacity = String(dipLevel(dipT, ctx.reduced));
        if (pending) {
          view?.update(dt); // the stage that is ending keeps going while the dip covers it
          return;
        }
      } else if (uncover) {
        dipT += dt;
        fade.style.opacity = String(dipLevel(dipT, ctx.reduced));
        if (dipT >= 0.9) {
          uncover = false;
          fade.style.opacity = '0';
        }
      }
      view?.update(dt);
    },
    render(tSec) {
      view?.render(tSec);
    },
    resize(a, w, h) {
      aspect = a;
      size = { w, h };
      view?.resize(a, w, h);
    },
    setTier(tier) {
      view?.setTier(tier);
    },
    dispose() {
      for (const f of offBus) f();
      view?.dispose();
      fade.remove();
    },
  };
}
