# Phase 21 handoff (constellation engine): FINISHED in the second session (kept for the record; nothing left to do)

Read CLAUDE_MUST_READ.md, PHASE_STATUS.md "Current state" (the Phase 21 block), PHASES.md Phase 21 only. Dependencies 12 and 18 are done. Do ONLY Phase 21.

## State
All code is written and works in the browser (see the Phase 21 block for the list). Engine tests 41 pass, boundaries 3 pass, typecheck and build clean, real input mouse 8/8, keys 5/5, touch 16/16 (touch before the last edit).

## Still to do
1. `npm ci`, `npm run typecheck`, `npx vitest run tests/constellation.test.ts tests/boundaries.test.ts`, `npm run build`.
2. Real input, one command each, `PORT=<own> timeout 290 python3 tools/stars_input.py <section>` (build first): `touch` (re-run), `hint` (never run; waits for the page's own 8 s, can take a couple of minutes), `calls` (never run; draw calls at tier low). `mouse` and `keys` already pass; re-run only if you change code. Do NOT use `pkill -f` with words from your own command line.
3. Re-shoot and LOOK (two edits were never looked at): `python3 tools/stars_frames.py docs/phase21/<out> 390x780 "stars&pre=3&drag=c@-0.15,-0.95" 0.5`, `"stars&pre=7" 0.4 3`, and 1280x720 `"stars&pre=4"`. Check the line is a thin frost line on desktop (about 1.9 px half-width) and the patch sits clear of the mountains.
4. Update PHASE_STATUS (mark Phase 21 done only after step 2 passes), no version bump, no checklist. Hand back the WHOLE project zip, the commit line `Phase 21: Constellation engine`, 3 lines on what to see.

## Notes
- Try on the preview: `?stars` (drag star to star, or tap then tap, or Tab + Enter; `u` undoes), `?stars=path` (ordered), `&reduced`, `&pre=3`, `&at=9` (hint).
- The five real shapes, where they sit, wish cards and persistence are Phase 22. The demo shapes carry no words.
- Every number is `[A]`.

_Screenshots from Phases 18 to 20 and the superseded Phase 21 frames were removed to keep the repo small. Logs and JSON are kept. Re-shoot with the tools in `tools/` if a frame is needed. The final Phase 21 frames are in `docs/phase21/final/`._
