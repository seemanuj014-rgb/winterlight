# AUDIO_SPEC (AU)

All sound is synthesized with Web Audio. No audio files.

- **Unlock:** the audio context starts on her first tap. Before that, silence. A mute toggle is always visible and remembered.
- **Master:** quiet by default, a limiter on the master so nothing is ever loud.
- **Beds:** soft filtered wind and snow hush; a low pad that follows the act (cool in the meadow, warm in the nook).
- **Stars:** each star chime is a note from one pentatonic scale so any order sounds nice; completing a constellation plays a short phrase.
- **Details:** footsteps in snow (filtered noise bursts), a cat purr (low modulated oscillator), a candle puff, a paper rustle for the letter.
- **Finale:** a music-box arrangement of "Happy Birthday to You" (public-domain tune), played softly.
- **Ducking:** beds drop while a wish card or the letter is open.
- **Mic (Phase 25):** blow detection reads input level plus low-frequency energy to tell breath from speech; permission is requested only at the candle moment; a denied or missing mic silently falls back to tapping; the stream is stopped as soon as the candles are out.
- **iOS:** unlock on a user gesture, resume on `visibilitychange`, no autoplay assumptions.

## As built (Phase 23, three sessions)

Files: `src/audio/audioMath.ts` (pure: scale, melody, look-ahead queue, mix and duck numbers, unlock state machine, mute parsing), `voices.ts` (chime, music-box tine, snow step, purr, wind + hush + pad beds; every function takes any `BaseAudioContext`, so the same code can be rendered offline to a WAV), `engine.ts` (graph, unlock, mute, volume, ducking, `listen(bus)`), `muteButton.ts` (always-visible button, SVG icon, top right), `index.ts`.

