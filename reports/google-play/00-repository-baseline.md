# 00 — Repository baseline

Captured 27 October 2026, before any change in this pass. Every line below was
re-read from the repository or the GitHub API at capture time; the launch
directive's reference table is **not** trusted anywhere it disagrees.

## Remote truth

| Item | Value |
|---|---|
| Repository | `daynightae-cmyk/knoux-x` |
| `origin/main` | `42aef17b9c7ad69521580b885c1c19e308c99a4e` |
| Main commit message | `Merge pull request #87 from daynightae-cmyk/fix/android-slideshow-encoder-fallback-20261027` |
| gh auth | `daynightae-cmyk`, scopes `repo, read:org, workflow, gist` |

`origin/main` still equals the SHA recorded in the directive's reference table,
so nothing merged since that inspection.

## Worktrees (all preserved, none reset, none cleaned)

The directory `K:\Knoux Projects\knoux-x` is **not** a git repository; it is a
container. Two registered worktrees share one git directory:

| Path | Branch | HEAD |
|---|---|---|
| `Worktrees/knoux-x-authority` | `feat/android-image-lab-saf-acceptance-20261020` | `d0078a7` |
| `Worktrees/knoux-x-retouch-r1-handoff-20261022` | `fix/android-signing-fingerprint-20261027` | `03cb8db` |

All work in this pass happened in `knoux-x-retouch-r1-handoff-20261022`.

Untracked file found and left untouched:
`reports/windows-import-matrix/MATRIX-PROJECT.KNOUXEDIT` (retouch worktree).
No stashes exist in either worktree.

## Pull requests

| PR | State | Head | Notes |
|---|---|---|---|
| #88 | OPEN | `03cb8dbc38aa4f0ffc3e314fdab989410ddf8a28` | `fix(android): hard certificate pin for production signing`. `mergeable=MERGEABLE`, `mergeStateStatus=BLOCKED`. Author `daynightae-cmyk`. Diff touches **only** `tools/android-ci-release.sh`. |
| #86 | OPEN | `fedc32cd…` | `docs: unveil KNOUX X — cinematic bilingual README`. `mergeable=UNKNOWN` (still computing). |
| #87 | MERGED 2026-10-27T02:40:55Z | `fix/android-slideshow-encoder-fallback-20261027` | WebM fallback when a device has no MP4 encoder. |
| #85 | MERGED 2026-10-27T00:37:06Z | `feat/corporate-identity-20261025` | In-app KNOUX corporate/founder/contact experience. |
| #84 | MERGED 2026-10-26T23:18:02Z | `fix/android-cinematic-splash-20261025` | Cinematic splash and glass handoff. |
| #83 | MERGED 2026-10-25T00:07:16Z | `fix/android-packaging-hardening-20261025` | No source maps, no cloud backup, no debug WebView in release. |

Branches carrying unmerged or preserved work, all still present on the remote:
`ci/emulator-angle-20261020`, `ci/emulator-guest-20261020`,
`docs/premium-readme-20261027`, `feat/knoux-x-ultimate-delivery`,
`fix/android-runtime-performance-20260916`, `fix/android-startup-crash-ownership-20261020`,
`fix/ipc-reconciliation-20261020`, `fix/knoux-x-recovery-20261018-01a1503f`,
`preserve/authority-evidence-wip-20261025`, `preserve/orphaned-color-wip-20261020`,
`preserve/orphaned-wip-20261021`, `preserve/r3-acceptance-wip-20261025`,
`test/android-case-order-20261020`, `pr52`.

The local branch `feat/android-image-lab-saf-acceptance-20261020` tracks a remote
that is now **gone** (`[origin/…: gone]`); the commit `d0078a7` is still held by
the authority worktree, so the work is not lost.

## CI state on PR #88 at capture

| Check | Result |
|---|---|
| Build, sign, install, and launch release APK | **pass** (27m58s) |
| packaged-timeline-export | pass |
| windows-packaged-creative | pass |
| windows-recording-real | pass |
| validate-package (Windows Full Rebuild) | **fail** (7m9s) |
| closeout | skipping |
| CodeRabbit / Gitar / Vercel | skipping / pass / pass |

