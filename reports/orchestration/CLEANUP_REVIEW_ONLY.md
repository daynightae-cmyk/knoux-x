# KNOUX X — CLEANUP REVIEW ONLY

Date: 2026-11-02. Measured using read-only Windows filesystem scan. NO DELETIONS. NO SPACE RECLAIMED.

## Disk and scope
- Canonical repository: https://github.com/daynightae-cmyk/knoux-x.git
- Main SHA: 63783e376e78c5c5a6bcb182aa229a645a08ca5d
- K: free 4,348,547,072 bytes; used 47,174,279,168 bytes.
- Worktrees together: 13,955,953,371 logical file bytes / 140,928 files; 3 filesystem inspection failures. Logical sizes are not guaranteed physical reclaim because of hard links, compression and allocation.
- KNOUX X vault documentation is small (74,205 bytes), not the main culprit.

## Sizes by worktree
| Worktree leaf | Logical bytes | Preservation |
|---|---:|---|
| knoux-x-retouch-r1-handoff-20261022 | 8,044,290,075 | DIRTY_PROTECT: 8 modified, 39 untracked |
| knoux-x-authority | 3,265,687,810 | DIRTY_PROTECT: 19 modified, 150 untracked |
| knoux-x-creative-suite-20261029 | 1,637,578,055 | UNIQUE_PROTECT: 4 Git commits, 67 untracked |
| knoux-x-forensics-20261102 | 256,175,575 | PR #103 active |
| knoux-x-play-lane-20261027 | 256,169,559 | PR #101 and one untracked |
| knoux-x-about-polish-r2-20261027 | 250,350,736 | unique corporate identity commit |
| knoux-x-ci-anr-fix-20261027 | 245,701,561 | patch-equivalent only, semantic integration not proved |

## Best non-Git cleanup candidates
All following directories are below:
K:\Knoux Projects\knoux-x\Worktrees\knoux-x-retouch-r1-handoff-20261022\
Git ignore rule at .gitignore:83 covers out-star directories, but ignored does NOT mean disposable.

| Exact subdirectory | Logical bytes | Pre-deletion risk |
|---|---:|---|
| out-export | 620,181,497 | export test result may be unique |
| out-export2 | 620,183,963 | export test result may be unique |
| out-export3 | 620,184,789 | export test result may be unique |
| out-export4 | 620,185,051 | export test result may be unique |
| out-export5 | 620,186,882 | may be latest verifiable installed output |
| out-import | 620,174,028 | import runtime proof may be unique |
| out-about2 | 610,422,409 | approved design evidence risk |
| out-about3 | 610,422,374 | approved design evidence risk |
| out-verify | 467,767,833 | last verification artifact risk |
| node_modules | 1,519,758,377 | can generally reinstall, but active worktree |
| _temp | 225,861,911 | evidence unknown |
| artifacts | 240,071,775 | preserve unique evidence |

Eight export/import/about outputs total approximately 4.60 GiB logical, BEFORE any disk recheck and without asserting they are expendable.

Additional candidates on OTHER ACTIVE worktrees:
- authority/node_modules: 1,931,724,442 bytes; authority/out: 618,635,674 bytes; authority/.vite: 72,387,073 bytes; authority/dist: 69,162,410 bytes.
- creative-suite/node_modules: 1,061,027,462 bytes; creative-suite/dist: 63,351,490 bytes.
- creative-suite/android: 245,608,407 bytes includes untracked native source; PROTECT, NOT blanket cache.
- authority/.git: 253,434,239 bytes contains shared Git object history; NEVER remove manually.
- Production signing keys, passwords, offline backups, agent-created sources, accepted design media and Vault are never cleanup candidates.

## Mandatory recovery and approval
1. Confirm no worker currently owns/uses each precise output path. Codex, Qoder and Traycer processes were observed.
2. Record file list and checksums; preserve unique EXE/APK/AAB, pixel/video QA evidence, user-generated projects and design references.
3. Prove that all source and test changes are merged to verified main or independently backed up.
4. Check regeneration commands, toolchain and version against the exact source SHA. Choose only clearly redundant outputs.
5. Obtain owner approval for the EXACT directory list and impact; a broad request to delete old work is insufficient for removal of unknown valuable files.
6. Perform approved deletions in an isolated logged operation, without git clean, reset, prune, force push, Git object manipulation, or deleting whole agent worktrees by accident.
7. Recheck free bytes and all worktree Git status after cleanup. Do not claim recovered bytes until measured.
8. Worktree/branch removal is a separate operation, requiring per-target unique work, agent-owner, integration and rollback evidence.

## Git merge status at this capture
Open PRs: #86, #89, #97, #101, #102, #103.
- #97 had Android Release and Windows Timeline failures.
- #101 had Android Release failure.
- #102 had Android Debug APK failure.
- #103 is draft with some required checks in progress.
- #86/#89 are behind main and require renewed integration checks.
Do not bypass branch protection, weaken assertions or merge changes without current target-SHA acceptance.

VERDICT: EXACT STORAGE HOTSPOTS IDENTIFIED / CLEANUP NOT YET AUTHORIZED BY EXACT PATH / NO DELETION PERFORMED.
