# FINAL — 2-minute pre-send checklist (v1.0.0)

Handed over UNFILLED by Phase 36 (2026-11-08). Do this on the LIVE link, on a phone, right before you send it. Nothing here was run by Claude on a real phone.

Date: ____________  Phone: ____________  Browser: ____________

## Before you push to main (on your computer, once)
- [ ] `content/letter.md`, all 5 lines in `content/wishes.json` and all 3 in `content/credits.json` are your real words (no `TODO_OWNER`; a production build refuses otherwise)
- [ ] `npm ci`, `npm run typecheck`, `npm test`, `npm run build` are all green
- [ ] Her username, city and college are in `tools/leak_terms.local.txt`, and `npm run leak-scan` prints OK
- [ ] `bash scripts/release.sh 1.0.0` (merges `dev` into `main`, tags `v1.0.0`); Vercel production deploy finished

## On the live link
| # | Check | OK |
|---|---|---|
| 1 | The link opens (there is no lock: it opens for anyone with the link) | [ ] |
| 2 | Sound: tap once, you hear the quiet music and the mute button works | [ ] |
| 3 | Wake Chamgadad, go out, make the five names in the sky | [ ] |
| 4 | Cake and candles, the lanterns, then the letter reads in your words | [ ] |
| 5 | The finale, then "stay a while", and both exits (letter, replay) work | [ ] |
| 6 | Paste the link in WhatsApp: the preview is the dark snowy picture titled "Something for you" | [ ] |
| 7 | Open it once, go offline, open again: it still loads | [ ] |

## Decisions still open
- Phase 29 (lock), 30 (easter eggs) were dropped by you. Phase 32 (performance) is partial: no real-phone numbers. Phase 35 had no owner list.