Run: <https://github.com/daynightae-cmyk/knoux-x/actions/runs/40467750119>
Failing job: <https://github.com/daynightae-cmyk/knoux-x/actions/runs/40467750119/job/122067168622>

`validate-package` is a **required status check on `main`**, alongside the two
Android lanes, which is why #88 is `BLOCKED` rather than merely red.

## Signing and secret state — corrected against the directive

| Item | Directive said | Actual |
|---|---|---|
| `android-production` environment | created previously | **exists**, created 2026-10-27T08:30:09Z |
| Five production secrets | NOT VERIFIED AS UPLOADED | **verified absent at capture** — 0 environment secrets, 0 repository secrets, 0 repository variables. *Later in this session the two non-secret values were uploaded; see report 01 Part C.* |
| Environment protection | — | `protection_rules: [branch_policy]`, `deployment_branch_policy: {protected_branches: true, custom_branch_policies: false}`, `can_admins_bypass: true` |
| Production keystore | reference paths | **present and byte-verified** (below) |

The environment's branch policy restricts it to protected branches, but
`knoux-live-release.yml` fires on **tag push** and `workflow_dispatch`. That
combination can prevent the release job from ever seeing the environment
secrets. Flagged as an owner decision, not silently worked around.

## Signing identity — independently verified with real tooling

`keytool -printcert` against `D:\KNOUX-Private-Signing\knoux-x-android-production-2026-cert.pem`:

| Field | Value |
|---|---|
| Owner | `CN=KNOUX X Android Production, OU=Engineering, O=KNOUX X, L=Abu Dhabi, ST=Abu Dhabi, C=AE` |
| Certificate SHA-256 | `695ef97df906e91ce5e06d809b1303fdb0a209b9f79e7c3b3b98e34ea22fd6cd` |
| Matches the directive's expected pin | **yes, exactly** |
| Key | 4096-bit RSA, `SHA384withRSA` |
| Validity | 2026-10-27 11:53:49 GST → 2059-09-04 11:53:49 GST |
| Keystore SHA-256 | `0d66ffb88f4bd30391a34a1825deea26b50acee1dc51f0d04e0dfb470273e448` |
| `K:` secondary copy | byte-identical to the `D:` primary |

No password was requested, entered, or read. The store itself was not opened —
only the exported public certificate.

The CI acceptance lane signs with a **different** identity, confirmed from the
real artifact: `CN=Knoux X CI Release Verification, OU=CI`, SHA-256
`b671431aa3570d804fd2b576cc4eafa756b1553fbc10860be388e21982e8a49f`.

## Artifact state

| Item | Actual |
|---|---|
| `versionName` / `versionCode` | `2.1.0` / `20100` — matches `tools/knoux-release-version.cjs` and the compiled APK badging |
| Application id | `dev.knoux.playerx` |
| `targetSdkVersion` / `minSdkVersion` / compileSdk | `36` / `24` / `36` |
| Production-signed AAB | **does not exist** — no AAB is produced by any lane that actually runs |
| Google Play submission | not started |

The acceptance lane built only `assembleRelease`. `bundleRelease` appears solely
in `knoux-live-release.yml`, which runs on tags or manual dispatch and has never
published. So before this pass, **no runnable code path had ever produced an
AAB**, and the one path that could produce one silently fell back to a CI key.

## Defects carried into this pass

1. `tools/android-ci-release.sh` — the certificate pin was optional in
   production mode, so any keystore yielded `productionSigned: true`.
2. Same file — dead fingerprint code ran `apksigner verify` against a *keystore*
   (apksigner verifies APKs), swallowed the failure, and compared nothing.
3. Two different, never-set pin variable names in one file.
4. `knoux-live-release.yml` — silent CI-keystore fallback, no pin check at all,
   and the result was uploaded to a public GitHub Release anyway.
5. No workflow declared `environment: android-production`, so environment
   secrets were unreachable even if uploaded.
6. Signing passwords passed as plaintext process arguments.
7. `tools/verify-apk-signing-block.cjs` accepted a **prefix** as a pin.
8. No negative tests: the 11 required rejection cases were covered 0/11.
9. `tests/unit/android-release-acceptance-contract.test.ts` actively asserted
   the APK-only defect.

See `01-signing-and-play-app-signing-decision.md` for the signing remediation
and the owner decision that still blocks any upload.
