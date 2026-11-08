# FINISHED in the third session (2026-11-06). Everything below was done; see PHASE_STATUS.md. Kept for the record.

# Phase 24 (UI layer) — HANDOFF for the next Claude session

**Status: PARTIAL (about three quarters done; sessions 1 and 2).** Items 1, 3 (restyle only), 4, 6 (partly) and part of 8 below are DONE (see "Done in session 2"). Do what is left, then close the phase. Read `CLAUDE_MUST_READ.md` first; then this file; then `PHASES.md` Phase 24 only.

## Done in session 1 (verified; see PHASE_STATUS.md for what ran)
- `src/ui/theme.css` (imported first in `src/main.ts`): colour variables, system font stacks with Devanagari fallbacks, safe-area variables, `.wl-card`, `.wl-label`, reduced-motion rules, short-screen rule.
- `src/ui/themeMath.ts` (PURE, in the boundaries PURE set): `THEME` colours, `TEXT_PAIRS`, WCAG `contrast` / `luminance` / `over` / `checkPair` / `checkAll`, `charsPerLine`, `cardBox`.
- `src/ui/wishCard.ts`: the wish-card component (dialog role, focus in and back, Escape / Enter / Space / tap close, queue, optional `closeCue` text from the caller, no words of its own). `src/ui/skyText.ts` now uses it; the text still passes through untouched.
- `tests/ui.test.ts` (25) writes `docs/phase24/contrast.json`; `tools/ui_check.py` (39 browser checks).

## Done in session 2 (verified)
- `src/ui/letterReader.ts` + `.wl-letter*` in `theme.css`: dialog panel, `textContent` + `pre-wrap` (exact text), scroll, 44x44 close button (name from the caller), Escape, focus in and back, `progress()` 0..1 for Phase 27, reduced-motion variant. Test view `?letter` (`src/acts/letterView.ts`; `&text=` is for made-up layout tests only). Its two labels ("Close the letter", "Letter") are plain functional words, flagged.
- Sound button: its look moved from inline style to `.mute-button` in `theme.css` (same 44x44 top-right place, safe areas, keyboard focus ring). `src/acts/hud.ts` (hint and owner's line) now reads the theme variables for colour, font and safe areas.
- `themeMath.ts`: contrast rows `letter-text` and `letter-close-glyph` added; `tests/ui.test.ts` is 37 tests; `tools/ui_check.py` is 73 checks.

## STILL TO DO — in this order (items 1, 3 restyle, 4 and part of 6 and 8 are done, see above)
1. ~~DONE~~ **Letter reader typography** (`src/ui/letterReader.ts` + CSS in `theme.css`): a scrolling panel for `content/letter.md` rendered EXACTLY (line breaks kept, `white-space: pre-wrap`, `textContent`, never trimmed or edited). Measure about 30 to 45 characters per line on a phone, generous line height, safe areas, a way out (Escape, a close control), focus in and back, reduced-motion variant. It must not depend on the letter existing: `letter.md` is still `TODO_OWNER`, so test with a made-up string in the TOOL, never in `content/`. The letter RITUAL (opening, ducking trigger) is Phase 27, out of scope.
2. **Fonts:** the language answer (Q6 in `REQUIREMENTS_ORIGINAL.md`) is still unanswered. Ask the owner in one short list: English only, Hindi too, or Hinglish? If Hindi or Hinglish, plan a self-hosted Devanagari face (no network in the sandbox for fonts: ask the owner to supply or approve one, do not invent). Until answered, the system stacks stay.
3. **Replay control** (the restyle is DONE; only the replay control is left). Original text: **Mute button restyle** (`src/audio/muteButton.ts`): it is built and always visible (44x44, top right). Restyle through theme variables (keep it in `audio/`, which may not import `ui/`: either copy the numbers or move the style into `theme.css` by class name `mute-button`). Add a **replay control** (replay the music box / replay the sky wishes? decide with the owner; ask first if unclear). Keep the labels plain and flagged.
4. ~~DONE (theme variables)~~ **"Hold to wake" hint and the owner's line** (`src/acts/hud.ts`): restyle to the theme (same fade rules; the owner's `sleep_line` text stays verbatim from `content/nook.json`). The hint words come from `content/`, check where they live before touching.
5. **Focus order and ARIA** across the UI: tab order (mute, then the scene), the wish card as a dialog (done), live regions not announcing twice, `aria-label`s only from `content/` or plain functional words (flag them).
6. **Reduced-motion variants** for hint, line and buttons (the card and labels are done).
7. **Screenshots of EVERY UI state** at 360x640, 390x780 and 1280x720 (wish card, long wish, names, mute on/off, hint, owner's line, letter reader). `tools/ui_check.py` is the base; extend it. LOOK at them. Keep only contact sheets in `docs/phase24/` (the repo was trimmed on purpose).
8. **Contrast:** add every new text pair to `TEXT_PAIRS` in `themeMath.ts` (letter text, hint on the real nook colours, mute glyph), rerun `npx vitest run tests/ui.test.ts`, which rewrites `docs/phase24/contrast.json`.
9. **End of M4 (this is the last phase of the milestone):** write `docs/checklists/OWNER_CHECKLIST_M4.md` UNFILLED from `docs/checklists/TEMPLATE.md`; bump the version to `0.4.0` in `package.json` and `package-lock.json`; update `PHASE_STATUS.md` (replace this PARTIAL entry, set the table row, append the log); commit line `Phase 24: UI layer`.
10. Verify: `npm run typecheck`, `npx vitest run tests/ui.test.ts tests/boundaries.test.ts tests/shapes.test.ts` (plus the tests of any file you touch), `npm run build`, `python3 tools/ui_check.py`, `python3 tools/sky_input.py touch` (the card is shared with Phase 22), `python3 tools/audio_check.py` if the mute button changes.

## Things to know
- `wishes.json` are all `TODO_OWNER`; the card shows that text as is. Never write wishes.
- The card sits over the sky, so its surface is 90 % opaque and was checked against the three brightest scene colours (snow, horizon glow, far mountains): 12.78:1 for the text.
- On a touch tap the browser moves focus to the canvas after the card opens, so `wishCard.ts` takes focus back once after 60 ms. Do not remove that without re-running `ui_check.py` at 360x640.
- Not run yet (owner-device): real phone look, her fonts, Dynamic Type / text zoom, iOS Safari safe areas (they were faked with `--safe-*` in the browser tool), a screen reader.
