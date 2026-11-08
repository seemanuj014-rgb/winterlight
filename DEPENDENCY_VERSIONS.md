# DEPENDENCY_VERSIONS

Exact pins (`.npmrc` has `save-exact=true`). Install only what the phase needs. Adjust a pin in place if an install fails, and record what happened in the log below.

## Installed in Phase 0
| Package | Version | Why |
|---|---|---|
| three | 0.187.0 | 3D engine |
| @types/three | 0.187.0 | types, must match three |
| vite | 8.3.5 | dev server and build |
| typescript | 5.9.3 | chosen over registry latest (7.0.2 on 2026-11-04) to avoid a major jump mid-project |
| vitest | 5.1.0 | tests |
| @types/node | 22.19.1 | `node:fs` in tests |

## Planned (not installed; versions seen on the registry on 2026-11-04)
| Package | Version | Phase | Why |
|---|---|---|---|
| gsap | 3.15.0 | 17, 19 | camera and sequence timelines (only if hand-rolled tweens get unwieldy) |
| postprocessing | 6.39.6 | 15 | bloom and grade (only for mid and high tiers) |

Not planned, on purpose: React or any UI framework (a card does not need one), a physics engine, a state library, any audio library (Web Audio is enough), any image or model assets (everything is code).

## Python tools (sandbox only, not shipped)
`pillow`, `numpy`, `scipy`, `scikit-image` for `tools/trace_silhouette.py`; `playwright` (with Chromium) for `tools/shot.py`.

## Install-test log
| Date | Where | What ran | Result |
|---|---|---|---|
| 2026-11-04 | Claude sandbox, Node 22.22.2, npm 10.9.7 | `npm install` of the pins above, typecheck, test, build, `tools/shot.py` | All clean. First typecheck failed until `@types/node` was added and `vite.config.ts` imported `defineConfig` from `vitest/config`; both fixed. |
| 2026-11-04 | Claude sandbox (Phase 1), Node 22.23.4, npm 10.9.9 | `rm -rf node_modules`, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `python3 tools/shot.py` | All clean from scratch with the lockfile: 48 packages, 8 tests green, one 553.64 kB JS chunk (139.10 kB gzip), 3 screenshots with no console errors. No pin changed. |
| | Owner PC | `npm ci`, typecheck, test, build | (owner fills in: not run by Claude) |
| | Vercel | first deploy of `dev` preview | (owner fills in: not run by Claude) |
