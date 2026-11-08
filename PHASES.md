# PHASES — Winterlight (36 phases in 7 milestones; Phase 0 = this starter pack, done)

**Edit in place** rather than regenerating. Never reorder or renumber a completed phase. If a phase proves too large, split it and renumber forward; record that in `PHASE_STATUS.md`.

Each phase is sized to finish inside one Claude.ai session: read docs, build, verify, update status, hand back a changed-files zip. Format: **Goal · Depends on · In scope · Out of scope · Key files · How to verify**. "How to verify" is never optional. Rule files named in a phase (`RQ` = `REQUIREMENTS_ORIGINAL.md`, `CB` = `CHARACTER_BIBLE.md`, `AD` = `docs/design/ART_DIRECTION.md`, `SB` = `docs/STORYBOARD.md`, `PB` = `docs/PERF_BUDGET.md`, `AU` = `docs/AUDIO_SPEC.md`, `DV` = `docs/DEPLOY_VERCEL.md`) are binding for that phase.

**Honesty rule for "How to verify":** the sandbox builds, typechecks, runs Vitest, and renders screenshots in headless Chromium with software WebGL (`tools/shot.py`). It cannot prove frame rate, a real phone GPU, the microphone, audio output, haptics, gyro, or iOS Safari. Each phase says what is proven and what is a *standing gap for the owner to confirm on her kind of phone*. Log gaps; never claim what was not run.

**Priority tags:** `[MUST]` the card is broken without it · `[SHOULD]` the card is good without it, great with it · `[COULD]` delight, cut first.

---

## Calendar (today = Wed 4 Nov; unlock = Tue 10 Nov 00:00 IST)

| Day | Target | Gate |
|---|---|---|
| Wed 4 Nov | Phase 0 (done), M1 (Phases 1–4); first deploy of the starter to Vercel | — |
| Thu 5 Nov | M2: Chamgadad exists in 3D (Phases 5–11) | **G0** it looks exactly like her drawing |
| Fri 6 Nov | M3: the world (Phases 12–17) | **G1** a walkable, lit, beautiful scene with the cast |
| Sat 7 Nov | M4: interaction, constellations, sound, UI (Phases 18–24) | — |
| Sun 8 Nov | M5 + M6: the moments, the lock, the secrets (Phases 25–31) | **G2** the whole card works start to finish |
| Mon 9 Nov | M7: ship (Phases 32–36), owner phone test, fixes, final freeze | **G3** release `v1.0.0` by evening |
| Tue 10 Nov | 00:00 IST unlock. Nothing is built today. | — |

**Cut list, in the order to cut if time runs out** (never cut a `[MUST]`): Phase 30 easter eggs (keep moon + sleep secret only) → Phase 26 lanterns/glitter (keep a simple confetti) → Phase 31 offline cache (keep reduced motion) → Phase 20 companion petting depth → Phase 17 camera polish → Phase 8 ear physics (keep a simple sway). The five constellations (Phase 22), the letter (27), the lock (29) and Chamgadad's fidelity (11) are never cut.

---

## MILESTONE 1 — Foundation (Phases 1–4)
*Exit criteria: the repo is on GitHub, a Vercel preview exists, the render core and toon look exist as tested code, and content/state loading works.*

## Phase 1 — Repo, toolchain proof, first deploy `[MUST]`
**Goal:** The Phase 0 starter is a private GitHub repo, `npm ci` works from scratch, and Vercel serves a preview URL, so the pipeline is proven on day one.
**Depends on:** Phase 0.
**In scope:** `git init`, private repo, branches `main` and `dev`; `npm ci`, `npm run typecheck`, `npm test`, `npm run build`; connect Vercel (see `DV`); confirm `X-Robots-Tag: noindex` and `robots.txt` on the live URL; confirm the page loads on the owner's phone; fill the Install-test log in `DEPENDENCY_VERSIONS.md` with what really happened and adjust pins if anything failed.
**Out of scope:** any scene work.
**Key files:** `DEPENDENCY_VERSIONS.md`, `docs/DEPLOY_VERCEL.md`, `scripts/*`.
**How to verify:** sandbox: clean `npm ci`, typecheck, tests, build, `tools/shot.py` all clean. Owner: opens the preview URL on their phone and reports what they see (standing gap).

