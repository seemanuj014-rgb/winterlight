# Milestone 4 — Owner's checklist (The interactions)

Handed over UNFILLED by Phase 24 (2026-11-06), version 0.4.0. Nothing below was run on a real phone by Claude: the sandbox runs typecheck, named tests, builds and headless screenshots (software WebGL) only. Tick each line on **her kind of phone** and write what you see next to anything that fails. Items marked [A] are unconfirmed assumptions. Report problems by item number with a screenshot or short screen recording.

Date checked: ____________  Phone model and OS: ____________  Browser: ____________  Network: ____________

How to look: open the Vercel preview URL (branch `dev`) and add the view to the end. Waking and the door: `?acts` (hold a thumb anywhere, or tap six times, or wait 20 s for your line). Petting: `?pet`, `?pet=bunny`. The five names: `?sky&sound` (drag from star to star, or tap one then the next). The letter reader: `?letter` (shows `content/letter.md` as it is now: a placeholder). Sound only: `?audio` (tap anywhere first). Add `&reduced` for reduced motion, `&debug&tier=low|mid|high` for the numbers. Screenshots of every UI state from the sandbox: `docs/phase24/states_*.jpg`; the sound, as files to listen to first: `docs/phase23/*.wav`.

## 1. State after this milestone (from the code, not from a screen)
- The default page is still the flat Phase 0 silhouette with its text line (plus the loading screen). The acts, the five names, the sound and the letter reader run only in the test views above; Phase 28 joins them into the card.
- Built: the input layer (18), waking Chamgadad and the walk to the door (19), petting the cat and the bunny (20), the constellation engine (21), the five names in the sky with their wish cards (22), the whole audio engine, synthesized, quiet by default (23), the UI layer (24): theme, wish card, letter reader, sound button, two replay buttons, hint and your line on a soft backing, safe areas, reduced-motion variants, focus order and ARIA names.
- Fonts: the letter is English, so the text uses the phone's own serif and rounded fonts. No font file is shipped (nothing to download, nothing to license). The look of the letter therefore depends on her phone's font [A].
- Replay controls: two small round buttons under the sound button: the music-box tune (it turns the sound on if it was off) and the wishes (shows every finished constellation's wish card again, in order; it only appears once one is finished). Both are named only by plain functional words (see Decisions).
- Everything numeric is mine [A]: sizes (letter 18 to 20 px, line height 1.7, 44 px controls), colours from the art direction, 90 % card and 94 % letter panels, the 62 % backing behind the hint.
- All five wishes and the letter are still `TODO_OWNER` / a placeholder. The card shows them exactly as they are. A production build refuses to ship them (by design).
- Chamgadad's look, `content/letter.md` and `content/wishes.json` were not touched in this milestone.
- Contrast ratios are computed, not looked at: `docs/phase24/contrast.json`.

## 2. Checks: waking and the walk (`?acts`, phone, portrait)
| # | Check | OK | What I saw |
|---|---|---|---|
| 1 | Holding a thumb anywhere wakes Chamgadad (about 3 s); six taps also wake her; one tap does not | [ ] | |
| 2 | The "hold to wake Chamgadad" hint appears after a few seconds of nothing, is small and calm, and is easy to read over the room | [ ] | |
| 3 | Waiting about 20 s without touching shows your line, readable, with the crying emoji drawn properly on her phone | [ ] | |
| 4 | After waking she waves, hops to the door, the door opens, and she is pushed out into the snow; nothing looks wrong | [ ] | |
| 5 | The cat purrs when petted (drag over her or hold); the bunny hops to a held finger and hides when tapped | [ ] | |

## 3. Checks: the five names in the sky (`?sky&sound`)
| # | Check | OK | What I saw |
|---|---|---|---|
| 6 | All five shapes can be finished with a thumb (the stars are not too close together; the snap feels kind) | [ ] | |
| 7 | When a shape is finished its name fades in under it and its wish card opens; a tap on the card puts it away | [ ] | |
| 8 | The wish card is easy to read, sits inside the screen on her phone (also with the notch and the home bar) and a long wish scrolls inside the card | [ ] | |
| 9 | After a reload the finished shapes are still finished, with their names, and no card pops up by itself | [ ] | |
| 10 | The star button (under the music button) shows every finished wish again, one after another; before any shape is finished it is not there | [ ] | |

## 4. Checks: sound (`?audio`, `?sky&sound`; turn the volume up a little first)
| # | Check | OK | What I saw |
|---|---|---|---|
| 11 | Nothing makes a sound until the first tap; after it the sound starts quietly | [ ] | |
| 12 | Each line you draw gives a soft chime, a finished shape gives a short phrase; the wish card softly lowers the rest | [ ] | |
| 13 | The music-box tune is the right song and sounds like a music box on her phone speaker | [ ] | |
| 14 | The sound button mutes everything at once and remembers it after a reload; the music replay turns it on again | [ ] | |
| 15 | Locking the phone, a call or switching tabs, then coming back: the sound recovers (iPhone: also the silent switch) | [ ] | |

## 5. Checks: the letter reader (`?letter`) and every control
| # | Check | OK | What I saw |
|---|---|---|---|
| 16 | The letter fills the screen, scrolls smoothly, and is comfortable to read: not too big, not too small, line length and spacing good (type your own letter in `content/letter.md` to judge it) | [ ] | |
| 17 | The close button is easy to hit with a thumb, and nothing hides under the notch or the home bar | [ ] | |
| 18 | The three round buttons (sound, music, wishes) are easy to see and hit, and do not cover anything important | [ ] | |
| 19 | `&reduced` (or the phone's reduce-motion setting): nothing fades or moves in the UI; everything simply appears | [ ] | |
| 20 | With text size turned up in the phone's settings, the wish card and the letter still fit and scroll | [ ] | |
| 21 | With a screen reader (VoiceOver or TalkBack): the buttons say their names, the wish card says the constellation's name and then the wish once (not twice) | [ ] | |
| 22 | With a keyboard (a PC is enough): Tab goes sound, music, wishes, then the sky; Enter or Space presses; Escape puts the card or the letter away | [ ] | |

## 6. Problems
| Item # | What is wrong | Screenshot? |
|---|---|---|
| | | |

## 7. Decisions for the owner
- **The words on the buttons** are plain functional sentences, not yours: "Sound on. Tap to turn it off." / "Sound off. Tap to turn it on." (`src/audio/muteButton.ts`), "Play the music box tune again" and "Show the wishes again" (`src/ui/replayControls.ts`), "Close the letter" and "Letter" (`src/acts/letterView.ts`). Screen readers say them; nobody else sees them. Are they right for her?
- The **soft dark backing** behind the hint and your line (62 %) is new in this phase: without it the hint cannot be read over the pale pillow and blanket (computed contrast 1.1 to 2.8 against 4.5 needed). It makes them look like small dark pills. Keep it, make it fainter, or remove it? [A]
- The music replay **turns the sound on** if she had muted it (a silent replay would look broken). Fine?
- Footsteps are built but not used anywhere (Act 2's hops are indoors). Wire them to the outdoor walk in Phase 28, or add a soft indoor step?
- "Chamgadad smiles" when petted is NOT built (no mouth; Q1 open). Her reaction is a lean, a slow blink and an ear flick. Change it?
- The music-box volume and the pad and wind beds are my guess (master 0.2 of full scale) [A]: too quiet, too loud, too much?
- The five wishes and the letter are yours to write. Production will not build until they are filled.
- Still open from earlier: the mouth line (Q1), the optional door plaque and sign, the Chamgadad `[A]` lists in `CHARACTER_BIBLE.md`, and the owner's yes on the earlier checklists (G0, G1).
