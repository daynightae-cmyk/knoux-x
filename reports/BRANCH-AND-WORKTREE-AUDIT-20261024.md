# KNOUX X — Repository, branch and worktree audit (2026-10-24)

Read-only inventory, then the actions taken under the owner's authorization to push and merge unique work.
Scope: the local clone, `origin`, every branch, every worktree, every open PR, and the debug / release APK lanes.

## [BASELINE] Repository state

| Item | Value |
| --- | --- |
| Remote | `https://github.com/daynightae-cmyk/knoux-x.git` |
| `origin/main` before this audit | `eaeb83ae8b6d368ffe8bace29821c5917cbf2006` |
| Remote branches | 38 |
| Local branches | 34 |
| Worktrees | 4 |
| Commits present locally but on **no** remote (`git log --branches --tags --not --remotes=origin`) | **none** — nothing un-pushed by commit |
| Tags / GitHub Releases | **none** (`git ls-remote --tags` empty, `gh release list` empty) |

## [FOUND] Branch inventory against `origin/main`

Method, for every remote branch: `ahead` / `behind` counts, `git merge-base --is-ancestor` for "already in main", and `git cherry -v` to test whether its patches are *already applied* upstream under a different commit id.

| Category | Branches | Meaning |
| --- | --- | --- |
| **Already merged into main** (ahead 0) | 29 branches: `fix/retouch-project-save-export-20261022`, `feat/android-cinematic-splash-20261021`, `feat/android-image-lab-20261020`, `feat/android-image-lab-saf-acceptance-20261020`, `feat/android-library-organization-20261021`, `feat/android-mediastore-20261021`, `feat/android-player-tools-20261021`, `feat/android-vault-20261021`, `feat/timeline-color-grading-model-20261022`, `fix/android-vault-postmerge-security-20261022`, `fix/android-vault-security-integrity-20261022`, `fix/android-device-loss-and-native-defects-20261020`, `fix/android-production-closure-20261020`, `feat/android-acceptance-unblock-20261020`, `chore/android-acceptance-consolidation-20261020`, `feat/knoux-x-integration-20261019`, `feat/knoux-x-integration-closure-20261020`, `feat/knoux-x-android-visual-system-20261019`, `feat/knoux-x-final-release-closure`, `feat/knoux-x-production-closure-20261017`, `test/android-audio-lab-acceptance`, `chore/knoux-x-dead-ipc-cleanup-20261018`, `fix/knoux-x-phase02c-real-media-acceptance-20261018`, `phase02b-android-apk-20261018`, `test/baseline-a3ee6d8`, `fix/android-ci-lazy-lint-20260919`, `fix/release-checkout-credentials` and the two merged PR heads | no unique content left; nothing to push, nothing to merge |
| **Patch already upstream, commit id different** (`git cherry` → `-`) | `fix/android-startup-crash-ownership-20261020`, `fix/ipc-reconciliation-20261020` | the change is in main through another commit; merging would add nothing |
| **Truly unique, valuable** | `fix/save-dialog-properties-20261023` (PR #80, 5 commits) | see actions below |
| **Unique id but stale/regressive** | `ci/emulator-guest-20261020`, `test/android-case-order-20261020`, `fix/android-runtime-performance-20260916`, `feat/knoux-x-ultimate-delivery`, `fix/knoux-x-recovery-20261018-01a1503f`, `ci/emulator-angle-20261020` | see "must not merge" below |

### Why the stale ones must not be merged (evidence, not assumption)

| Branch | Diff against current main | Verdict |
| --- | --- | --- |
| `ci/emulator-angle-20261020` | main already runs `-gpu angle_indirect`; the only delta is that the branch lacks main's explanatory comments | superseded, no content |
| `ci/emulator-guest-20261020` | would replace main's `-gpu angle_indirect` with `-gpu guest` | **regression** — main chose angle_indirect deliberately (documented in the workflow: guest "still used the SwiftShader translator") |
| `test/android-case-order-20261020` | its 28-line region in `tools/android-real-workflows.cjs` shows main holding *more* code (fixture constants the branch never had) | stale ancestor; merging reverts |
| `fix/android-runtime-performance-20260916` (2026-09-16) | `src/main.tsx` delta is main's later android-back/bridge/audio/slideshow bootstrap being absent on the branch | stale ancestor; merging reverts |
| `feat/knoux-x-ultimate-delivery` | deletes `CHECKPOINT.json`, `THIRD_PARTY_NOTICES.md`, `android-preview.html`, `design-evidence/android-visual-20261019/*` and 12 tool files as they exist today | stale snapshot; merging deletes current content |
| `fix/knoux-x-recovery-20261018-01a1503f` | its only "ahead" commit is a merge commit (`git cherry` produced no patch) | nothing to carry |

One file is genuinely absent from main: `tests/unit/atomic-write-transient-rename.test.ts` (62 lines, on `feat/knoux-x-ultimate-delivery`). It was **not** cherry-picked, because that branch's tree would also delete current files; if the owner wants that test it should be re-created on top of main's existing `tests/unit/atomic-file-write.test.ts`, which already covers atomic writes without the transient-rename case. Recorded as an open question, not silently imported.

## [FOUND] Worktree inventory

| Worktree | Branch | HEAD | In main? | Uncommitted |
| --- | --- | --- | --- | --- |
| `Worktrees/knoux-x-retouch-r1-handoff-20261022` (this one) | `main` | `1f19b4b` (merge of PR #82) | — | clean except 3 untracked media artefacts (`timeline-export.webm`, `timeline-source.mp4`, `MATRIX-PROJECT.KNOUXEDIT`) that are deliberately not committed |
| `Worktrees/knoux-x-r3-acceptance-20261023` | `fix/r3-acceptance-20261023` (**local only, no remote ref**) | `e29c818` (merge of PR #79, already in main) | branch tip in main | **24 modified, 4 deleted, 8 untracked** — includes real source edits: `src/features/export/manualFrameCapture.ts`, `electron/ipc/setup.ts`, `electron/ipc/file-dialog-policy.ts`, `tools/run-packaged-timeline-export-cdp-e2e.cjs` |
| `Worktrees/knoux-x-authority` | `feat/android-image-lab-saf-acceptance-20261020` | `d0078a7` | merged | 19 modified, 12 untracked (acceptance evidence) |
| `Worktrees/knoux-x-vault-postmerge-security-20261022` | `fix/android-vault-postmerge-security-20261022` | `2625b43` | merged | clean |

**Risk named plainly:** `fix/r3-acceptance-20261023` exists only in this local clone and its source edits are uncommitted, so it is the one thing in the repository that would be lost outright. It is another task's in-flight work in a live working directory, so it was **not** staged, committed, pushed or reverted — committing someone else's half-finished edits into a published branch is exactly the kind of overwrite the standing rules forbid. It was instead copied, byte-for-byte with hashes, to `Backups\knoux-x-worktree-snapshot-20261024\knoux-x-r3-acceptance-20261023\` (416 files, manifest `_FILES.sha256`), together with the `knoux-x-authority` evidence set (207 files). Copy-only; the worktrees were not modified.

## [FIXED] Actions taken under authorization

1. **PR #82 `fix/windows-native-shell-20261024` merged** → main `1f19b4b6f376d01a026b5987ac5bfcd28cb4aab9` at 2026-10-24T20:33:15Z. Merged on evidence, not on hope: every executed lane green on the exact head `12b808f` — `KNOUX Full Rebuild Windows`, `Player Viewport Windows`, `Windows Timeline Export E2E`, `Windows Packaged Creative + Recording Real E2E`, `Android APK (Capacitor)`, `Android Release Acceptance` (6 success, 2 workflow-level skips by design). Local branch fast-forwarded to the new main; no force, no rewrite.
2. **PR #80 `fix/save-dialog-properties-20261023` merged** at 2026-10-24T21:09:12Z → main `d2a60c5a`. Sequence, because the shortcut was available and deliberately not taken: it was a **draft** whose own checks all passed → verified conflict-free against the new main with read-only `git merge-tree` → `gh pr ready` → GitHub then refused the merge ("the head branch is not up to date with the base branch", a real branch-protection rule) → `gh pr update-branch` merged main into the PR head (`0183ee9d`) and re-ran the *entire* suite against the combined code → all lanes passed (debug APK, CI-signed release APK, `validate-package`, timeline export, packaged creative + recording) → only then merged. `--admin` to skip the base-up-to-date rule was **not** used, because that rule exists exactly to stop merging code whose CI ran against a different base.

What PR #80 contributes, and why it was worth landing: `electron/ipc/file-dialog-policy.ts` (+23) and `electron/ipc/setup.ts` (+11) preserve validated native save-dialog properties that were being dropped, plus `tests/unit/file-save-dialog-options.test.ts`, a media-discovery fixture restore test, a pre-install ANR status test, and line-ending normalisation before Bash execution in the Android acceptance. This is the same defect family as directive §3 (the native dialog must hand back exactly what the user chose), and it had already been green on its own head for a day without anyone landing it.

3. **Nothing else was pushed**, because nothing else needed pushing: `git log --branches --tags --not --remotes=origin` is empty, so every local commit already exists on the remote. The 29 merged branches, the 2 already-upstream-patch branches and the 6 stale/regressive branches were left exactly as they are; no branch was deleted, no worktree was removed, no force-push, no history rewrite.


## Debug and release APK — the definitive position

| Question | Answer with evidence |
| --- | --- |
| Where do debug APKs come from? | `Android APK (Capacitor)` (`android-apk.yml`): triggers `pull_request` to main, `push` to main, and `workflow_dispatch` (with an `emulator-api` 34/35 choice). Job "Validate, launch-test, and build installable debug APK": `npm ci --ignore-scripts`, rebuild of electron/ffmpeg/ffprobe/sharp, brand verify, typecheck, ESLint **zero-warning**, native vault-core regression, full jest gate, gradle debug build, install + launch on an API-35 KVM emulator, artifact `KNOUX-X-Android-debug-<sha>` |
| Is the debug lane green on the merged main? | See "final status" below — the run for `1f19b4b6` (event `push`) is executing; the last completed debug-lane run on the PR head `12b808f` was **success** with artifact `KNOUX-X-Android-debug-da9939…` at **129,127,249 bytes** (run 40127644578) |
| Where do release APKs come from? | Two different things, and they must not be confused. (a) **`Android Release Acceptance`** (`android-release-acceptance.yml`) builds a **CI-signed** release APK (`tools/android-ci-release.sh` → `KNOUX-X-Android-release-ci-signed.apk`), verifies identity+signature with `tools/verify-android-apk.cjs`, installs and launches it on the emulator, and uploads `KNOUX-X-Android-release-acceptance-<sha>` (**122,601,749 bytes** on the last green run 40127644571). This is an acceptance build signed with a throwaway CI key. (b) **`Knoux X — Release All Platforms`** (`knoux-live-release.yml`) is the publishing lane: it generates/uses an Android keystore, runs `apksigner verify --print-certs`, reports Windows Authenticode truth, and `gh release create` (draft unless `mode=publish`) |
| Has anything ever been released? | **No.** The repository has zero tags and zero GitHub Releases, and the publishing lane's only three runs are from **2026-09-10, all failed** (two on `fix/release-checkout-credentials`, one on `main`). |
| Is Windows signed? | **No.** No `signtool`/certificate/Authenticode step exists in `full-rebuild-windows.yml` or `forge.config.js`; `knoux-live-release.yml` would report `not-configured` because its own signing check reads the real signature status. `Setup.exe` from CI is unsigned and must never be labelled a verified signed production release |
| Can I just run the release lane for you? | Not as a side effect: `mode: draft` still **creates a tag and a draft GitHub Release** (`gh release create --draft` plus `gh release upload`), so it changes the repository's published surface. That needs a specific go-ahead — say `draft` or `publish` and it is one command |

### Measured APK facts (from the last green runs, not from workflow text)

| Fact | Debug lane | Release acceptance lane |
| --- | --- | --- |
| Run used | 40127644578 (head `12b808f`) | 40127644571 (head `12b808f`) |
| Build | `./gradlew assembleDebug --no-daemon --stacktrace` → `BUILD SUCCESSFUL in 1m 29s` | `bash tools/android-ci-release.sh android-ci-release-output android` |
| Staged artefact | `android-ci-output/KNOUX-X-Android-debug.apk` with `.sha256` and `.size` sidecars, `test -s` enforced | `android-ci-release-output/KNOUX-X-Android-release-ci-signed.apk`, verified by `node tools/verify-android-apk.cjs` |
| Uploaded artefact size | **129,127,249 bytes** | **122,601,749 bytes** |
| Signature | Android debug keystore — a debug build is never a release candidate | `apksigner`: **v2 scheme true, v3 scheme true**, v1 (JAR) false, v3.1 false, v4 false |
| Signer identity | — | `CN=Knoux X CI Release Verification, OU=CI, O=Knoux X, L=Abu Dhabi, ST=Abu Dhabi, C=AE`, RSA 3072, certificate SHA-256 `f0ede6c760517640d58d65dda966203888d8745c0df723d332cc175170859759` |
| Reading | installable debug APK proven on an API-35 KVM emulator | a **CI verification key**, proving the release build signs, installs and launches — **not** a Play/production upload key |

## Final status after the merge train — every lane settled

| Ref | Debug APK lane | Release acceptance lane | Full Rebuild Windows | Timeline export E2E |
| --- | --- | --- | --- | --- |
| `12b808f` (PR #82 head) | **success** 40127644578 | **success** 40127644571 | **success** 40125372890 | **success** |
| `1f19b4b6` (main after PR #82) | **success** 40130301864 | **success** 40130301859 | **success** 40130301896 | **success** |
| `0183ee9d` (PR #80 vs new main) | **pass** | **pass** | **pass** (`validate-package`) | **pass** |
| `d2a60c5a` (main after PR #80) | **success** 40132952587 → `KNOUX-X-Android-debug-d2a60c5…`, **129,302,973 B** | **success** 40132952566 → `KNOUX-X-Android-release-acceptance-d2a60c5…`, **122,465,773 B** | cancelled — my own docs push superseded it under `cancel-in-progress` | cancelled — same reason |
| `d68d6e5` (today's `main`) | — (docs-only, outside the lane's `paths:` filter) | — | **success** 40134171646 → `Knoux X-2.1.0 Setup.exe` SHA-256 `E0D6E0FD964D493CF534B6B800DF46D3F3F1071E7326B2BB9981604951FACE05`, `knoux-player-x.exe` `FBB1D6141576AFAE8566724A769032169A75A538A044439DA793F5D4E07C22A3`, install `installed-before=False`/`setup-exit=0`, repair `installed-before=True`, uninstall `removed=True` | **success** 40134171443 |

Today's `main` therefore has, each backed by a run rather than an inference: a **green debug APK** lane (installable + launched on an API-35 KVM emulator), a **green CI-signed release APK** lane (v2+v3 signature verified, installed and launched), a **green Windows installer** lane with the `Setup.exe` artefact contract and install/repair/uninstall acceptance, and a **green packaged timeline-export** lane.

Two honest notes. First, the Windows lanes for `d2a60c5a` were **cancelled by my own next push**, not by a failure — `full-rebuild-windows.yml` and the export lane carry `cancel-in-progress: true`. The same merged code, plus markdown, is green on `d68d6e5`, so the Windows verdict for the merged tree stands on its own run rather than being inherited. Second, the Android lanes declare `paths:` filters (`src/**`, `tests/**`, `tools/android-*`, …), which is why a docs-only push shows dashes instead of runs — that is the workflow's own scoping, not a skipped or weakened test.


Local certification of the merged tree (PR #82 + PR #80 together): `npx node@20 jest` → **194 suites / 1,662 tests, 0 failed** (PR #80 added 3 suites and 23 tests); `npm run typecheck` exit 0; `node tools/fix-final-quality-gates.cjs` exit 0 (all historical repairs still `[PASS]`).