## Phase 2 — Render core `[MUST]`
**Goal:** A single, robust renderer module every later phase uses.
**Depends on:** 1.
**In scope:** `src/core/renderer.ts` (one renderer, DPR cap from the quality tier), fixed-step plus variable-render loop, resize and orientation handling (`100dvh`, safe areas), pause on `visibilitychange`, WebGL context-loss recovery, an **FPS watchdog** that steps the quality tier down after sustained slow frames and never back up in the same session, a tiny dev overlay (`?debug`) showing tier, fps, draw calls, triangles, texture MB.
**Out of scope:** scene content, postprocessing.
**Key files:** `src/core/{renderer,loop,quality,debug}.ts`, `tests/quality.test.ts`.
**How to verify:** tests for the tier picker and the watchdog state machine (pure logic); typecheck; `tools/shot.py` shows the debug overlay with draw-call counts. Real fps on her phone is an owner-device gap.

## Phase 3 — The toon pipeline: ramp, rim, and her ink line `[MUST]`
**Goal:** The look of the whole card: soft cel shading and a hand-drawn black outline that wobbles like her drawing.
**Depends on:** 2; `CB`, `AD`.
**In scope:** a toon material with a 3-to-4 step gradient ramp and a soft rim term (her pale warm back-light); **inverted-hull outline** with per-vertex width noise and slight line wobble driven by a baked noise texture, thicker on undersides, tapered at ends; outline colour `#010102`; test rig on primitives; a material API (`makeToon({base, ramp, outline})`) that later phases use for everything.
**Out of scope:** the character itself.
**Key files:** `src/render/toon/{material,outline,ramp}.ts`, `src/render/toon/noise.ts`.
**How to verify:** typecheck; screenshots of a sphere, a bean and a cone at three sizes: the outline weight varies, never uniform, no gaps at silhouette corners. Compare by eye against `character/reference/chamgadad_ref_01_head_front.png`. Shader cost on a phone GPU is a gap.

## Phase 4 — Content, state, preview mode `[MUST]`
**Goal:** The owner's words and the card's progress are data, not code.
**Depends on:** 1.
**In scope:** loaders and validators for `content/letter.md`, `content/wishes.json`, `content/names.json`, `content/credits.json` (clear errors for any `TODO_OWNER` placeholder in production builds; placeholders allowed in dev); a progress store (constellations done, letter read, secrets found) in `localStorage` wrapped in try/catch and falling back to memory; **preview mode** via a secret query key that bypasses the lock (the key lives in an env var, never in the repo); a tiny typed event bus for scene to UI messages.
**Out of scope:** UI rendering of the letter (Phase 27).
**Key files:** `src/content/*`, `src/state/{progress,events}.ts`, `tests/content.test.ts`.
**How to verify:** tests: placeholder detection, progress round-trips, storage-blocked fallback, preview key logic. Typecheck.

---

## MILESTONE 2 — Chamgadad (Phases 5–11)
*Exit criteria: Chamgadad is in 3D, matches her drawing at the reference framing, moves in-character, and the owner has signed the accuracy checklist.*

## Phase 5 — Reference intake and fidelity spec `[MUST]`
**Goal:** Everything we know about her drawing is measured and written down, and every gap is a question.
**Depends on:** 3; `CB`, `RQ`.
**In scope:** run `tools/trace_silhouette.py` and the palette sampler on every reference the owner has supplied (at least ref_01); view each overlay and fix the trace; update `CB` (observations, palette, unknowns); write the **question list** for the owner about missing views; decide the head-volume method (see Phase 6) and record it; define the numeric fidelity target (silhouette IoU at the reference framing, default ≥ 0.97 for head and ears).
**Out of scope:** any 3D geometry.
**Key files:** `CHARACTER_BIBLE.md`, `character/traced/*`, `character/palette.json`.
**How to verify:** overlays viewed and the trace matches the ink line by eye; `tests/character.test.ts` green. The owner confirms the observations are right (checklist item).

