# Milestone 3 — Owner's checklist (The world)

Handed over UNFILLED by Phase 17 (2026-11-06), version 0.3.0 (gate G1). Nothing below was run on a real phone by Claude: the sandbox runs typecheck, named tests, builds and headless screenshots (software WebGL) only. Tick each line on **her kind of phone** and write what you see next to anything that fails. Items marked [A] are unconfirmed assumptions. Report problems by item number with a screenshot or short screen recording.

Date checked: ____________  Phone model and OS: ____________  Browser: ____________  Network: ____________

How to look: open the Vercel preview URL (branch `dev`) and add the view to the end. The whole run: `?tour`. One shot: `?tour&shot=nookWide|nookBed|nookDoor|doorOut|snowWalk|stage|skyLook|finale`. Start the run at a shot: `?tour&from=<shot>`. Add `&reduced` for reduced motion, `&nopost` to compare without the glow, `&debug&tier=low|mid|high` for the numbers. The world on its own: `?world&cabin`, `?nook`, `?cat`, `?bunny`. Screenshots from the sandbox are in `docs/phase12/` to `docs/phase17/`.

## 1. State after this milestone (from the code, not from a screen)
- The default page is still the flat Phase 0 silhouette with its text line (plus the new loading screen while it loads). The world, the cast and the camera run only in the test views above.
- Built: night sky, stars, moon, aurora, four mountain layers (Phase 12); snow ground, snowfall, pines (13); the cabin with smoke and warm windows, the sleepy nook, optional door props that are OFF and have no words (14); moon key light, warm cabin lights, mist, bloom and a grade on mid and high, nothing extra on low (15); the cat and the snow bunny (16); the camera director, the door push-out and the loading screen (17).
- Draw calls in the sandbox at the low tier (limit 60): nook 54 to 57, door push-out 57 to 58, snow walk 54, stage 50, sky 42, finale 58. Outdoors the triangle count is about 90k against the 80k low-tier budget (Chamgadad about 60k plus the world); that is a Phase 21 (performance) item, not fixed yet.
- Every shot position, length, speed and field of view is a first guess [A].
- The loading words are plain functional sentences in `src/ui/bootText.ts` (copied in `index.html`); they are not part of your letter. Please read them (item 14).
- Chamgadad's look, `content/letter.md` and `content/wishes.json` were not touched in this milestone.

## 2. Checks: the tour (`?tour`, a phone, portrait)
| # | Check | OK | What I saw |
|---|---|---|---|
| 1 | A soft falling-snow loading screen shows at once, with a bar that keeps creeping and never looks stuck, then fades into the scene | [ ] | |
| 2 | The first shot is the cosy room from its open side: bed with a blanket, lamp, cocoa, window onto the snow, Chamgadad curled asleep on the pillow, the cat on the blanket | [ ] | |
| 3 | The camera moves slowly and smoothly toward the bed; Chamgadad wakes and sits up as it arrives; nothing whips or jumps | [ ] | |
| 4 | The camera turns toward the door and the cat wakes | [ ] | |
| 5 | The push-out: the camera is just inside, looking at the dark back of the door; the door swings open; the camera goes out through it into the snow | [ ] | |
| 6 | The walk through the snow is calm (the small handheld wobble is gentle, not seasick) and ends with Chamgadad in front of you, the cabin glowing behind | [ ] | |
| 7 | Chamgadad stands whole on the snow (feet on the snow, not sunk) and waves; the bunny peeks and hops | [ ] | |
| 8 | The sky shot: the moon, the aurora and the stars, nothing cut off or blocky at the edges | [ ] | |
| 9 | The finale pull-back ends with the cabin small and glowing in the valley | [ ] | |
| 10 | `&reduced`: the same run, but slower, with no wobble and no zoom drift | [ ] | |
| 11 | The tour feels smooth on your phone (not stuttering); battery and heat after a minute are fine | [ ] | |
| 12 | Colours: the moonlit blues and the warm window and lamp light look nice on her kind of screen, no banding in the dark blue | [ ] | |
| 13 | Rotating the phone or the address bar showing and hiding does not break the picture | [ ] | |

## 3. Checks: loading and failure (these were tested in the sandbox on a throttled network and with failures forced; check the feel on a real phone)
| # | Check | OK | What I saw |
|---|---|---|---|
| 14 | The words on the loading and failure screens are right for her ("Getting things ready", the slow-connection line, "This needs WebGL", "It did not load") | [ ] | |
| 15 | On a slow connection (phone on bad mobile data) the loading screen appears before anything else and says the connection is slow after a while | [ ] | |
| 16 | In airplane mode after the page has loaded, or with the page's script blocked, you see "It did not load" with a Reload button | [ ] | |

## 4. Problems
| Item # | What is wrong | Screenshot? |
|---|---|---|
| | | |

## 5. Decisions for the owner
- Is the nook too dark, too brown, or just right? (It sits in a plain dark void; the night sky is not drawn while the camera is in the room.) [A]
- The camera's speeds, holds and the handheld wobble are my numbers [A]: too slow, too fast, too much?
- Chamgadad's size on the stage (about 1.4 m, scale 0.2) and the animals' sizes are test placements [A]; Phase 19 sets the real ones.
- Chamgadad looks small in the far shots; do you want the camera closer to her in the walk?
- The five names go in the sky from Phase 22; the sky shot is where they will appear. Anything you want in that frame?
- Still open from earlier: the mouth line (Q1), the optional door plaque and sign, the Chamgadad `[A]` lists in `CHARACTER_BIBLE.md`, and the owner's yes on `OWNER_CHECKLIST_M2.md` (G0).