- **Graph:** voices and beds -> duck gain -> master gain (default 0.2 `[A]`, hard max 0.6; it was 0.3 until the first real render peaked at -7 dBFS) -> DynamicsCompressor used as a limiter (-14 dB, ratio 20, 3 ms attack).
- **Scale:** C major pentatonic, C5 up two octaves (10 notes). A line's chime is `chimeIndexForLine(shape, n)`, so a shape sounds like a small rising run; completion plays a five-note rising phrase.
- **Music box:** the public-domain "Happy Birthday" tune, four lines of six beats, 72 bpm, handed to the audio clock 0.25 s ahead; a note more than 0.4 s late is dropped, not blurted.
- **Events the engine listens to:** `constellation:done`, `star:connect` (new), `wish:show` / `wish:hide` (new), `letter:open` / `letter:close` (Phase 27: the quiet lasts while the reader is open; it no longer lifts at `letter:read`), `act:enter`, `footstep` (new), `pet:purr`.
- **Wiring:** `graph.ts` builds the graph for both the page and the offline render (`render.ts`). The engine is created by the `?audio` test view and, with `&sound`, by `?stars`, `?sky`, `?acts`, `?pet`; the card itself gets it in Phase 28. `star:connect` is emitted by the constellation play, `wish:hide` by the sky view when the wish card is put away. **`footstep` has no emitter** (Act 2's hops are indoors, the sound is snow; see PHASE_STATUS). The finale's `birthday()` is not called by anything yet (Phase 28).
- **The tune is 25 notes** (6 + 6 + 7 + 6; 24 beats), not 24.
- **Proven in the sandbox (session 3):** a real `OfflineAudioContext` render through the same graph (`tools/render_music_box.py` -> `docs/phase23/*.wav`, `levels.json`): at master 0.2 every peak is under -9 dBFS (music box -10.6, finished phrase -9.5, chimes -12.1, steps -29.9, purr -29.2, beds -24.4), at the hard maximum 0.6 the demo peaks at -4.6 dBFS; the 25 melody notes are present at the right pitches and times (checked by FFT). The browser wiring (`tools/audio_check.py`, 22 checks): no `AudioContext` before the first tap, exactly one after, mute flips and persists.
- **Not proven (owner-device):** how it sounds on her phone, real loudness, iOS Safari unlock and silent switch, resume after a call.
- Every number marked `[A]` in `audioMath.ts` is mine, to be tuned by ear.

## As built (Phase 25, done in the sandbox in session 5)
- **Blow detector** (`src/audio/blow.ts`, pure): a frame must be loud (gate 0.02 or 2.5x the room floor), noise-like (pitch repeat at most 0.45), low-heavy (at least 45 % of the energy under 500 Hz) and 150..2600 sign changes a second, and it must last 0.35 s. The first 0.4 s only listens to the room. Tested on synthetic buffers (16 kHz) and, in a browser, on looped WAVs through Chromium's fake microphone (breath puts the flames out, speech and silence do not). **Risk, not proven either way: the 150..2600 sign-change window assumes a breath that is mostly low; a real phone breath with strong wideband hiss may fall outside it (a 48 kHz white-hiss breath did).** All numbers `[A]`.
- **Microphone** (`src/audio/mic.ts`): `createMic({ onReading })`, `request()` resolves `granted | denied | unsupported` and never throws or shows anything. No echo cancellation, noise suppression or auto gain (they flatten a breath). The microphone is measured every ~50 ms and never connected to the speakers, never recorded, stored or sent. `stop()` stops every track and closes the context; it also stops when the tab is hidden and when the stream ends. The card asks only when the candle moment is `ready` (the machine's `micWanted`). Tested with a fake `getUserMedia` (denied, missing, throws, stop during the prompt, hidden, ended) and in a browser with Chromium's fake device (granted, listening only during the candle moment, closed afterwards; denied path with no device). The real microphone is an owner-device gap.
- **Candle puff** (`candlePuff`, `playPuff`, `engine.puff()`): a soft breath of noise through a wide low band-pass, 0.2 to 0.32 s, gain 0.10 to 0.15, panned a little. Bus event `candle:out { index, left }`. Offline render `puff` (`docs/phase23/puff.wav`, peak -27.1 dBFS, quiet on purpose; judge it by ear).
- **Hush** (`DuckReason 'hush'`, 0.35 `[A]`): bus event `cake:wish { on }` ducks the beds during the quiet "make a wish" beat. Emitted by `acts/act4_cake.ts` (on at the wish beat, off when it ends). Ducking also affects effects, as noted in Phase 23.

## As built (Phase 26, session 2: the hush and the swell)
- **Events** (`src/state/events.ts`): `release:start` (the quiet beat begins), `release:burst` (the hush ends: glitter, first lantern, swell), `release:done` (the last lantern is gone; Phase 27 may begin). Emitted by `acts/releaseAct.ts` from the pure `fx/releaseMath.ts` `ReleaseMachine`.
- **Engine:** `release:start` -> the existing `'hush'` duck on (0.35); `release:burst` -> hush off (the beds lift back slowly, 1.2 s time constant) and `engine.swell()`.
- **The swell** (`SWELL`, `swellPartials`, `swellLevel`, `playSwell`): NOT a new melody. The beds' cool chord an octave up (three soft sines, each doubled and detuned 4 cents) plus a fifth above the top as a faint shimmer, arriving low to high 0.35 s apart; one shared envelope (rise 2.4 s, hold 1.2 s, fall 4.4 s, peak 0.09) and one quiet high chime (scale index 7, an octave up) at 1.9 s. Oscillators only; nothing is loaded. `RELEASE_HUSH_S` (1.4 s) is a copy of `RELEASE.hushS` because audio may not import fx; a test pins them together.
- **Offline render `release`** (`docs/phase26/audio/release.wav`, 12 s): the cool bed, the hush from 1 s, the swell from 2.4 s. At master 0.2 it peaks at **-12.4 dBFS** (quieter than the music box at -10.6). Read from the WAV in 0.5 s windows: about -48 dB during the hush, about -23 dB at the top of the swell (about 25 dB of lift), back to about -36 dB by the end. The first try (peak 0.16) peaked at -7.9 dBFS and was too loud for "starts quiet", so it was lowered to 0.09 and the chime gain to 0.2.
- **In the test view:** `?release&sound` shows the mute button and waits for the first touch or key press before it starts (a phone has no sound before one); without `&sound` it starts at once and is silent.
- **Not proven (owner-device):** how the hush and the swell sound on her phone and whether the lift reads as "hush then swell" by ear (the duck's slow release makes the swell rise a little later than its own envelope), iOS Safari unlock. Every number is `[A]`.
