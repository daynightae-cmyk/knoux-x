# KNOUX X — 2026-11-08 evidence-led consolidation checkpoint

Status: PARTIAL / LOCAL-ONLY / NOT RELEASED. Do not mistake this checkpoint for production acceptance.

## Verified baseline

- Canonical origin: `https://github.com/daynightae-cmyk/knoux-x.git`.
- Live GitHub `main` and the local `main` ref were both verified as `00f483dce9aff4ce0cd0475d5fac5a755d245b67`.
- The local `main` ref was safely fast-forwarded from `7e0e9445fe33d9cc2dac934c56d01eeaa1583b9d`; no reset, force-push, worktree deletion or lost commit.
- Separate integration worktree and branch were created from that exact base; the existing dirty worktrees were not modified.

## Changes selectively staged for validation

- `815a669`: Windows ffmpeg/ffprobe executable resolution from PR #97 (`d1afd28`).
- `e249aa9`: owner-run Android signing-secret upload tool from PR #101 (`548d637`). No secrets accessed or uploaded during this consolidation.
- `796fc27`, `78587ec`, `d25d8ec`: read-only forensic audit, inventory and historical storage review from PR #103.
- Five feature/audit commits were cherry-picked with `-x` without conflicts; existing source worktrees were left intact.

## Duplicate code identified, not remerged

- PR #102: all 38 changed paths have identical Git blob hashes in the latest `main`. Its source content is already integrated; the still-open PR is not a reason to overwrite newer `main`.
- The earlier corporate-identity polish branch: 14 of 14 changed paths are identical to `main`.

## Work still not safe to remove or promote

- `knoux-x-authority`: 19 modified tracked paths are blob-identical to `main`, but 150 untracked files (about 74 MB in the audited set) are not in `main`; preserve the media/evidence.
- `knoux-x-retouch-r1-handoff-20261022`: 35 examined paths are identical to `main`, 11 differ and one Windows import matrix project is absent from `main`; some differing CI files remove assertions or workflow content and must not be bulk-copied.
- Existing release/signing and CI PR checks remain blocked or failing: #97/#103 Vercel account blocked, #101 release Android job failed, #102 debug Android job failed on its old head. These do not negate green checks on the separate latest `main` head.
- Do not delete any worktree, backup, archive, or shell/profile data until its unique contents have been protected and its current replacement has been proven.

## Tests and environment limits

- `git diff --check main...HEAD`: exit 0 before this report.
- `node --test tests/forensics/audit-knoux-worktrees.test.cjs`: 2/2 pass, exit 0.
- PowerShell parser for `tools/owner-upload-android-signing-secrets.ps1`: 0 syntax errors.
- Initial full `npm ci` under host Node 24.21.0 failed: `better-sqlite3` has no prebuilt binary for the host runtime and local `node-gyp` rejects the available Visual Studio 18 Build Tools. Project `.nvmrc` specifies Node 20.
- Full native installation, Windows packaged runtime, CI on this integration branch, and Android production signing are **not yet verified** by this checkpoint.

## Safety rules

Do not force-push, reset --hard, clean, delete a worktree or backup, or promote to `main` from this report alone. Validate merged diff, typecheck, lint, unit tests, packaged Windows media import/export and Android build/runtime on the actual integration SHA before any release verdict.
