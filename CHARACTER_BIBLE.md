# CHARACTER_BIBLE — Chamgadad (a character drawn by Dhana)

**Chamgadad** is a character Dhana created and drew herself. Dhana is a real person and never appears in the card; the viewer *is* Dhana. The owner named the character Chamgadad; the name has no meaning, so infer nothing from it. The job is to make Chamgadad exist in 3D exactly as drawn, without changing it. Where this file says **measured**, a number came from the pixels (`tools/trace_silhouette.py`, `character/palette.json`). Where it says `[A]`, it is an unconfirmed assumption.

## Accuracy rules
1. **Measure, don't guess.** Silhouette, eye positions and colours come from `character/traced/` and `character/palette.json`.
2. **Add nothing that is not drawn.** No nose, whiskers, teeth, blush, fur tufts, eyelashes, or outfit unless a reference shows it.
3. **Keep the drawn line.** The black ink outline has variable weight, slightly wobbly, tapered ends. The 3D outline must keep that character (see Phase 3, 6, 11). A clean uniform outline is a fidelity failure.
4. **Extrapolation is flagged.** Anything below the drawn area (body, limbs, tail, back, side) is `[A]` until the owner approves it in Phase 9 and signs it off in Phase 11.
5. **Accessories are separate layers** (party hat, stethoscope). The base character must look right with all of them off.
6. **The fidelity gate is numeric and visual** (Phase 11): silhouette overlap and a side-by-side, at the reference's own framing.

## References on file
| id | file | shows | cropped? |
|---|---|---|---|
| ref_01 | `character/reference/chamgadad_ref_01_head_front.png` (1080x1080) | head and upper chest, head tilted, eyes looking up and out | yes, cut at the bottom edge: the body is NOT measured |

