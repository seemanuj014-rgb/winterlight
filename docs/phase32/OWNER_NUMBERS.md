# Phase 32: numbers I need from her kind of phone

The performance pass tunes the tier table and watchdog from REAL numbers. The sandbox cannot give them (software WebGL only), so this phase is PARTIAL until these come back.

How: open the live link on the phone with `?card&debug` (or `?stay&debug`), play for a minute, screenshot the overlay at each stage below. Send the screenshots; I read tier, fps, draw calls, triangles and texture MB off them.

| Stage | Tier shown | fps | Draw calls | Triangles | Texture MB | Felt smooth? |
|---|---|---|---|---|---|---|
| Nook (start) | | | | | | |
| Walking out / door | | | | | | |
| Sky and constellations | | | | | | |
| Cake and candles | | | | | | |
| Lanterns and glitter | | | | | | |
| Finale | | | | | | |
| Stay a while (1 min) | | | | | | |

Also: phone model and OS, browser, and whether the tier dropped by itself (the overlay shows start tier and current tier).

What I will do with them: move the watchdog thresholds (`src/core/quality.ts` slowMs), the pixel-ratio caps and particle counts, and fix any stage over the draw-call budget in `docs/PERF_BUDGET.md`.