## Phase 6 — Head, ears, neck from her silhouette `[MUST]`
**Goal:** A 3D head, ears and neck whose front silhouette equals her drawing.
**Depends on:** 5.
**In scope:** build the volume from the traced contour with an **inflation method**: distance-to-edge height field, smoothed, with a fitted back so side and three-quarter views stay plush and plausible; ears as separate meshes attached at the traced bases so they can move; the fold on the upright ear; materials via `makeToon`; palette from `character/palette.json`; orthographic "reference camera" that reproduces the drawing's framing exactly.
**Out of scope:** eyes, mouth, body below the chest.
**Key files:** `src/character/chamgadad/{head,ears,inflate}.ts`, `src/character/refCamera.ts`.
**How to verify:** a headless render at the reference camera, overlaid on the reference at 50 percent (`tools/fidelity.py`): outline sits on her ink line. Three-quarter and side screenshots: no spikes, no pinching, ears attached. `[A]`: the back and side of the head are inferred.

## Phase 7 — Eyes, brows, mouth `[MUST]`
**Goal:** The face matches the drawing: this is where the character lives or dies.
**Depends on:** 6.
**In scope:** eyes as shader-drawn glossy discs on the head surface: near-black fill, the **white rounded-triangle highlight**, the **thin top arc**, the **pale-blue bottom tab**, positions from `character/traced/*.features.json`; highlights stay fixed to the light, not the eye, so the gaze moves under them; brow strokes as ink-line meshes; the single smile curve as an ink line; blink (squash to a soft closed curve in her line style); gaze target with limits.
**Out of scope:** a nose, whiskers, lashes, blush (not drawn). Do not add them.
**Key files:** `src/character/chamgadad/{eyes,face}.ts`, `src/character/chamgadad/shaders/eye.frag`.
**How to verify:** reference-camera overlay for eye position and size; gaze screenshots at five targets: eyes never leave the head, highlights stay put. Eye-by-eye comparison table in the status log.

## Phase 8 — Ear motion and secondary animation `[SHOULD]`
**Goal:** The ears feel alive.
**Depends on:** 6.
**In scope:** spring-damper secondary motion on both ears (follow-through when the head turns), the upright ear's fold flexing, a flick animation; a simple fallback (sine sway) for the low tier.
**Out of scope:** full cloth or fur simulation.
**Key files:** `src/character/chamgadad/earSpring.ts`, `tests/spring.test.ts`.
**How to verify:** spring tests (stable, no explosion at large dt); frame sequence screenshots of a flick.

## Phase 9 — Body, arms, legs, tail `[MUST]` `[A]`
**Goal:** The rest of Chamgadad, matching the drawing's style, flagged as assumption until approved.
**Depends on:** 7; the owner's answers to the open questions in `RQ` (more references).
**In scope:** if more references exist: trace and match them as in Phase 6. If not: design from the visible evidence (the smooth tapering torso, the chest V, the proportions) in the same toon and ink-line style; a **sitting-up pose** and a **curled sleeping pose**; all assumptions listed under `[A]` in `CB`; stethoscope and party hat as removable accessory layers.
**Out of scope:** clothing beyond the accessories.
**Key files:** `src/character/chamgadad/{body,limbs,accessories}.ts`, `CHARACTER_BIBLE.md`.
**How to verify:** pose screenshots from five angles; no intersections; head and body join with the drawn neck line. The owner approves the `[A]` list (checklist).

## Phase 10 — Rig and behaviour set `[MUST]`
**Goal:** Chamgadad moves like a sleepy, gentle character, not a toy.
**Depends on:** 8, 9.
**In scope:** a small procedural rig; animation states: rest pose (the head tilt from the drawing), breathe, slow blink, find-your-finger gaze, ear flick, sleep loop with soft Zs, wake and stretch, sit and look up, happy hop, curious lean, wave; a state machine with blends and interruptions; a "lazy" timing profile (slow ease, long holds); a hook for `prefers-reduced-motion`.
**Out of scope:** scene-specific choreography (Phases 19, 28).
**Key files:** `src/character/chamgadad/{rig,states,behaviour}.ts`, `tests/states.test.ts`.
**How to verify:** state-machine tests (legal transitions, interruption safety); a contact-sheet screenshot of each state. Feel and timing are an owner-eyes item.