Traced from ref_01 (`character/traced/`): outer contour 147 points; eye blobs (dark-pixel centroids, highlights excluded): left eye centre (0.463, 0.511), right eye centre (0.620, 0.548), each about 0.052 wide and 0.058 tall in image-fraction units. `overlay.png` there lets a human check the trace. A stray grey speck at the bottom-left of the image is ignored on purpose. Phase 5 re-ran the trace (the contour is byte-identical to Phase 0's) and added the **full eye** (dark blob plus the white highlight and pale tab that sit in it): left eye centre (0.451, 0.506), right eye centre (0.607, 0.543), about 0.053 x 0.059 each (viewed on `overlay.png`: green boxes = full eyes, blue ellipses = dark pixels only). Use the full-eye numbers to place the 3D eyes; the dark-blob numbers sit up to 0.013 right of and 0.005 below the visible eye. The contour follows the outer edge of the ink (and of its faint halo), so it is a hair larger than the ink line itself; the fidelity gate compares against this same contour, so that is consistent.

## What the drawing shows (observed)
- **Head:** one large soft bean shape, wider at the cheeks, tilted. Smooth, no separate muzzle. It reads as a baby-proportioned head: the head is nearly as wide as the torso.
- **Eyes:** very large, glossy, near-black ovals set low on the face and far apart. Each has: a **white rounded-triangle highlight** on the viewer-left side of the pupil area, a **small thin white arc** at the top, and a **small pale-blue rectangular tab** at the bottom edge. A thin dark **brow stroke** curves over each eye; the two are not symmetrical (the head tilt).
- **Mouth, or chin line? (unconfirmed, Q1):** one long gentle curve across the lower face. Its left end runs straight on from the left head outline, and its right end is a free, slightly upturned flick inside the neck, shaded just under it. It can be read as a quiet smile or as the chin/jaw edge of the head overlapping the neck. It is drawn once, no second line, no lips, no teeth. No nose is drawn. Phase 7 must not decide this alone. (Phase 7 status: the owner chose to skip the curve for now, so no mouth line is drawn yet.)
- **Ears:** two long, rounded, leaf-like ears. The viewer-left ear stands upright with a visible inner fold that curls over. The viewer-right ear angles out sideways. Inner surface pale blue, with a **lavender-grey patch** near the base. The back of the angled ear is a darker teal-grey.
- **Body:** smooth tapering neck-and-chest that widens downward. No visible neck seam. Two short ink strokes on the chest form a loose V (shoulder, arm or fur parting: unknown `[A]`).
- **Light:** a soft pale warm rim along the viewer-left edge (looks like gentle back light). A soft darker band sits just under the chin line and at the ear bases. Everything else is a flat, calm fill.
- **Line:** black ink, hand-drawn, heavier on the underside of the jaw and ears, thinner on top of the head. Corners are rounded, never sharp.

## Palette (measured; base colours for a toon ramp)
| role | hex |
|---|---|
| body base | `#a7b9c3` |
| chest | `#a8bac2` |
| pale warm rim | `#d7d9d5` |
| ear inner, pale blue | `#c4d6e1` (other ear `#c1d1dc`) |
| ear inner, lavender patch | `#87889c` |
| ear back shadow (teal-grey) | `#6f8188` |
| eye black | `#09080a` |
| eye highlight white | `#f7f8fa` |
| eye lower tab, pale blue | `#c0d2dc` |
| outline ink | `#010102` |

Lit and shadow tones come from the toon ramp, not from extra hues.

**Phase 5 palette re-check** (`tools/sample_palette.py`, 5x5 patches, written to `character/traced/*.palette_check.json`): body, chest, lavender patch, ear teal, eye black, highlight and tab all reproduce within 6 per channel. Findings, none acted on because changing a colour would change how Chamgadad looks (that is a Phase 11 decision with the owner): (a) the flat pale-blue inside of **both** ears measures `#cddfe9`, about 9 to 14 per channel lighter than the stored `#c4d6e1` / `#c1d1dc`, which were taken where the ear is slightly shaded (the sampler reports the right ear as outside tolerance for this reason); (b) the warm rim is lighter at its peak than the stored `#d7d9d5`: along the left edge the pale band's median is `#d9ded5` to `#e6e6dd` and its lightest pixels `#dddfda` to `#eeeee2`, which matches the Phase 3 note that the 3D rim is subtler than the drawn one.

## Unknown (do not invent silently)
Full body shape, arms and hands, legs and feet, tail, back of the head, side profile, how the mouth moves, what happy, sleepy or surprised look like in the drawn style, any markings below the chest. **Species is not stated and must never be inferred** from the ears, the name or anything else: Chamgadad is just Chamgadad. These are Phase 5 questions (see "Questions for the owner" below) and Phase 9 `[A]` items. Also unknown: what the strokes on the chest are, what the long lower-face curve is (Q1), whether the upward gaze is the neutral gaze (Q5), and the colour of the back of both ears (Q6).

## Behaviours to design (Phase 10), always in-character
Idle breathing; the **head tilt from ref_01 as the resting pose**; slow blink; eyes that find your finger; ear flick; sleep loop (eyes closed as a soft curve in the drawn line style, small Zs); wake and stretch; sit and look up; happy hop; curious lean; a small wave. No frantic motion: Chamgadad is a sleepy character `[A]` (a design choice for the card, not from the drawing).

## Companion animals (cat, snow bunny)
Not part of Chamgadad's drawing, so these are ours to design, but they must live in the same world: same toon ramp, same ink-line wobble, same eye language (big glossy dark eyes with the angular highlight), so they look like they were drawn by the same hand. They must look clearly different from Chamgadad (own silhouette, no copied ears). Cat: sleeping curl, tail, ear flick. Snow bunny: white-blue, own proportions.

## Fidelity spec (Phase 5; machine-readable copy in `character/fidelity.json`, maths in `src/character/chamgadad/fidelity.ts`)
- **Framing:** an orthographic "reference camera" whose image plane is the drawing (1080 x 1080, normalised 0..1, y down). Phase 6 builds it; the render must put the traced contour on the same coordinates.
- **Compare against** the filled polygon of `character/traced/chamgadad_ref_01_head_front.silhouette.json`.
- **Head and ears** (rows y from 0 to 0.72): silhouette IoU **at least 0.97** (the phase default).
- **Neck and chest** (rows y from 0.72 to 0.995, the bottom edge is the crop and is excluded): IoU at least 0.95 `[A]`, my proposal, looser because the drawing is cut off there.
- **Eyes:** full-eye centres within 0.01 of the image (about 11 px) of the numbers above `[A]`.
- **Line:** judged by eye in Phase 11 (weight varies, heavier underneath, tapered), not by IoU.
- Anything below the crop, behind or beside the head is `[A]` and is not scored.

## Head-volume method (decision for Phase 6)
**Inflation.** Build the head from the traced contour as a distance-to-edge height field, smoothed, with a fitted back so side and three-quarter views stay plush and plausible; no sculpting from guesses. Because the traced contour is the union of head, both ears and neck, and the ear bases are hidden behind the head, Phase 6 first splits it into four outlines (head, upright ear, angled ear, neck) from the ink strokes, measured the same way, and views each overlay before extruding. Ears are separate meshes attached at those bases. The back and sides are inferred `[A]`. Why not a lathe or a sphere-plus-deform: both would change the drawn outline, which the fidelity gate forbids.

## Questions for the owner (one short list; each answer unblocks a phase)
**Q1.** The long curve under her face: is it a smile (mouth) or the edge of the chin and jaw? If you have any drawing where she smiles, or any other expression, that settles it. (Phase 7)
**Q2.** Do you have more views of Chamgadad: full body, side, back, hands and feet, tail? If not, I will extrapolate in Phase 9 and you approve every `[A]`.
**Q3.** Any drawings of other expressions or poses in her style (sleeping eyes, happy, surprised, waving)? If not, I will design them in the drawn style and flag them `[A]`. (Phase 7, 10)
**Q4.** The two short strokes on the chest, forming a loose V: arms or shoulders, a fur parting, or something else? (Phase 9)
**Q5.** The eyes look up and out in this drawing. Is that Chamgadad's normal gaze, or just this moment? (Phase 7, 10)
**Q6.** What colour is the back of each ear, and the back of the head? The drawing shows only the teal-grey back of the angled ear. (Phase 6, 9)

## Phase 6 notes (partial; geometry built in Node, WebGL side never run)
- **Parts:** `character/traced/*.parts.json` (made by `tools/split_parts.py`; overlay next to it): head, neck, and for each ear a back **flap** (the whole ear, teal-grey) plus an inner **bowl** (pale blue, lavender patch) whose rim is the fold stroke. Both ears fold; the drawing shows it on both.
- **Method as built:** inflation with depth from the per-ray inscribed radius (not the exact distance at each vertex: that made spikes at the chin notch), quarter-circle edge, back mirrored. Every rim is inset by her ink width (10.8 px) because the hull draws outward.
- **`[A]` (inferred, owner to approve):** all depths; the back of the head; back and sides of both ears; the neck's depth and its hidden top; layering (head in front of neck and ears); ear backs use the measured teal-grey `#6f8188` on both ears until Q6 is answered. The chin curve is used only as the head/neck boundary; Q1 (smile or chin) is still open.
- **Depth choices after the second pass `[A]`:** neck depth 0.75 of its inscribed radius with back 0.45, its hidden top narrower than the head; ear flaps 0.45 and bowls 0.22 (bowl back 0.4); head 0.9 with back 0.85. Seen from the back the neck tucks into the head; from the side the ears are solid, with the bowl a thin pale sheet beside the flap (cosmetic, known).

## Owner confirmations for Phase 5 (UNFILLED; tick on the overlay and the drawing)
- [ ] `character/traced/chamgadad_ref_01_head_front.overlay.png`: the red line follows the outside of her ink line, with the whole head, both ears and the neck inside it.
- [ ] The green boxes sit on the two whole eyes (highlight and tab included).
- [ ] The "What the drawing shows" list above matches her drawing; anything wrong: ______
- [ ] The fidelity numbers (0.97 head and ears; 0.95 neck and chest `[A]`; eyes 0.01 `[A]`) are acceptable.

## Phase 9 `[A]` list (UNFILLED approval: tick each, or write what to change; Phase 11 signs it off)
Owner answers used: **Q2** no more drawings, extrapolate · **Q4** the two chest strokes are arms / shoulders · **Q6** my call. Pictures: `docs/phase9/`.
**Measured from her drawing (not `[A]`):** the neck and chest silhouette continued below her crop with the same slope; the two chest strokes (rows in the Phase 9 log), which are now the arms' inner edges.
- [ ] Body: a smooth tapering torso that keeps widening below the chest, then a round seated bottom; about 2.4 head-heights of body below the crop `[A]`. Depth 0.62 of its inscribed radius, back 0.9 `[A]`.
- [ ] Arms: two short wedges lying on the chest, inner edges on her strokes, paws meeting where her lines meet (a little below her crop); no fingers, no pads `[A]`.
- [ ] Legs: two round thighs at the lower sides, in front of the body; two soft oval feet lying forward; no toes `[A]`.
- [ ] Tail: a soft curved teardrop at the back, curling up, seen from the side and the back; no tuft `[A]`.
- [ ] Back of the body and back of the head: body base `#a7b9c3`; ear backs stay teal-grey `#6f8188` (Q6 "my call") `[A]`.
- [ ] Sitting-up pose and curled sleeping pose (rigid parts; the curl is a first pass until Phase 10's rig) `[A]`.
- [ ] Stethoscope (slate tube, silver chest piece) and party hat (her ear lavender with a white band and tuft): ours, not hers, **off by default** `[A]`.

## Phase 10 `[A]` list (UNFILLED approval: tick each, or write what to change; Phase 11 signs it off)
Pictures: `docs/phase10/`. Nothing here is from her drawing except the rest pose; Chamgadad is sleepy on purpose.
- [ ] Rest pose = the drawing (head as she drew it, paws together), with a slow breath (about 4.5 s a breath, a 1.2 percent rise of the chest) `[A]`.
- [ ] Sleeping: curled on its side, eyes shut as the drawn closed-eye curve, three small soft Zs floating up (pale blue with her ink edge) `[A]`.
- [ ] Waking: eyes open slowly, unroll, a long stretch with both arms out and up, settle (4.4 s) `[A]`.
- [ ] Looking up, following a finger (eyes first, head a moment behind), a slow curious lean with a head tilt `[A]`.
- [ ] A small happy hop (crouch, slow floating arc, soft landing, ears flick at launch and landing; 2.6 s) `[A]`.
- [ ] A small wave with one arm (lift, about three slow swings, down; 3.7 s). The arm is held out to the side, no paw to wag `[A]`.
- [ ] Reduced motion: movements about a third of the size, no hop, no stretch, nothing on its own `[A]`.
- [ ] Anything too fast, too slow or too much: ______

## Phase 11 fidelity gate (G0), measured 2026-11-05 (sandbox, headless Chromium, software WebGL)
Command: `npm run build && python3 tools/fidelity.py --whole --out out/fidelity` (renders `?behave&view=ref&bg=white&still&at=0`: the WHOLE figure, rest pose, eyes on, through the reference camera). Pictures and numbers: `docs/phase11/`.
- **Head and ears (rows 0 to 0.72): IoU 0.9791, target 0.97, PASS.** **Neck and chest (0.72 to 0.995): IoU 0.9922, target 0.95 `[A]`, PASS.** The rest is 3,249 render-only and 3,450 drawing-only pixels out of about 376,000: thin slivers along the edge (`deviation.png`, red = only the render, blue = only her drawing), no mismatch is deeper than 8 px where the render is too big and 11 px where it is too small (99th percentile 7 and 9 px; measured as distance from her edge).
- **Eyes:** both disc centres within 0.0003 and 0.0004 of her drawing (target 0.01 `[A]`); disc size within 0.001; highlight, arc and tab centres within 0.0002.
- **The head did not change when the body was added:** above y 0.70 the whole-figure render and the Phase 7 `?face&still` render are pixel-identical (0 pixels differ). Only the chest and arms below differ, as they should.
- **Worst deviations, left as they are:** (1) the groove between the upright ear and the head at the top (x 0.63 to 0.70, y 0.33 to 0.38): her ink is a bit wider there than ours (blue, 834 px); (2) the underside of the angled ear (x 0.78 to 0.87, y 0.49 to 0.54): ours is a bit lower and thicker (red, 664 px); (3) the head's left edge at y 0.46 to 0.50: a short stretch of hers that we round off (211 px); (4) the right chest edge at the crop (red, 202 px). All are the hand-drawn wobble of her ink against our weighted ink hull. Closing them means reshaping the traced parts, which would change how Chamgadad looks, so nothing was changed. They are under the targets.
- **Colour, 9 patches (same patches as `tools/sample_palette.py`), `docs/phase11/colour_check.json`:** 6 of 9 within 6 per channel. The two ear pale blues render 9 to 14 per channel DARKER than her flat ear pixels (`#c4d6e1` and `#c1d1dc` against `#cddfe9`: the stored palette value is her shaded ear, the drawing's flat part is lighter; the Phase 5 finding), and the cheek patch is 10 darker in red because the ramp's shade step falls there. Palette and ramp were NOT changed. **Owner: if the ears look too grey next to her drawing, say so and Phase 11's follow-up lifts the ear base colour; otherwise it stays.**
- **Ink line weight** is judged by eye, not by IoU (spec): in `overlay50.png` the render's line sits on hers all round and is a little more even than her hand-drawn one.
- **Not in her drawing and therefore not scored:** the mouth (Q1, the owner skipped it), everything below her crop, the back and sides, every behaviour. Those are the `[A]` lists above; the owner checklist is `docs/checklists/OWNER_CHECKLIST_M2.md` and it is the real gate.

## Phase 16 companions: the cat and the snow bunny `[A]` list (UNFILLED approval: tick each, or write what to change)
Pictures: `docs/phase16/` (`cat_contact.png`, `bunny_contact.png`, `world_contact.png`, `phone/`). Neither animal comes from her drawing; they are ours to design, so every number is `[A]`. Rules kept: warm friendship (no hearts, nothing romantic), Chamgadad's look untouched, no word of text in any of it.
- [ ] **Own silhouettes, nothing copied from Chamgadad.** The cat: a lean round body, a round head, two POINTED triangle ears with a pink inside, a long tail with a dark tip, cream bib and paws. The bunny: a chubby egg, a round head, SHORT upright ears with a blunt rounded tip (about 0.9 of a head height) and lavender inside, a puff tail baked into the body. Chamgadad's ears are leaf shapes with no inside colour; neither animal has them.
- [ ] **Colours, all mine:** cat fur `#c8b8a0`, back `#b3a28c`, tail tip `#7f7266`, cream `#eee4d3`, inner ear `#d7b9b4`, nose `#c79a98`; bunny white-blue `#eaf2f8`, belly `#f6f9fc`, ear inside and nose lavender `#a79fc4`.
- [ ] **Eye language shared with Chamgadad:** the same near-black oval, white rounded-triangle highlight upper left, thin top arc, pale tab at the bottom, a grey shade that follows the gaze, and the blink to a curved ink line (one small procedural shader, no textures). The cat and the bunny may have a small nose (a rounded ink-edged triangle, which can twitch); only Chamgadad may not.
- [ ] **Same drawing style:** the toon ramp, the wobbling ink line (thicker on the small parts, thinner on the big ones), colour in the vertices.
- [ ] **Cat states:** sleeping curled on the blanket (a loaf, chin on her paws, ears laid back, tail along her side, eyes shut as the drawn curve), waking (4.6 s), sitting (tail laid along her side on the floor), stretching (6 s, front down, rump and tail up, a long hold), purr (a loaf with the head up, eyes half shut, a faint tremor), and the ear flicks, tail flick and a slow blink. Asking for anything while she sleeps wakes her first.
- [ ] **Bunny states:** sitting, hiding (sunk behind a snow bank, ears laid back), peeking (rise, look both ways, a nose twitch, sink back, 5.4 s), a small hop on the spot (2.4 s: crouch, slow floating arc, soft landing), ear flicks and a slow blink. Asking to peek from a seat makes her duck first.
- [ ] **Reduced motion:** movements about a third of the size, blends slower, no gestures on their own, no purr tremor.
- [ ] Anything too fast, too slow, too plain or too much: ______

