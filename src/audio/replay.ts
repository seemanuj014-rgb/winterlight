import type { AudioEngine } from './engine';

// Phase 24: what the music-box replay button does. A tap is an explicit "play it", so it unlocks the sound and, if the viewer had muted, un-mutes first
// (a silent replay would just look broken). The first tap can land before the browser has the audio running, so it tries once more a moment later.
// Returns what it did, for tests. Never throws.

export type ReplayResult = 'played' | 'retry' | 'unavailable';

export function replayMusicBox(engine: Pick<AudioEngine, 'unlock' | 'muted' | 'setMuted' | 'birthday'>, retry: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms)): ReplayResult {
  try {
    engine.unlock();
    if (engine.muted) engine.setMuted(false);
    if (engine.birthday() > 0) return 'played';
    retry(() => {
      try {
        engine.birthday();
      } catch {
        /* quiet */
      }
    }, 250);
    return 'retry';
  } catch {
    return 'unavailable';
  }
}
