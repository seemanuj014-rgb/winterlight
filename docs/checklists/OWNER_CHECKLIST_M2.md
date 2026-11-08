# Milestone 2 — Owner's checklist (Chamgadad)

Handed over UNFILLED by Phase 11 (2026-11-05), version 0.2.0 (gate G0). Nothing below was run on a real phone by Claude: the sandbox runs typecheck, named tests, builds and headless screenshots (software WebGL) only. Tick each line on **her kind of phone** and write what you see next to anything that fails. Items marked [A] are unconfirmed assumptions. Report problems by item number with a screenshot or short screen recording.

Date checked: ____________  Phone model and OS: ____________  Browser: ____________  Network: ____________

How to look: open the Vercel preview URL (branch `dev`) and add the view to the end. Her drawing is `character/reference/chamgadad_ref_01_head_front.png`. Side-by-side, 50 percent overlay and the red/blue deviation map are in `docs/phase11/`.

## 1. State after this milestone (from the code, not from a screen)
- The default page is still the flat Phase 0 silhouette. Chamgadad is only in the test views: `?behave&view=ref&bg=white&still` (her framing), `?behave`, `?body=3q|side|back|top`, `?head`, `?face`, `?ears`.
- At her framing, in the sandbox: head and ears IoU 0.9791 (target 0.97), neck and chest 0.9922 (target 0.95 [A]), eye centres within 0.0004 (target 0.01 [A]). Numbers in `docs/phase11/fidelity.json`.
- Not in her drawing, so not scored: the mouth (Q1, skipped), everything below her crop, the back and sides, every movement.

## 2. Checks: does it look like her drawing? (`?behave&view=ref&bg=white&still`, compare with the drawing)
| # | Check | OK | What I saw |
|---|---|---|---|
| 1 | The head is her one big soft bean shape, tilted the same way, no separate muzzle | [ ] | |
| 2 | The upright ear (viewer-left) stands up with its fold curling over, inside pale blue | [ ] | |
| 3 | The lavender-grey patch near the base of each ear is where she put it | [ ] | |
| 4 | The other ear angles out sideways, its back darker teal-grey | [ ] | |
| 5 | The ears' pale blue is the right shade (the render is a little darker than her flat ear: say if it looks too grey) | [ ] | |
| 6 | Both eyes: very large, glossy, near-black, low and far apart | [ ] | |
| 7 | Each eye has the white rounded triangle, the thin white arc on top and the small pale-blue tab at the bottom | [ ] | |
| 8 | The two brow strokes curve over the eyes and are not symmetrical, like hers | [ ] | |
| 9 | The eyes look up and left, as in her drawing | [ ] | |
| 10 | The neck and chest run on smoothly from her crop, no seam, no step | [ ] | |
| 11 | The two short chest strokes are where she drew them | [ ] | |
| 12 | The ink line looks like her ink: heavier under the jaw and ears, thinner on top, rounded corners | [ ] | |
| 13 | The pale warm rim light on the viewer-left edge is there and soft | [ ] | |
| 14 | Nothing was added that she did not draw: no nose, no whiskers, no blush, no tufts | [ ] | |
| 15 | Overall: if you put it next to her drawing, it is the same character | [ ] | |

## 3. Checks: the parts she did not draw (`?body=3q`, `?body=side`, `?body=back`) [A]
| # | Check | OK | What I saw |
|---|---|---|---|
| 16 | Body: smooth tapering torso, round seated bottom; the length next to the head is right | [ ] | |
| 17 | Arms: two short wedges on the chest, paws meeting where her lines meet; no fingers, no pads | [ ] | |
| 18 | Legs: two round thighs and two soft oval feet; no toes | [ ] | |
| 19 | Tail: a soft curved teardrop at the back, no tuft | [ ] | |
| 20 | Back of the head and body: body colour `#a7b9c3`; ear backs teal-grey `#6f8188` | [ ] | |
| 21 | Stethoscope and party hat are OFF by default (`&steth`, `&hat` turn them on; decide if you want either in the card) | [ ] | |

## 4. Checks: how it moves (`?behave&state=<name>`, `?behave&seq=sleep@0,wake@6`) [A]
| # | Check | OK | What I saw |
|---|---|---|---|
| 22 | Rest: the slow breath is visible but not distracting (about 4.5 s a breath) | [ ] | |
| 23 | Sleep: curled, eyes shut as her closed-eye curve, three soft Zs rise | [ ] | |
| 24 | Wake: eyes open slowly, unroll, a long stretch, settle (4.4 s) | [ ] | |
| 25 | Look up and find-the-finger: the eyes lead, the head follows a moment later | [ ] | |
| 26 | Curious lean with a head tilt | [ ] | |
| 27 | Happy hop: crouch, slow floating arc, soft landing, ears flick (2.6 s) | [ ] | |
| 28 | Wave: one arm, about three slow swings (3.7 s); the arm is held out to the side | [ ] | |
| 29 | Slow blink and ear flick feel gentle, not twitchy | [ ] | |
| 30 | Nothing is too fast, too slow or too much. Which one: ____________ | [ ] | |
| 31 | `&reduced` (reduced motion): movements are small, no hop, nothing on its own | [ ] | |
| 32 | It runs smoothly on my phone (no stutter in `?behave&debug`; write the fps you see) | [ ] | |

## 5. Problems
| Item # | What is wrong | Screenshot? |
|---|---|---|
| | | |

## 6. Decisions for the owner
- **Sign off the `[A]` lists** in `CHARACTER_BIBLE.md` (Phase 9 and Phase 10): tick each box there, or write what to change.
- **Q1:** the long curve under her face: a smile or the chin edge? Until you answer, no mouth is drawn.
- **Q3 and Q5:** do you have drawings of other expressions or poses (sleeping, happy, waving)? Is the upward gaze her normal gaze? Without answers, they stay `[A]`.
- Do you want the stethoscope and/or the party hat in the card at all?
- Gate G0 is passed only when you say "it looks like her drawing" (items 1 to 15). Phase 12 can start in parallel; any change you ask for here comes back as a fix before G1.
