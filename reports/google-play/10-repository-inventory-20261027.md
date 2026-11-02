# Full repository inventory — 2026-10-27 21:10 GST

Read-only. No push, merge, branch deletion, checkout or stash was performed.

## Worktrees

| Path | Branch | HEAD | State |
|---|---|---|---|
| `Worktrees/knoux-x-authority` | `feat/android-image-lab-saf-acceptance-20261020` | `d0078a7` | **DIRTY — 19 modified + unmerged evidence. Do not delete.** |
| `Worktrees/knoux-x-retouch-r1-handoff-20261022` | `feat/corporate-identity-polish-20261027` | `d3808e4` | **Active — another agent is working here.** |

`git worktree prune -n` reports nothing stale.

## The Google Play work is already committed and pushed

Commit `b1ca602` "feat(android): land the Google Play production-readiness lane"
(21:01 GST) on `feat/google-play-production-readiness-20261027`, **pushed to
origin**, built on `03cb8db` (PR #88's head). 43 files, +3680/−40.

Every file in this worktree was compared against `b1ca602` and is **byte-identical**
— the signing gate, the release script, the workflow, the manifest hardening, the
store asset builder, all four reports, both privacy policies and all 38 tests.
The dirty state in this worktree is therefore a redundant duplicate, not
unpreserved work. **Nothing of mine is at risk.** It was committed by a
concurrent process, not by me.

## Branch disposition (16 local)

`git cherry origin/main` distinguishes already-upstream (`-`) from unique (`+`).

### Safe to delete — content already in main

| Branch | Evidence |
|---|---|
| `main` | the trunk |
| `feat/android-image-lab-saf-acceptance-20261020` | ancestor of main, 0 ahead. **But it is checked out by the dirty authority worktree — cannot delete while registered.** |
| `fix/android-slideshow-encoder-fallback-20261027` | merged as PR #87 |
| `fix/android-startup-crash-ownership-20261020` | patch already upstream (`-`) |
| `fix/ipc-reconciliation-20261020` | patch already upstream (`-`) |
| `ci/emulator-angle-20261020` | superseded in substance — main already runs `-gpu angle_indirect` in all three workflows |
| `ci/emulator-guest-20261020` | superseded — `-gpu guest` was not adopted |

### Open PRs — mergeable but **BLOCKED**

| PR | Branch | Unique | Status |
|---|---|---|---|
| #88 | `fix/android-signing-fingerprint-20261027` | 1 commit, 1 file | MERGEABLE / **BLOCKED** |
| #89 | `feat/corporate-identity-polish-r2-20261027` | 1 commit, 14 files | MERGEABLE / **BLOCKED** |
| #90 | `fix/android-settle-window-anr-20261027` | 2 commits, 3 files | MERGEABLE / **BLOCKED** |
| #86 | `docs/premium-readme-20261027` | docs | MERGEABLE / **BLOCKED** |
| — | `feat/google-play-production-readiness-20261027` | 2 commits, 43 files | **pushed, no PR yet** |

`BLOCKED` here is not a formality: `main` has three required status checks
(`validate-package`, the debug APK lane, the release APK lane) plus
`strict: true`. **No PR can be merged until those checks pass on its head.**
Branch protection cannot be overridden by this account without disabling it,
which is a destructive shared-state change I will not make.

### Genuinely unique, no PR

| Branch | What is unique |
|---|---|
| `feat/knoux-x-ultimate-delivery` | back-button files are **already in main**; `electron/fs/atomic-write.ts` differs in wording only (main already has `RENAME_RETRY_CODES` retry logic). **One real orphan:** `tests/unit/atomic-write-transient-rename.test.ts` (62 lines) exists only here. |
| `test/android-case-order-20261020` | reorders acceptance cases in `tools/android-real-workflows.cjs` (+16/−12). Shared harness tool — merging blindly risks conflict with other agents' acceptance work. |
| `preserve/authority-evidence-wip-20261025` | 145 files of preserved evidence |
| `preserve/r3-acceptance-wip-20261025` | 335 files, mostly `reports/r3-acceptance-20261023` (264) — deliberate evidence archive |
| `feat/corporate-identity-polish-20261027` | local-only first attempt; same subject as PR #89's `02277a2`, i.e. **superseded by r2**. Currently checked out with the duplicate files. |

## Pushed vs local-only

Local-only: `feat/android-image-lab-saf-acceptance-20261020`,
`feat/corporate-identity-polish-20261027`. Everything else is on origin.
**A local-only branch must be pushed before any deletion**, or its commits are
unrecoverable.

## Space already reclaimed this session

1.78 GB — see `CLEANUP-20261027.txt`. One 82 MB file
(`Backups/…/lockprobe/fresh-copy.asar`) resisted deletion with
`Device or resource busy`; no process was killed to force it.

## What is NOT mergeable by me unilaterally

1. Four PRs are gated by required checks; merging needs those green first.
2. `main` is protected — no direct push.
3. An agent is active in this worktree; branch switches can collide.
4. `preserve/*` and the authority worktree hold unmerged evidence.
5. Merging my branch also lands PR #88 (it is the parent) — intended, but it
   means PR #88 should be closed as superseded rather than merged separately.
