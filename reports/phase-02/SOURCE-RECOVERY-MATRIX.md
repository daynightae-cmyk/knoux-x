# Source Recovery Matrix — Knoux X

Date: 2026-09-10. Rule: current main wins by default; history must prove
superiority (functional value + compatibility + tests + runtime viability).

## Diverged PR heads — disposition

| PR head | Subject | Verdict | Evidence |
|---|---|---|---|
| PR 1 | hashtable enumeration fix | OBSOLETE | 2-line bootstrap-doc tweak; current CI validates bootstrap differently |
| PR 2 | Phase-01 PS validation scripts | OBSOLETE | Closed-phase scaffolding (725 lines, superseded pipelines) |
| PR 3 | Phase-01 V1.1/V1.2 repair scripts | OBSOLETE | Closed-phase scaffolding (1193 lines) |
| PR 8 | capture/edit/recording foundations + task-board tool | ALREADY BETTER ON MAIN | `capture.ts`, `editProject.ts`, `recordingState.ts`, merge tool all live on main in evolved form |
| PR 10 | Vercel Web Analytics | DANGEROUS — REJECTED | Conflicts with product posture (`analyticsEnabled: false`); needs an explicit owner product decision, never a silent merge |
| PR 15 | settings-evidence + smoke tooling era | OBSOLETE | All named systems live on main (build-identity, capture/region/retained stores, ffmpeg-service); count assertion stale (195→256→303) |
| PR 17 | image-studio tests + AI provider verifier | OBSOLETE | Current image-studio suites green and broader; `verify-ai-providers.cjs` already on main; count assertion stale |
| PR 20 | .gitignore + phase-1 .cmd runners | OBSOLETE/DANGEROUS | Proposed .gitignore opens with a markdown fence (would corrupt ignores); .cmd runners exist on main for skipped legacy workflows |
| PR 25 | `tools/rebuild-native.cjs` | OBSOLETE | Unreferenced by every workflow/test; native rebuild covered by forge `afterPrune` + CI toolchain step |
| PR 27 | Forge splash + player rewrite (Aug 22) | OBSOLETE | Splash superseded by merged splash/first-run/daylight direction; main `PlayerAudioManager` strictly richer (delay/boost/effects/resume + stages) |
| PR 31/32 | phase3a temp CI workflows | OBSOLETE | Temporary by name; phase closed |
| PR 33 | Ultimate player surface + contract | ALREADY BETTER ON MAIN | Main surface larger and evolved (46KB vs 833-line ancestor); routing + phase-one contract green |

## September hotfixes — all absorbed (individually verified live on main)

- `0825994` + `a662d50` (0.10x playback + syntax): `playerStore.ts:110,116`.
- `54a1739` + `4ee8708` (ultimate-player audio fallback + typecheck): hunks verbatim; lint gate green.
- `fc07f53` (effect-stage disconnect): `PlayerAudioManager.ts:356-362`.
- `b5356d8` / `66bd73b` (ultimate surface + routing): surface, routing, contract green.

## Decision

RECOVER: none. ADAPT: none. Integration PRs required: **zero** — a legitimate,
evidence-backed outcome. No main-wins override was needed because no candidate
demonstrated superiority. No fake feature was restored; no dead control added.