## Phase 11 — Fidelity gate (G0) `[MUST]`
**Goal:** Prove Chamgadad looks like her drawing, and get the owner's yes.
**Depends on:** 7, 9, 10.
**In scope:** `tools/fidelity.py`: render at the reference camera, compute silhouette overlap against the traced mask, write side-by-side and 50 percent overlay images; run it; fix the worst deviations; update `CB`; write `docs/checklists/OWNER_CHECKLIST_M2.md` UNFILLED (a table: each feature in the drawing, "looks like her drawing" tick, the `[A]` list, the behaviours); version bump `0.2.0`.
**Out of scope:** new features.
**Key files:** `tools/fidelity.py`, `docs/checklists/OWNER_CHECKLIST_M2.md`.
**Version:** 0.2.0 (gate G0).
**How to verify:** IoU reported with the number in the log; if under target, list the gap and fix or ask the owner. Typecheck, named tests, build. The owner's checklist is the real gate.

---

## MILESTONE 3 — The world (Phases 12–17)
*Exit criteria: a beautiful snowy Himalayan night with a cabin, pines, aurora, warm light and the cast, within the performance budget.*

## Phase 12 — Sky, mountains, aurora `[MUST]`
**Goal:** The ethereal backdrop that tells her where she is.
**Depends on:** 3; `AD`.
**In scope:** a gradient sky shader with a deep blue-hour palette, stars that twinkle (instanced points), 3 to 4 layered mountain silhouettes with atmospheric haze, a soft aurora ribbon (one animated shader quad, not volumetric), a moon, a slow parallax drift.
**Out of scope:** ground, trees.
**Key files:** `src/world/{sky,mountains,aurora,moon}.ts`.
**How to verify:** screenshots at three viewports; draw calls within `PB`.

## Phase 13 — Snow ground, snowfall, pines `[MUST]`
**Goal:** Ground you want to walk on, and snow that falls.
**Depends on:** 12.
**In scope:** a rolling snow terrain with soft drifts, sparkle on the surface, a GPU-friendly snowfall (instanced points with wind), **instanced pines** with snow-laden tiers and gentle sway, tier-aware counts (`PB`).
**Out of scope:** the cabin.
**Key files:** `src/world/{terrain,snowfall,pines}.ts`.
**How to verify:** screenshots; instance counts per tier logged; typecheck.

