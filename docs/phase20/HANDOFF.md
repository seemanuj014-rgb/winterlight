# Phase 20 handoff (petting and companion reactions) — FINISHED in the fourth session (kept for history; nothing left to do except the owner questions below)

Read CLAUDE_MUST_READ.md, PHASE_STATUS.md "Current state" (the Phase 20 block), PHASES.md Phase 20 only. Dependencies 16 and 18 are done. Do ONLY Phase 20.

## State
Code is written and works in the browser. Typecheck clean; `npx vitest run tests/pet.test.ts tests/boundaries.test.ts tests/companions.test.ts tests/director.test.ts` = 131 pass; build clean (all re-run after the last edit). Done and looked at: reduced-motion frames, desktop frames, draw calls (53 nook / 54 outside at low tier), real-input `cat` section 17/17. The `petCat` shot was reframed this session (desktop cropped her head).

## Still to do
1. `npm ci`, `npm run typecheck`, the four test files, `npm run build`.
2. Real input, one command each, `PORT=<own> timeout 290 python3 tools/pet_input.py <section>` (the page needs `npm run build` first):
   - `bunny`: touch hold near her, tap near her, far tap. Never run. If the hold does not make her hop, the finger offsets in `run_bunny` may need adjusting (it tries four); check with a screenshot.
   - `keys`: Tab + Enter / arrows on the cat, Tab + Enter on the bunny. Never run.
   `cat` and `calls` already pass (json in `docs/phase20/input/`); re-run only if you change code. LOOK at the images in `docs/phase20/input/`.
   Tip: do NOT use `pkill -f` with words from your own command line.
3. If you change a shot or the pet code, re-run the frames with `python3 tools/pet_frames.py <out> <WxH> "<query>" t1 t2 ...` and look.
4. Update PHASE_STATUS (mark Phase 20 ✅ only after step 2 passes), no version bump, no checklist. Hand back the WHOLE project zip (the owner wants the entire zip), the commit line `Phase 20: Petting and companion reactions`, 3 lines on what to see.

## Decisions to tell the owner
- **"Smiles in the drawn line style" was NOT done**: Chamgadad has no mouth (Q1 open, CHARACTER_BIBLE forbids inventing one). Happiness = lean + slow blink + ear flick. Ask whether they want a smile (needs Q1).
- The `petCat` shot is a compromise: whole head on desktop, a bit smaller cat on a phone.
- Try on the preview: `?pet` (drag over the cat, or hold), `?pet=bunny` (hold on the snow near her, tap near her), `&reduced`.
- Every number is `[A]`.

## Known, left
- The animals do not look at the finger (`lookAt` is overwritten each frame).
- The hide pose only sinks 0.15 m into flat snow (reads as ducking, no bank).
- The bunny is small on a phone.
