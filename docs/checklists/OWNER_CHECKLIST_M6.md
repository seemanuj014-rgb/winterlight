# Milestone 6 — Owner's checklist (resilience; no lock, no easter eggs)

Handed over UNFILLED by Phase 31 (2026-11-08), version 0.6.0. Nothing below was run on a real phone by Claude: the sandbox runs typecheck, named tests, builds and headless screenshots only. Tick each line on **her kind of phone** and write what you see next to anything that fails. Items marked [A] are unconfirmed assumptions. Report problems by item number with a screenshot or short screen recording.

Date checked: ____________  Phone model and OS: ____________  Browser: ____________  Network: ____________

## 1. State after this milestone (from the code, not from a screen)
- Phase 29 (the lock) was dropped by the owner: the link is sent on the day. The old lock and preview-key code was removed.
- Phase 30 (easter eggs) was skipped by the owner.
- Phase 31: `public/sw.js` (offline shell, registered on production builds only), `src/core/power.ts` (low power: 30 fps cap once the card is at its lowest tier and still slow; `?lowpower` forces it), a build gate that fails if the first load goes over 2.5 MB gzip. Reduced motion was already in every act; nothing new was added to it.

## 2. Checks
| # | Check | OK | What I saw |
|---|---|---|---|
| 1 | Open the live link once on Wi-Fi, switch to aeroplane mode, close the tab, open the link again: the card still opens | [ ] | |
| 2 | After a new deploy, open the link on good Wi-Fi: you see the new version (not the old one) | [ ] | |
| 3 | Phone with "reduce motion" on: the card is calm (no sway, short beats) | [ ] | |
| 4 | Old or slow phone: it still plays; if it is choppy, add `?lowpower` and compare | [ ] | |
| 5 | First load on mobile data feels quick (about 4 s) | [ ] | |

## 3. Problems
| Item # | What is wrong | Screenshot? |
|---|---|---|
| | | |

## 4. Decisions for the owner
- Battery-saver detection was not added (iOS has no API for it); low power only starts from a slow frame rate.