## Phase 14 — Cabin and the sleepy nook `[MUST]`
**Goal:** A Manali-style wooden cabin outside, and a cosy sleeping nook inside.
**Depends on:** 13; `SB`.
**In scope:** exterior cabin with a warm window glow, chimney smoke, a door she will open; interior nook for Act 1: bed with a blanket, a window onto the snow, a small lamp, a cup of cocoa with steam, a shelf; the optional "Dr." door plaque and "No roommates allowed" sign as hidden-by-default props (shown only with the owner's yes).
**Out of scope:** the cake and table (Phase 25).
**Key files:** `src/world/{cabin,nook,props}.ts`.
**How to verify:** screenshots of interior and exterior; the optional props are off by default and listed in the log.

## Phase 15 — Light, fog, bloom, colour grade `[MUST]`
**Goal:** Make it feel ethereal and warm, not like a game prototype.
**Depends on:** 14.
**In scope:** a lighting rig (cool moon key, warm window and lantern accents baked into the toon ramp and a few real point lights); height fog; a bloom pass on the low-resolution buffer (mid and high tiers only); a final grade; a **low tier path with no postprocessing** that still looks good.
**Out of scope:** new objects.
**Key files:** `src/render/post/*`, `src/world/lighting.ts`.
**How to verify:** screenshots of all three tiers side by side; the low tier is acceptable by eye. GPU cost is an owner-device gap.

## Phase 16 — The cat and the snow bunny `[MUST]`
**Goal:** Her two favourite animals, living in the scene, drawn in the same style as Chamgadad.
**Depends on:** 3, 10; `CB` (companion rules).
**In scope:** the cat (curled sleeping on the blanket, wakes, stretches, tail, ear flick, purr loop state) and the snow bunny (white-blue, its own proportions, clearly different from Chamgadad, peeks, hops, nose twitch); same toon ramp, ink wobble and eye language; simple rigs and state machines; low-poly budgets.
**Out of scope:** interaction wiring (Phase 20).
**Key files:** `src/character/{cat,bunny}/*`.
**How to verify:** contact-sheet screenshots of each state; triangle counts logged against `PB`.

## Phase 17 — Camera director and loading `[SHOULD]`
**Goal:** Cinematic, calm camera moves between acts, and a loading screen that is part of the gift.
**Depends on:** 14, 15.
**In scope:** a camera director (spline dollies, eased holds, a gentle handheld drift, the push-out through the cabin door), a boot sequence that streams assets and shows a soft falling-snow screen with a progress that never feels stuck, graceful failure messages ("this needs WebGL" in plain words).
**Out of scope:** interaction.
**Key files:** `src/core/director.ts`, `src/ui/boot.ts`.
**How to verify:** a frame sequence of the door push-out; a throttled-network test in headless Chromium for the boot screen.

**G1 (end of M3):** a lit, walkable, beautiful scene with Chamgadad, the cat and the bunny in it. Write `docs/checklists/OWNER_CHECKLIST_M3.md` UNFILLED at the end of Phase 17. Version `0.3.0`.

---

## MILESTONE 4 — Interaction (Phases 18–24)
*Exit criteria: she can wake Chamgadad, pet the animals, connect five name constellations, read five wishes, and hear the world.*

## Phase 18 — Input layer `[MUST]`
**Goal:** One input system for touch, mouse and device tilt.
**Depends on:** 2.
**In scope:** unified pointer events (tap, hold, drag, multi-touch safe), raycast picking with generous touch targets, **gyro parallax** (with permission handling on iOS and a graceful off), haptics (`navigator.vibrate` where supported), keyboard access for the whole flow.
**Out of scope:** meaning of the gestures.
**Key files:** `src/input/*`, `tests/input.test.ts`.
**How to verify:** tests on gesture classification (tap vs drag vs hold); a synthetic-touch run in headless Chromium. Gyro and haptics are owner-device gaps.

## Phase 19 — Waking Chamgadad (Act 1 to 2) `[MUST]`
**Goal:** The first thing she does is gently wake her own character, and it feels special.
**Depends on:** 10, 14, 17, 18.
**In scope:** the Act 1 choreography: Chamgadad asleep, the cat on its feet, snow outside; a soft hold-to-wake gesture with light rising as she holds; a "let her sleep" secret (if the viewer waits, the sleep deepens and a gentle line appears); the wake, stretch, look-at-you moment; eyes tracking the finger; Chamgadad walks to the door and opens it; the push-out into the snow.
**Out of scope:** the constellations.
**Key files:** `src/acts/act1_nook.ts`, `src/acts/act2_door.ts`.
**How to verify:** a frame-sequence of the whole wake and exit; state logs show every transition. Feel and timing are owner-eyes.

## Phase 20 — Petting and companion reactions `[SHOULD]`
**Goal:** Touching the animals is a small joy.
**Depends on:** 16, 18.
**In scope:** drag-to-pet the cat (purr loop, ear flick, slow blink back), the bunny hops toward a held finger and flees from a sudden tap, Chamgadad reacts to both (leans, smiles in the drawn line style); cooldowns so nothing spams.
**Out of scope:** sound (Phase 23).
**Key files:** `src/interaction/pet.ts`.
**How to verify:** interaction tests on the state machines; frame sequences.

## Phase 21 — Constellation engine `[MUST]`
**Goal:** A generic system for stars you connect.
**Depends on:** 18, 12.
**In scope:** star nodes with soft glow, a drag-to-connect mechanic that snaps to the next valid star, forgiving geometry, a line that draws like glowing frost, a completion burst, error-free on touch, a `ConstellationDef` data format (nodes, edges, order optional), hint behaviour after 8 seconds of nothing.
**Out of scope:** the five specific shapes.
**Key files:** `src/constellations/{engine,defs,fx}.ts`, `tests/constellation.test.ts`.
**How to verify:** tests for connection logic (valid, invalid, partial, undo); screenshots of an in-progress and a completed shape.

## Phase 22 — The five names in the sky `[MUST]`
**Goal:** Strawberry, Bumblebee, Rose, Kaaju Katli, Cutie Patootie, each as a shape she completes, each unlocking one wish from the owner.
**Depends on:** 21, 4.
**In scope:** five `ConstellationDef`s: a strawberry, a bumblebee, a frost rose (one flower, not a bouquet), a **diamond for kaaju katli**, and a cat-and-bunny shape for cutie patootie; each places in the sky so the order of discovery feels natural; completion triggers the wish card (text from `content/wishes.json`, never written by Claude); the star names appear softly; progress persists.
**Out of scope:** card typography (Phase 24).
**Key files:** `src/constellations/shapes/*`, `content/wishes.json`.
**How to verify:** a screenshot of each completed constellation; tests that every name in `content/names.json` has a shape and a wish slot.

## Phase 23 — Audio engine `[MUST]`
**Goal:** The world has sound, all synthesized, nothing to download.
**Depends on:** 18; `AU`.
**In scope:** Web Audio graph with a master limiter; an **audio unlock** on first touch (iOS rules); a wind-and-snow hush bed; star chimes tuned to one scale; soft footsteps in snow; a cat purr; a music-box arrangement of "Happy Birthday" (public-domain tune) for the finale; ducking when the letter opens; a mute button that is always visible; volume starts quiet.
**Out of scope:** microphone input (Phase 25).
**Key files:** `src/audio/*`, `docs/AUDIO_SPEC.md`.
**How to verify:** unit tests for scheduling and note math; an offline render of the melody to a WAV in the sandbox that the owner can listen to; real playback on her phone is an owner-device gap.

## Phase 24 — UI layer `[MUST]`
**Goal:** Every piece of text is beautiful and readable on a small phone.
**Depends on:** 4, 22.
**In scope:** the wish-card component, the letter reader typography (scroll, line length, font plan per the owner's language answer), mute and replay controls, a quiet "hold to wake" hint, safe-area handling, reduced-motion variants, focus order and ARIA, text contrast checks.
**Out of scope:** the letter ritual itself (Phase 27).
**Key files:** `src/ui/*`, `src/ui/theme.css`.
**How to verify:** screenshots of every UI state at 360x640, 390x780 and desktop; contrast ratios computed and logged.

**End of M4:** `docs/checklists/OWNER_CHECKLIST_M4.md` UNFILLED. Version `0.4.0`.

---

## MILESTONE 5 — The moments (Phases 25–28)
*Exit criteria: cake, candles, lanterns, letter and finale work end to end.*

## Phase 25 — The cake and the candles `[MUST]`
**Goal:** The birthday moment: she makes a wish and blows out the candles.
**Depends on:** 15, 23; `SB`.
**In scope:** a snow-table with a small cake (winter, not romantic: a snow-dusted sponge, no heart motifs), candle flame shader, a "make a wish" beat, **microphone blow detection** (volume plus a low-frequency breath signature, tuned to avoid false triggers from speech), the **tap fallback** that always works, permission denied handled gracefully and silently; the flames flicker, bend, go out one by one.
**Out of scope:** lanterns.
**Key files:** `src/acts/act4_cake.ts`, `src/audio/blow.ts`, `tests/blow.test.ts`.
**How to verify:** blow detector tests on synthetic buffers (breath vs speech vs silence); the fallback path in headless Chromium. The real microphone and iOS Safari are owner-device gaps and must be listed.

## Phase 26 — Lanterns and glitter `[SHOULD]`
**Goal:** The release after the wish: lanterns rising into the aurora and a soft snow-glitter burst.
**Depends on:** 25.
**In scope:** paper lanterns (instanced, soft emissive), rising path with sway, glitter particles, a hush then swell in the audio.
**Out of scope:** letter.
**Key files:** `src/fx/{lanterns,glitter}.ts`.
**How to verify:** frame-sequence screenshots; particle counts within `PB`.

## Phase 27 — The letter `[MUST]`
**Goal:** The owner's letter, delivered with care and rendered exactly as written.
**Depends on:** 24, 4.
**In scope:** the delivery ritual (a lantern drifts down carrying an envelope, or the envelope sits on the table: decided in `SB`), opening animation, the reader view with the owner's text from `content/letter.md` verbatim (line breaks, paragraphs, any Hindi or Hinglish as given), a "read again" path, a quiet sign-off from `content/credits.json`.
**Out of scope:** writing or editing the letter text. Ever.
**Key files:** `src/acts/act5_letter.ts`, `src/ui/letter.ts`, `tests/letter.test.ts`.
**How to verify:** a test that the rendered text equals the file text byte for byte; screenshots at three sizes with a long placeholder letter; a test that a production build fails loudly if `letter.md` still contains `TODO_OWNER`.

## Phase 28 — Finale and "stay a while" `[MUST]`
**Goal:** An ending worth the whole week, and a place to linger.
**Depends on:** 22, 26, 27.
**In scope:** the five constellations lift and join into one sky message (text from `content/credits.json`, the owner's wording), aurora swells, the camera pulls back through the pines, the music-box melody; then a free "stay a while" mode: wander the meadow, pet the animals, replay constellations and re-read wishes.
**Out of scope:** new mechanics.
**Key files:** `src/acts/act6_finale.ts`, `src/acts/stayAwhile.ts`.
**How to verify:** frame sequence of the finale; a test that stay-a-while never traps the user (always an exit to the letter and the replay).

**G2 (end of M5):** the card works start to finish. `docs/checklists/OWNER_CHECKLIST_M5.md` UNFILLED. Version `0.5.0`.

---

## MILESTONE 6 — Lock, secrets, resilience (Phases 29–31)
*Exit criteria: it stays locked until midnight IST, hides small secrets, and survives bad hostel Wi-Fi.*

## Phase 29 — The lock `[MUST]` — DROPPED by the owner (no lock; the link is sent on the day)
**Goal:** A waiting screen that is itself a small gift, then the unlock at 00:00 IST.
**Depends on:** 4, 17.
**In scope:** the lock scene: a snow globe or a quiet frosted window with the countdown in days, hours, minutes, seconds; it tracks real time (a re-check against a server time endpoint on Vercel so a changed phone clock does not unlock it early, with a safe fallback to the device clock if the call fails); the moment it hits zero while open, the globe cracks open into the real scene; preview key bypass for the owner only; wording from the owner (`content/`), never romantic.
**Out of scope:** anything after unlock.
**Key files:** `src/acts/act0_lock.ts`, `api/time.ts`, `tests/lock.test.ts`.
**How to verify:** lock tests with a fake clock (before, exactly at, after; clock skew; endpoint failure); a headless run with the clock faked past the unlock time. Real wall-clock behaviour on 10 Nov is an owner item.

## Phase 30 — Easter eggs `[COULD]` — SKIPPED by the owner
**Goal:** Little rewards for curiosity.
**Depends on:** 22, 16, 19.
**In scope:** tap the moon five times and it puts on a party hat; the hidden kaaju katli sweet; a sleepy-secret creature that appears only after ten seconds of stillness; the optional kiwi-bird cameo (owner's yes needed); the optional roommate sign; each secret recorded in progress and counted in a quiet "N of M found" in stay-a-while mode.
**Out of scope:** anything mean about a real person.
**Key files:** `src/secrets/*`.
**How to verify:** tests for each trigger; a screenshot of each secret. Optional ones are off unless the owner said yes (logged).

## Phase 31 — Resilience: offline, reduced motion, low power `[SHOULD]`
**Goal:** It works on slow hostel Wi-Fi and on a tired phone.
**Depends on:** 2, 15.
**In scope:** a service worker that caches the app shell and assets after first load (so a second open is instant and survives a weak connection), a "reduced motion" mode that really calms the card, a **low-power mode** (30 fps cap, no postprocessing, fewer particles) offered automatically by the watchdog, total download budget enforced in the build.
**Out of scope:** installable-app polish.
**Key files:** `public/sw.js`, `src/core/power.ts`, `vite.config.ts`.
**How to verify:** a build-size gate test; a headless offline reload test; reduced-motion screenshots.

**End of M6:** `docs/checklists/OWNER_CHECKLIST_M6.md` UNFILLED. Version `0.6.0`.

---

## MILESTONE 7 — Ship (Phases 32–36)
*Exit criteria: it runs well on her kind of phone, previews nicely on WhatsApp, is unlisted, and is tagged `v1.0.0`.*

## Phase 32 — Performance pass `[MUST]`
**Goal:** Hit `PB` on a mid-range phone.
**Depends on:** all scene phases.
**In scope:** profile draw calls, triangles, overdraw, texture memory and shader cost; merge geometries, instance more, shrink textures, trim postprocessing; tune the tier table and the watchdog thresholds from real numbers the owner sends from `?debug` on their phone.
**Out of scope:** new features.
**Key files:** `docs/PERF_BUDGET.md`, `src/core/quality.ts`.
**How to verify:** sandbox numbers (draw calls, triangles, bundle size) vs `PB`; owner-supplied phone numbers go in the log. Without owner numbers this phase is marked "partial".

## Phase 33 — Mobile and browser quirks `[MUST]`
**Goal:** No surprises on iOS Safari or Android Chrome.
**Depends on:** 32.
**In scope:** `100dvh` and safe areas, audio unlock, microphone permission flow, gyro permission flow, orientation lock behaviour, pull-to-refresh and overscroll suppression, double-tap zoom off, in-app browsers (WhatsApp, Instagram) detection with a friendly "open in your browser" nudge, an unsupported-WebGL fallback page that is still warm.
**Out of scope:** new features.
**Key files:** `src/core/platform.ts`, `src/ui/fallback.ts`.
**How to verify:** emulated iPhone and Pixel profiles in headless Chromium; real iOS Safari and WhatsApp in-app browser are owner-device gaps.

## Phase 34 — Link preview, privacy, content freeze `[MUST]`
**Goal:** What shows when the link is sent, no leaks, and final words.
**Depends on:** 29, 33.
**In scope:** Open Graph and Twitter tags with a custom preview image that spoils nothing, a neutral title (the lock screen's wording), `noindex` everywhere, a scan of the built bundle for anything private (username, city, college, `TODO_OWNER`), the owner's final `content/` frozen and committed, a source map policy (no public source maps).
**Out of scope:** new features.
**Key files:** `index.html`, `public/og.png`, `tools/leak_scan.mjs`.
**How to verify:** the leak scan passes on `dist/`; the preview image viewed; headers checked on the live URL.

## Phase 35 — Owner device test and fix pack `[MUST]`
**Goal:** Fix what the owner finds on a real phone.
**Depends on:** 34 and the owner's filled checklists.
**In scope:** only listed problems (screenshots and a screen recording help); each fix recorded; re-run the named checks.
**Out of scope:** anything not on the owner's list.
**Key files:** per report.
**How to verify:** the named screenshots and tests per fix; the owner re-tests.

## Phase 36 — Release gate (G3) `[MUST]`
**Goal:** Ship `v1.0.0`.
**Depends on:** 35.
**In scope:** typecheck once, the named test files, build, leak scan, headless full-run smoke test with the clock faked past unlock, reconcile `PHASE_STATUS.md`, `docs/checklists/OWNER_CHECKLIST_FINAL.md` UNFILLED (a short 2-minute pre-send checklist: opens, unlock time, sound on, letter reads, link preview), bump `1.0.0`, hand back the changed-files zip and the `release` script steps with tag `v1.0.0`.
**Out of scope:** anything new.
**Key files:** docs, `package.json`.
**Version:** 1.0.0.
**How to verify:** typecheck once, named tests green, build green, leak scan clean; real-phone behaviour is never written as "verified" from the sandbox.
