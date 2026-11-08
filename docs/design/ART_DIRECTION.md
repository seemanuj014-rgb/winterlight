# ART_DIRECTION (AD)

One sentence: **a hand-drawn winter night you can step into: soft, sleepy, ethereal, with her drawing's black ink line holding it all together.**

## Look
- **Toon, not plastic.** 3 to 4 step shading ramp, soft rim light, no glossy speculars, no PBR shine. Everything reads as drawn, then lit.
- **Her ink line everywhere.** Black `#010102` outline on characters and key props: variable weight (heavier underneath, lighter on top), slight wobble, rounded corners, tapered ends. Background (mountains, far pines) drops the outline and uses colour and haze instead, so the characters pop.
- **Few hues, lots of value.** The scene is cool and quiet; warmth is rare and therefore precious.
- **Flat is allowed.** Large calm fills are the style. Do not fill space with noise.

## Palette (starting values, tune by eye)
| role | hex |
|---|---|
| deep sky | `#0d1b2e` |
| mid sky | `#1c3556` |
| horizon glow | `#6f86b8` |
| far mountains | `#3b5278` to `#5a7196` (hazier with distance) |
| snow lit | `#e8f1f8` |
| snow shadow | `#a9bdd6` |
| pine | `#1f3a3a` with snow tiers `#dfeaf2` |
| warm window and lantern | `#ffb86b` / `#ffd9a0` |
| aurora | teal `#58e0c0`, violet `#9a86ff`, rare pink `#f0a0d0` |
| Chamgadad | from `character/palette.json`, never re-picked |
| cat | warm grey-cream, readable against snow |
| snow bunny | white-blue `#eaf2f8`, lavender inner ears echoing hers |

## Light
Cool moonlight as the key. Warm light only from the cabin windows, the lamp, the candles and the lanterns, so warm always means "someone is here". Bloom only on warm and aurora highlights.

## Motion
- Slow ease in and out, long holds. Chamgadad is a sleepy character: nothing snaps, nothing bounces like a toy.
- Idle motion is always present but tiny (breath, ear drift, snow, flicker).
- Camera moves are calm splines; a gentle drift, never a shake.
- `prefers-reduced-motion`: no camera drift, no parallax, fewer particles, same story.

## Type
Self-hosted fonts only (no calls to Google at runtime: privacy and offline). Candidates: a soft serif for her words and the letter, a rounded sans for UI hints. If the letter has Hindi, add a Devanagari font with matching weight (decided in Phase 24 from the owner's answer). Large, short lines, generous spacing, dark text on a pale frosted card or pale text on a deep night card, always checked for contrast.

## Tone and wording
- Warm, funny, kind, a bit lazy. Short sentences. Never gushing, never romantic.
- UI hints are tiny and gentle ("hold to wake Chamgadad"), not instructions shouting.
- Anything with her name or the owner's voice comes from `content/`.

## Never
Hearts as romance, couple imagery, bouquets, neon, lens flares, glossy plastic, uniform vector outlines, stock-looking particles everywhere, text over busy areas without a calm backing, loud sounds, anything that auto-plays sound before a tap.
