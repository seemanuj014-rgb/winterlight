# PERF_BUDGET (PB)

Targets are `[A]` until Phase 32 calibrates them with numbers from her actual phone class (`?debug` overlay). Her phone is unknown; assume a mid-range Android or a recent iPhone, on weak hostel Wi-Fi.

| Budget | low | mid | high |
|---|---|---|---|
| Max pixel ratio | 1.25 | 1.75 | 2 |
| Draw calls (scene) | ≤ 60 | ≤ 90 | ≤ 130 |
| Triangles (scene) | ≤ 80k | ≤ 150k | ≤ 250k |
| Particles | ≤ 800 | ≤ 2,500 | ≤ 6,000 |
| Postprocessing | off | bloom at half res | bloom + grade |
| Texture memory | ≤ 32 MB | ≤ 48 MB | ≤ 64 MB |
| Target frame rate | 30 | 45 to 60 | 60 |

- **Download:** first load ≤ 2.5 MB transferred (JS, fonts, any images), interactive in about 4 s on a decent 4G connection. Everything is code-generated: no models, no audio files, no big textures.
- **Tier selection:** by hardware hints and reduced-motion at start; the FPS watchdog only ever steps *down*, within a session.
- **Rules:** instance anything repeated (pines, stars, snow, lanterns); merge static geometry; bake noise into small textures; no real-time shadows (fake them with blobs and baked gradients); one renderer; dispose what you remove; pause when hidden.
- **Measure:** `?debug` shows tier, fps, draw calls, triangles, texture MB. The owner screenshots it on her kind of phone and sends it back.

## Phase 27 note: the envelope (read from `?envelope&debug&tier=low`, software GL, `[A]`)

The lantern-and-envelope picture is **4 draw calls** (one merged mesh for lantern, threads and envelope, the flap, the letter, one halo point), about 330 triangles, no textures, no lights. The whole `?envelope` scene (backdrop, ground, cake, envelope) reads **22 calls at low tier** (limit 60). **For Phase 28:** outdoor scenes were already 57 to 58 of 60 at low tier, the cake adds 3 and the envelope 4: the release's lanterns are gone before the envelope arrives (`release:done`), but the full card must still hide something (the cabin, a sky shape or the bunny) while the envelope hangs. The halo is additive; the view asks the post pass for the release's 0.4 glow gain `[A]`.

## Phase 26 note: lanterns and glitter (read from `?release&debug&tier=...`, software GL, `[A]`)

| | low | mid | high |
|---|---|---|---|
| Lanterns (paper, instanced) | 7 | 12 | 18 |
| Lantern halos (one Points, one point each) | 7 | 12 | 18 |
| Glitter specks (one Points) | 120 | 320 | 640 |
| Draw calls, lanterns + glitter | 3 (lanterns 2, glitter 1) | 3 | 3 |
| Scene draw calls, whole `?release` view | 18 | 18 (+4 post passes = 22) | 18 (+7 post passes = 25) |
| Triangles, lanterns only | 84 | 144 | 216 |

- Reduced motion has half the lanterns and half the glitter.
- **Particles at low are tight: 797 of 800** (320 stars + 340 snow + 10 cake points + 7 halos + 120 glitter). A test (`tests/fx.test.ts`) proves the sum fits at every tier. Anything that adds particles to the release scene at low must take some from here.
- **Phase 28 must budget the whole card:** the release view alone is 18 calls, but outdoor scenes were already 57 to 58 of 60 at low tier, and the cake adds 3. The full card has to hide something (the cabin, a sky shape, the bunny) while the cake and the release play.
- The release view asks the post pass for 0.4 of its glow (`stage.setBloomGain`, `&bloom=` to tune): at full strength the lanterns on mid and high wash to white and lose their shape.

## Phase 28 note: the draw-call plan for stay a while (read from the page at `&debug&tier=low&nopost`, software GL, 390x780, `[A]`)

- Measured: `?stay` level 29, `?stay` looking up 25, `?pet=bunny` 54, `?pet` (cat) 53, `?world&cabin` 19. Parts: backdrop 8, ground 4, cabin 7, sky shapes 10, Chamgadad 30, bunny 9 (`src/acts/stayBudgetMath.ts`).
- **Rule: the animals and the five sky shapes are never drawn together.** Level = valley + Chamgadad + bunny = 58 of 60 (two to spare); looking up = valley + sky = 29. All at once would be 98.
- Not yet applied in a view; the cat stays in the nook. The full card's order of acts (release 18, envelope 4, cake 3) still has to be planned the same way.

## Phase 28 close: the whole card, stage by stage (session 13, read off the page: `?card`, 390x780, `&debug&tier=low&nopost`, software GL, `[A]`)

- **One stage is drawn at a time.** `?card` builds the next stage's view when the last one says it is done and clears the scene between them (a dip to night covers the cut; none with reduced motion). So the old worry (everything in one scene = 57 to 58 of 60 plus the cake, the release and the envelope) does not arise: each stage keeps the count it had on its own view.
- Draw calls per stage at low: cake 15, release 18, envelope 22, finale 28, stay a while 58 (the level look; 25 looking up), sky about 25 to 30. The limit is 60; the closest is stay a while at 58, with the animals-and-sky-never-together rule above.
- Cost of this design: a cut (with a dip) between stages instead of one continuous world; the cabin, the table and the pines are rebuilt per stage (a short hitch on a slow phone is possible: an owner-device item).
- Not measured: frame rate or memory on a real phone over the whole chain; the old scene's textures are disposed by `cardView.wipe`, but nothing here proves there is no slow leak over a long stay.
