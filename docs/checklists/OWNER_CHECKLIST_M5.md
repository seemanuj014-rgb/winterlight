# Milestone 5 — Owner's checklist (The ending and stay a while)

Handed over UNFILLED by Phase 28 (2026-11-08), version 0.5.0. Nothing below was run on a real phone by Claude: the sandbox runs typecheck, named tests, builds and headless screenshots (software WebGL) only. Tick each line on **her kind of phone** and write what you see next to anything that fails. Items marked [A] are unconfirmed assumptions. Report problems by item number with a screenshot or short screen recording.

Date checked: ____________  Phone model and OS: ____________  Browser: ____________  Network: ____________

How to look: open the Vercel preview URL (branch `dev`). The whole run from the sky to stay a while: `?card&sound` (add `&from=cake`, `release`, `envelope`, `finale` or `stay` to start part-way; `&done=strawberry,bumblebee,rose,kaaju-katli,cutie-patootie` to skip the sky). Single views: `?finale&sound`, `?stay&sound`.

## 1. State after this milestone (from the code, not from a screen)
- `?card` plays sky -> cake -> release -> the lantern and envelope -> the letter -> the finale -> stay a while, one stage at a time with a dip to night between them. **Acts 1 and 2 (the nook and the door, `?acts`) are NOT chained in front of the sky yet, and the lock (act 0) is Phase 29.** The default page is still the flat silhouette.
- The sky hands over to the cake only when all five names are done [A: my reading of the storyboard; nothing is timed, and what she has finished is kept between visits].
- The finale: the five shapes lift and join into your message (`finale_sky_message` in `content/credits.json`, which is still `TODO_OWNER`), the aurora swells, the music box plays, the camera pulls back to the cabin. Then stay a while.
- Stay a while: turn the view by dragging or with the arrow keys (Home recentres), pet the bunny (press on her, or hold or tap the B key), re-read the wishes, and two exits that are always there: the letter again, and the ending again (the real finale picture plays, then she is back).
- Footsteps are NOT in stay a while [A]: nobody walks there (the view only turns), so there is nothing to step. The sound ducks under the wish card and the letter.
- Everything numeric is mine [A]: timings, the crown layout, the aurora swell, the pet leash, the dip.
- `content/letter.md`, `content/wishes.json` and Chamgadad's look were not touched. A production build still refuses to ship while placeholders remain.

## 2. Checks: the run (`?card&sound`)
| # | Check | OK | What I saw |
|---|---|---|---|
| 1 | The five names finished, one after another, then the cake appears after a short dip to night | [ ] | |
| 2 | The cake: blowing on the phone puts the candles out (or a tap does); the dip between stages is gentle, not a flash | [ ] | |
| 3 | The lanterns rise and the glitter drifts; the sound hushes and then swells | [ ] | |
| 4 | A lantern brings the envelope; a tap on it opens it; the letter reads exactly as you wrote it; closing it moves on | [ ] | |
| 5 | The finale: the five shapes lift, join, show your message in the sky; the music box plays; the camera pulls back to the cabin | [ ] | |
| 6 | The message is readable on her phone (not too small), with nothing cut off | [ ] | |
| 7 | Frame rate is smooth enough through the whole run; the phone does not get hot; no hitch when a stage changes | [ ] | |

## 3. Checks: stay a while
| # | Check | OK | What I saw |
|---|---|---|---|
| 8 | Dragging turns the view slowly; looking up shows the five shapes; nothing can get her stuck | [ ] | |
| 9 | Pressing on the bunny: she startles and hides, then peeks back; holding a finger near her makes her hop toward it | [ ] | |
| 10 | The wishes button shows every wish card in order; the sound softly lowers while a card is open | [ ] | |
| 11 | The "letter" button opens the real letter and putting it away brings her back | [ ] | |
| 12 | The "ending again" button plays the whole finale again and brings her back | [ ] | |
| 13 | Both buttons are easy to find and hit with a thumb and say their names to a screen reader | [ ] | |
| 14 | With a keyboard: arrows turn the view, B pets the bunny, Tab reaches both exits, Escape puts the letter away | [ ] | |
| 15 | iPhone Safari: the music box and the swell sound right after a first tap; the silent switch behaves | [ ] | |

## 4. Problems
| Item # | What is wrong | Screenshot? |
|---|---|---|
| | | |

## 5. Decisions for the owner
- Must all five names be finished before the cake? (now: yes) Or should the finale be reachable without finishing them?
- Do you want footsteps anywhere in stay a while? (now: none)
- Any words for "look up", or for the B key? (now: none; they are yours)
- The crown on a phone is small (two rows, about 60 px a shape at 390) [A]: keep, or make the message smaller to give the shapes room?
- Acts 1 and 2 still need chaining in front of the sky, and the lock in front of that (Phase 29).
