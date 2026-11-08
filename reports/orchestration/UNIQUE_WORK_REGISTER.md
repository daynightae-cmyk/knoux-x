# KNOUX X — UNIQUE WORK REGISTER / NO DELETION AUTHORITY

Observation date: 2026-11-02. Local Git comparisons are against origin/main at 63783e376e78c5c5a6bcb182aa229a645a08ca5d. The right-only number is patch-equivalence on one side, not semantic equivalence.

| Worktree | Branch | HEAD short | Tracked dirty | Untracked | Right-only commits | Classification |
|---|---|---|---:|---:|---:|---|
| knoux-x-authority | feat/android-image-lab-saf-acceptance-20261020 | d0078a7 | 19 | 150 | 0 | DIRTY_PROTECT |
| knoux-x-about-polish-r2-20261027 | feat/corporate-identity-polish-r2-20261027 | 02277a2 | 0 | 0 | 1 | UNIQUE_PROTECT |
| knoux-x-ci-anr-fix-20261027 | fix/android-settle-window-anr-20261027 | 15c77dc | 0 | 0 | 0 | INTEGRATED_UNVERIFIED |
| knoux-x-creative-suite-20261029 | feat/creative-suite-tools-20261029 | b784358 | 0 | 67 | 4 | ACTIVE_AGENT_UNIQUE_PROTECT |
| knoux-x-play-lane-20261027 | tools/owner-signing-secret-upload-20261029 | 548d637 | 0 | 1 | 1 | UNIQUE_PROTECT |
| knoux-x-retouch-r1-handoff-20261022 | feat/corporate-identity-polish-20261027 | d3808e4 | 8 | 39 | 1 | DIRTY_PROTECT |
| knoux-x-forensics-20261102 | audit/knoux-x-task000-20261102 | 63783e3 at creation | 0 | this audit's files | 0 | ISOLATED_WRITER |

Special preservation:
- Creative Suite four candidate unique commits: a3b4075, 0250333, 8d63ea0, b784358.
- Its 67 untracked files include Android native source/build-related paths; inspect exact contents before any cherry-pick, export, or cleanup.
- Authority's 150 untracked assets and 19 modified evidence files are NOT disposable because branch commits appear patch-equivalent to main.
- Retouch worktree has concurrent edits to release scripts and Image Studio harness. Do NOT overwrite or switch its branch.
- PRs #86 and #89 contain distinct visual/branding content; being BEHIND does not mean redundant.
- PR #101 concerns owner-local signing secrets; inspect only source code and names, never recovered secret values.
- Vault folder K:\KNOUX_PROJECT_PROMPT_VAULT\knoux-x exists; it is not execution proof.

Cleanup policy: READ ONLY, UNKNOWN PRESERVE. No candidate approved for deletion; no disk space reclaimed. File-by-file semantic and hash inventory is still required.
