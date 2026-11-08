Winterlight starter pack v0.0.1  (Phase 0)
==========================================
1. Unzip. You get one folder: winterlight/  (this is the repo).
2. Install Node 22+ and Git. In a terminal inside winterlight/ run:
      npm ci
      npm run dev
   You should see a grey-blue shape (the outline of Chamgadad's head, ears and chest) slowly turning on a dark blue page.
3. Open a NEW Claude.ai chat, upload this whole folder (or the zip), and say:
      "Read CLAUDE_MUST_READ.md, then do Phase 1."
   Each session: Claude does ONE phase, updates PHASE_STATUS.md, and hands you winterlight_phaseN_changed_files.zip.
4. Extract that zip over the repo folder (replace files), then run:
      Windows:  powershell -ExecutionPolicy Bypass -File .\scripts\push_phase.ps1 -Message "Phase N: title"
      Mac/Linux: bash scripts/push_phase.sh "Phase N: title"
   That pushes branch dev; Vercel builds a preview link to open on your phone.
5. At gates (after Phases 11, 17, 28, 36) Claude gives you an UNFILLED checklist in docs/checklists/. Fill it on a real phone and send it back.

Do these first (they unblock later phases):
  - Answer the open questions at the bottom of REQUIREMENTS_ORIGINAL.md.
  - Gather more views of her character if she has them (full body, side, back). Put them in character/reference/.
  - Start writing your letter into content/letter.md and the five wishes into content/wishes.json. Claude never writes these.

Keep the GitHub repo PRIVATE. Send her the link only after the final phase (and ideally on 10 Nov itself).

What Claude ran for this pack: install, typecheck, 8 tests, build, and headless-browser screenshots.
What Claude did NOT run: git, GitHub, Vercel, any real phone. Phase 1 proves those with you.
