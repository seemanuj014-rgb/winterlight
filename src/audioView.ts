import { createAudioEngine, createMuteButton, renderSound, wavBytes, RENDER_NAMES, type AudioEngine, type RenderName } from './audio';
import { createBus, type WinterEvents } from './state/events';

// Phase 23 test view: `?audio` = a plain dark page with one button for every sound, so the owner can listen on the preview URL (the sandbox cannot play sound).
// TEST ONLY. It is the proof for the phase, not part of the card. Every button goes through the SAME event bus the card will use, so what is heard is what the events
// will do: `star:connect`, `constellation:done`, `wish:show` / `wish:hide`, `letter:open` / `letter:read`, `act:enter`, `footstep`, `pet:purr`. The music box (finale) is called directly.
// The mute button (top right) is the real one. Nothing makes a sound until the first tap anywhere.
// `&reduced` = calmer beds. `window.__audio` is for the test tools: state(), muted(), volume(), emit(), render(), log().
// Plain functional labels (debug page, not her words).

declare global {
  interface Window {
    __audio?: {
      engine: AudioEngine;
      state(): string;
      muted(): boolean;
      volume(): number;
      emit(type: keyof WinterEvents, payload?: unknown): void;
      birthday(): number;
      log(): string[];
      render(name: RenderName, opts?: { gain?: number }): Promise<{ name: string; sampleRate: number; seconds: number; gain: number; peak: number; peakDb: number; wavBase64: string }>;
    };
  }
}

export interface AudioView {
  dispose(): void;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function createAudioView(ctx: { reduced: boolean }): AudioView {
  const bus = createBus<WinterEvents>();
  const engine = createAudioEngine({ reducedMotion: ctx.reduced });
  const offListen = engine.listen(bus);
  const mute = createMuteButton(engine);
  const log: string[] = [];

  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10', 'overflow:auto', 'padding:64px 12px 24px', 'box-sizing:border-box',
    'background:#0d1b2e', 'color:#d6ecff', 'font:14px/1.4 ui-sans-serif,system-ui,sans-serif',
  ].join(';');
  const status = document.createElement('div');
  status.style.cssText = 'font:12px/1.4 ui-monospace,Menlo,monospace;margin-bottom:10px;white-space:pre-wrap';
  root.appendChild(status);
  const paintStatus = (): void => {
    status.textContent = `state: ${engine.state}   muted: ${engine.muted}   volume: ${engine.volume.toFixed(2)}\nlast: ${log.slice(-3).join(' | ') || '-'}`;
  };
  const note = (s: string): void => {
    log.push(s);
    if (log.length > 200) log.shift();
    paintStatus();
  };
  const offChange = engine.onChange(paintStatus);

  const row = (title: string, ...buttons: [string, () => void][]): void => {
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'margin:12px 0 4px;opacity:.75;font-size:12px;letter-spacing:.04em;text-transform:uppercase';
    root.appendChild(h);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'min-height:44px;min-width:44px;padding:8px 14px;border:1px solid #38506e;border-radius:10px;background:#14263d;color:#e6f2ff;font:inherit;touch-action:manipulation';
      b.addEventListener('click', () => {
        fn();
        note(label);
      });
      wrap.appendChild(b);
    }
    root.appendChild(wrap);
  };

  let line = 0;
  let purring = false;
  row(
    'stars',
    ['line joined (next note)', () => bus.emit('star:connect', { shape: 'strawberry', line: line++ })],
    ['restart the run', () => (line = 0)],
    ['shape finished', () => bus.emit('constellation:done', { id: 'strawberry' })],
  );
  row('wish card', ['opens (beds duck)', () => bus.emit('wish:show', { id: 'strawberry' })], ['put away', () => bus.emit('wish:hide')]);
  row('letter', ['opens (beds duck more)', () => bus.emit('letter:open')], ['read / closed', () => bus.emit('letter:read')]);
  row('details', ['one step in snow', () => bus.emit('footstep')], ['candle puff', () => bus.emit('candle:out', { index: 0, left: 4 })], [
    'purr on / off',
    () => {
      purring = !purring;
      bus.emit('pet:purr', { on: purring });
    },
  ]);
  row('mood of the beds', ['cool (meadow)', () => bus.emit('act:enter', { act: 2 })], ['warm (nook)', () => bus.emit('act:enter', { act: 1 })]);
  row('finale', ['music box: Happy Birthday', () => note(`music box ${engine.birthday().toFixed(1)} s`)]);
  row(
    'volume',
    ['quieter', () => engine.setVolume(engine.volume - 0.05)],
    ['louder', () => engine.setVolume(engine.volume + 0.05)],
  );
  document.body.appendChild(root);
  paintStatus();

  window.__audio = {
    engine,
    state: () => engine.state,
    muted: () => engine.muted,
    volume: () => engine.volume,
    emit: (type, payload) => (bus.emit as (t: string, p?: unknown) => void)(type, payload),
    birthday: () => engine.birthday(),
    log: () => [...log],
    async render(name, opts) {
      if (!RENDER_NAMES.includes(name)) throw new Error(`unknown render "${name}"`);
      const r = await renderSound(name, { gain: opts?.gain });
      return { name: r.name, sampleRate: r.sampleRate, seconds: r.seconds, gain: r.gain, peak: r.peak, peakDb: r.peakDb, wavBase64: toBase64(wavBytes(r.samples, r.sampleRate)) };
    },
  };

  return {
    dispose() {
      offChange();
      offListen();
      mute.dispose();
      engine.dispose();
      root.remove();
      delete window.__audio;
    },
  };
}
