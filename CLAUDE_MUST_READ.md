# CLAUDE_MUST_READ — Winterlight

Read this first, every session. It is short on purpose.

## What this project is
A 3D winter birthday card for **Dhana** (Shruti), whose birthday is **10 Nov 2026**, made by her close friend (the **owner**, who she calls "Kiwii"). It is a gift between friends. Claude builds it, phase by phase, in claude.ai sessions. The owner writes the letter. Nothing here is a template: every choice should feel like it was made for her.

## Read order each session
1. This file.
2. `PHASE_STATUS.md` → only the "Current state" block and your phase's row. Never read it cover to cover; `grep -n` for the rest.
3. `PHASES.md` → only your phase. Rule files it names are binding for that phase.
4. `CHARACTER_BIBLE.md` if the phase touches Chamgadad, the cat or the bunny.
5. `docs/design/ART_DIRECTION.md` if the phase touches anything visual.

## Hard rules (these override a phase if they conflict)
1. **The letter is the owner's.** Never write, rewrite, "improve" or translate anything in `content/letter.md`. Render it exactly as given. Same for `content/wishes.json` text: placeholders stay placeholders until the owner fills them.
2. **Chamgadad is hers, not ours.** Dhana is a human and never appears on screen; the viewer is Dhana. Chamgadad is a character she drew (the owner named it; the name means nothing). Follow `CHARACTER_BIBLE.md`: measure, do not guess; add nothing that is not in a reference (no nose, whiskers, blush, tufts); never infer a species from the ears or the name; never "cutify" or redesign; every extrapolation is flagged `[A]` and needs the owner's OK; accessories default OFF.
3. **Tone = warm friendship.** No romance coding: no hearts-as-romance, no couple imagery, no candlelit-dinner framing, no bouquet. Cosy, sleepy, ethereal, funny, kind. The owner said plainly they are not a couple. Keep it that way in visuals, wording and easter eggs.
4. **Privacy.** The repo stays private. Do not put her Roblox username, city, college or anything not in `content/` into shipped code or page text unless the owner approved it there. The deployed URL is unlisted (`noindex`) but public: assume anyone who has the link can read every byte.
5. **Honesty rule.** Say what was run and what was not. The sandbox can build, typecheck, run tests, and render screenshots in headless Chromium with *software* WebGL (`tools/shot.py`). It cannot prove frame rate, battery, a real phone GPU, the microphone, audio output, or iOS Safari behaviour. Those are logged as **owner-device gaps**, never written as "verified".
6. **No full-suite sweeps** unless the phase says so. Do the phase's verify step (typecheck once, the named tests, the named screenshots).
7. **Edit in place.** Never regenerate `PHASES.md` or `PHASE_STATUS.md`. Never renumber a completed phase. If a phase is too big, split it and renumber forward, and say so in `PHASE_STATUS.md`.
8. **Budget before beauty.** `docs/PERF_BUDGET.md` is binding. A gorgeous scene that stutters on her phone is a failed phase.
9. **Dates are real.** Unlock is `2026-11-10T00:00:00+05:30` (IST). Ship line is the evening of **9 Nov**. If a phase will not fit, use the cut list in `PHASES.md`, do not silently shrink quality.

## Ending a session (always, in this order)
1. Typecheck once; run only the tests the phase names; run `npm run build`; for visual phases run `python3 tools/shot.py` and *look* at the images.
2. Update `PHASE_STATUS.md`: add the phase row to "Current state" (top), append a log entry at the bottom. State what ran, what did not, and the owner-device gaps.
3. If the phase finishes a milestone, write `docs/checklists/OWNER_CHECKLIST_M<n>.md` UNFILLED, from `docs/checklists/TEMPLATE.md`.
4. Hand back: **(a)** `winterlight_phase<N>_changed_files.zip` containing only changed/added files with their paths from the repo root, **(b)** the commit line to use, **(c)** a 3-line "what you should see" for the owner.
5. Never claim a phase is done if its "How to verify" was not run.

## Owner workflow (for reference)
Extract the changed-files zip over the repo, run `scripts/push_phase.ps1` (Windows) or `scripts/push_phase.sh`. That pushes branch `dev`; Vercel builds a preview URL automatically. At gates the owner runs `scripts/release.ps1`/`.sh` to merge `dev` into `main` (production) and tag it. Details: `docs/DEPLOY_VERCEL.md`.
