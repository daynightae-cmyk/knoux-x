# Unreachable-Commit Forensic Audit — Knoux X

- main: `9aec27b` (audited tree; report committed on top)
- date: 2026-09-09
- method: `git fsck --unreachable`, `git cherry main`, added-line content
  coverage per commit, stash-chain analysis, branch divergence check
- verdict: **NO UNIQUE TREASURE — nothing to extract**

## Inventory

- Unreachable commits: **129**. Dangling commits: 0.
- `git cherry main`: **2** patch-id absorbed (`-`), **127** divergent patch-ids (`+`).
  `+` is expected: squash-merges and refactors change patch-ids.
- Content triage (every added source line checked against current main):
  - **34 absorbed** (all added lines present on main)
  - **48 non-source-only** (historical Phase-01 docs, CI scaffolding, old
    test harnesses — superseded by current pipelines)
  - **2 empty** (dropped-stash bookkeeping, absorbed — see below)
  - **45 review-flagged** (exact-line mismatches from code evolution)

## Dropped stash — absorbed

- Chain `0272180` (base, ancestor of main) → `51bb6a6` (index, empty diff)
  → `77e7a7b` ("On main: local-test-modification").
- The single worktree line (Forge Vite `MAIN_WINDOW_VITE_NAME` test
  expectation) is present on main at
  `tests/unit/native-runtime-foundation.test.ts:201`.
- `git stash list` is empty. Nothing to recover.

## Local branch — preserved

- `traycer/retouch-v2-temporal` (checked out in another agent's worktree):
  **0 ahead, 15 behind main** — fully absorbed ancestor, not deleted
  (foreign worktree; deletion is that agent's call).

## September candidates — all absorbed (individually verified)

- `0825994` + `a662d50` (0.10x playback + syntax fix): both live on main
  (`src/store/playerStore.ts:110,116`).
- `54a1739` + `4ee8708` (ultimate player audio fallback + typecheck):
  hunks verbatim on main (`UltimateMobilePlayer.tsx:291-297`); lint gate green.
- `fc07f53` (effect-stage disconnect on removeEffect): present on main
  (`PlayerAudioManager.ts:356-362`).
- `b5356d8` / `66bd73b` (ultimate mobile surface + routing): surface,
  routing, and phase-one contract tests green on main.

## Review-flagged foundation commits — absorbed via squash

Spot-verified across every area; each system exists on main in evolved
form with green contract tests: recording state machine
(`recordingState.ts`, `recording-service.ts`), Sprint 02
(`sprint02CommandSystem`, tests green), input validation boundary
(`window-security.ts`, `validation.ts`), capture helpers (capture
tests green), image-studio construction (document/layers/compositor/
export/persistence/offline/credentials/ai suites green, locale bundle
with en/ar coverage), IPC foundation (303-channel manifest parity test
green), packaged-proof lineage (current packaged IPC smoke green on
this SHA), native rebuild (forge `afterPrune` sharp/sqlite logs green).

## Obsolete experimental — intentionally not resurrected

- `6ac7a84` (Aug 22 cinematic splash rebuild): files absent on main by
  design; superseded by the merged splash + first-run + daylight
  direction. Resurrecting it would regress closed branding work.

## Unreachable blobs (169)

Historical asset/report residue. No source treasure suspected; left
untouched (no deletion without need).

## Conclusion

- Unique useful work: **none found**.
- Extraction commit: **none required**.
- Deletions performed: **none** (branches preserved per policy).
- Baseline stays: main `9aec27b` + this report, CI green.
