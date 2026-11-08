// The background music: one looping file, played through the same Web Audio graph as everything else, so the mute switch, the limiter and the quiet-downs all apply.
// Streamed from an <audio> element (not decoded to memory: a 4 minute track decoded is ~90 MB). Nothing here throws into the card: any failure is silence.
// The file lives in public/audio (not in the JS bundle), is fetched only after the first touch, and the service worker keeps it for offline.

/** how far the music drops under each reason (0..1 of normal). `[A]` The owner wants it to keep playing through the stars and the letter; only the finale's own tune takes over. */
export const MUSIC_DUCK: Record<string, number> = { wish: 1, letter: 0.4, finale: 0.0, hush: 0.5 };
export const MUSIC_LEVEL = 0.55;
export const MUSIC_FADE_S = 1.6;

export function musicTarget(on: Iterable<string>): number {
  let level = 1;
  for (const r of on) level = Math.min(level, MUSIC_DUCK[r] ?? 1);
  return level;
}

export interface Music {
  /** call from inside a touch (iOS needs that) */
  start(): void;
  setDuck(level: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

export function createMusic(ctx: AudioContext, dest: AudioNode, url: string): Music | null {
  try {
    if (typeof Audio === 'undefined' || typeof ctx.createMediaElementSource !== 'function') return null;
    const el = new Audio();
    el.src = url;
    el.loop = true;
    el.preload = 'none';
    el.crossOrigin = 'anonymous';
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(dest);
    let level = 1;
    const apply = (fade: number): void => {
      try {
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(MUSIC_LEVEL * level, t, fade);
      } catch {
        /* ignore */
      }
    };
    const play = (): void => {
      try {
        const p = el.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* ignore */
      }
    };
    return {
      start() {
        play();
        apply(MUSIC_FADE_S / 3);
      },
      setDuck(l) {
        level = Math.max(0, Math.min(1, l));
        apply(MUSIC_FADE_S / 3);
      },
      pause() {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
      },
      resume() {
        play();
      },
      dispose() {
        try {
          el.pause();
          el.removeAttribute('src');
          el.load();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}
