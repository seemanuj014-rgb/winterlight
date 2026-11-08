// A tiny typed event bus: scene -> UI messages. No DOM, no three.

/** The contract between the scene and the UI. Later phases add entries here rather than inventing side channels. */
export interface WinterEvents {
  'act:enter': { act: number };
  'act:done': { act: number };
  'constellation:done': { id: string };
  'wish:show': { id: string };
  /** Phase 27: the envelope starts to arrive (act 5 begins) */
  'letter:arrive': void;
  'letter:open': void;
  'letter:read': void;
  /** Phase 27: she put the letter away (the sign-off shows; "read again" is on offer) */
  'letter:close': void;
  'secret:found': { id: string };
  /** Phase 20: the cat starts or stops purring (Phase 23's purr loop listens) */
  'pet:purr': { on: boolean };
  /** Phase 20: what the snow bunny is doing because of the viewer */
  'pet:bunny': { kind: 'hop' | 'arrive' | 'startle' | 'hide' | 'peek' | 'back' };
  /** Phase 23: a line was joined in a shape (`line` = how many are drawn so far, minus one); the chime listens. Emitted by the constellation play. */
  'star:connect': { shape: string; line?: number };
  /** Phase 23: the wish card was put away (the sound comes back up). NOT emitted yet: wiring is the next session's job, see PHASE_STATUS. */
  'wish:hide': void;
  /** Phase 23: one soft step in the snow (Chamgadad's hop landing). NOT emitted yet: wiring is the next session's job. */
  footstep: void;
  /** Phase 25: one candle went out (`left` = how many are still lit); the puff sound listens. */
  'candle:out': { index: number; left: number };
  /** Phase 25: the quiet "make a wish" beat starts or ends (the beds hush). */
  'cake:wish': { on: boolean };
  /** Phase 26: the quiet beat after the candles begins (the sound hushes). Emitted by the release machine. */
  'release:start': void;
  /** Phase 26: the hush ends: the glitter bursts, the first lantern lets go, the sound swells. */
  'release:burst': void;
  /** Phase 26: the last lantern is gone and the sky is empty again (Phase 27's letter can begin). */
  'release:done': void;
  /** Phase 28: the finale begins (the five shapes lift) and its beats, each once and in order. Emitted by `acts/act6_finale.ts`. */
  'finale:start': void;
  'finale:join': void;
  'finale:swell': void;
  'finale:pullback': void;
  'finale:done': void;
  /** Phase 28: stay a while begins, and she leaves it for the letter or for the replay (`act6_finale.ts` replays on `to: 'replay'`; the card calls the letter's read-again on `to: 'letter'`). */
  'stay:enter': void;
  'stay:exit': { to: 'letter' | 'replay' };
  'stay:activity': { activity: 'wander' | 'pet' | 'constellations' | 'wishes' | 'secrets' };
}

type Payload<E, K extends keyof E> = E[K] extends void ? [] : [payload: E[K]];

export interface Bus<E> {
  /** Subscribe. Returns the unsubscribe function. */
  on<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void;
  /** Subscribe for one event only. Returns the unsubscribe function. */
  once<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void;
  off<K extends keyof E>(type: K, handler: (payload: E[K]) => void): void;
  emit<K extends keyof E>(type: K, ...payload: Payload<E, K>): void;
  listenerCount<K extends keyof E>(type: K): number;
  clear(): void;
}

export function createBus<E extends object>(onError: (err: unknown) => void = (e) => console.error(e)): Bus<E> {
  const handlers = new Map<keyof E, Set<(payload: never) => void>>();

  const bus: Bus<E> = {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(handler as (payload: never) => void);
      return () => bus.off(type, handler);
    },
    once(type, handler) {
      const off = bus.on(type, (p) => {
        off();
        handler(p);
      });
      return off;
    },
    off(type, handler) {
      handlers.get(type)?.delete(handler as (payload: never) => void);
    },
    emit(type, ...payload) {
      const set = handlers.get(type);
      if (!set) return;
      // Copy first so a handler may unsubscribe (or subscribe) during the emit. One bad handler never stops the rest.
      for (const h of [...set]) {
        try {
          (h as (p: unknown) => void)(payload[0]);
        } catch (err) {
          onError(err);
        }
      }
    },
    listenerCount(type) {
      return handlers.get(type)?.size ?? 0;
    },
    clear() {
      handlers.clear();
    },
  };
  return bus;
}

/** The one bus the card shares. Tests make their own with createBus. */
export const events = createBus<WinterEvents>();
