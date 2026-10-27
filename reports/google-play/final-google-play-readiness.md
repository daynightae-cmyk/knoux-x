# Final Google Play readiness

Generated 27 October 2026 from direct verification, not from the launch
directive's reference table. Classifications are `VERIFIED` / `PARTIAL` /
`IMPLEMENTED-NOT-VERIFIED` / `UNMERGED` / `LOCAL-ONLY` / `BLOCKED` /
`NOT-IMPLEMENTED` / `UNKNOWN`. No `BLOCKED` row has been reworded into a pass.

## A. Executive verdict

# `PARTIAL`

Not `GOOGLE_PLAY_INTERNAL_TEST_READY`. The signing pipeline is now genuinely
fail-closed and the store package is real, but **no production-signed artifact
exists, no AAB has ever been built by a lane that runs, no physical device has
ever executed this build, and the Play Console account is unconfirmed.**

## B. Repository state

| Item | Value |
|---|---|
| `origin/main` | `42aef17b9c7ad69521580b885c1c19e308c99a4e` (unchanged from the directive's table) |
| PR #88 | OPEN, head `03cb8db`, `mergeable=MERGEABLE`, `mergeStateStatus=BLOCKED` |
| PR #87 | MERGED 2026-10-27T02:40:55Z |
| PR #86 | OPEN (docs) |
| Worktrees | 2 registered, both preserved; nothing reset, cleaned or deleted |
| **Hazard** | The retouch worktree was switched by a concurrent process to local branch `feat/corporate-identity-polish-20261027` (`d3808e4`, unpushed) mid-session. All work below is **uncommitted** and now sits on that branch. |

CI on PR #88 at capture: Android release acceptance **pass**; packaged timeline,
packaged creative and recording **pass**; `validate-package` **fail** — then
**pass on re-run of the identical commit** (see Phase 19 below).

## C. Android implementation

`PRODUCTION_IDENTITY_RUN: NOT EXECUTED`

Every signing statement below is **code-level**: the gate is exercised by real
`keytool` against throwaway keystores, and the shell script is executed against
stubbed Gradle/apksigner to prove it aborts. **None of it has ever run against
the owner's approved production identity**, because three secrets are absent and
no publishable run has been made. The correct label for the signing remediation
is `IMPLEMENTED-NOT-VERIFIED-AT-PRODUCTION-IDENTITY`, not `VERIFIED`.


Changed files:

| File | Change |
|---|---|
| `tools/verify-production-signing-identity.cjs` | **new** — shared fail-closed identity gate |
| `tools/android-ci-release.sh` | mandatory pin, dead code removed, `bundleRelease`, cross-artifact identity, env-only passwords, explicit store type, 16 KB measurement, full provenance JSON |
| `.github/workflows/knoux-live-release.yml` | `environment: android-production`, CI fallback deleted for publishable runs, identity gate, post-signature pin check on APK **and** AAB, publish job refuses non-production identity |
| `tools/verify-apk-signing-block.cjs` | prefix pins rejected; every signer must equal the pin |
| `tools/harden-android-manifest.cjs` | unused `CAMERA` rewritten to a merger removal rule, idempotently |
| `tools/verify-image-studio-project-lifecycle.cjs` | pre-flight renderer-entry check |
| `tests/unit/android-production-signing-gate.test.ts` | **new** — 29 behavioural tests |
| `tests/unit/android-manifest-permission-minimisation.test.ts` | **new** — 9 tests |
| `tests/unit/android-release-acceptance-contract.test.ts` | stopped asserting the APK-only defect |

Verification, all with real tooling:

| Command | Environment | Exit | Verdict |
|---|---|---|---|
| `node tools/verify-production-signing-identity.cjs …` (11 rejection scenarios) | Windows, JDK 21 `keytool` | 0/1 as designed | **VERIFIED** |
| `npx jest tests/unit/android-production-signing-gate.test.ts` | Windows | 0 — 29/29 | **VERIFIED (code-level only)** |
| `npx jest tests/unit/android-manifest-permission-minimisation.test.ts` | Windows | 0 — 9/9 | **VERIFIED (code-level only)** |
| `npx jest --runInBand` (full suite) | Windows | 0 — **1726 passed, 0 failed**, 1 suite skipped | **VERIFIED** |
| `npx tsc --noEmit` | Windows | 0 | **VERIFIED** (but see caveat) |
| `npm run lint -- --max-warnings=0` | Windows | 0 | **VERIFIED** |
| `bash -n tools/android-ci-release.sh` | Git Bash | 0 | **VERIFIED** |
| `keytool -printcert` on the production cert | Windows | 0 | **VERIFIED** |
| `tools/verify-apk-signing-block.cjs` on the real CI APK | Windows | 0 pass / 1 reject | **VERIFIED** |
| Credential scan of all 145 shipped JS files (3 064 336 bytes) | from the real APK | 0 hits | **VERIFIED** |

**Caveat, stated not hidden:** `tsconfig.json` excludes `**/*.test.ts` and does
not include `tools/`, so the green typecheck does not cover the new gate or the
new tests. `eslint --ext .ts,.tsx` likewise never lints `.cjs` or `.sh`. The
tests themselves are the real coverage for those files.

## D. Cryptography

| Item | Value |
|---|---|
| Upload/production certificate SHA-256 | `695ef97df906e91ce5e06d809b1303fdb0a209b9f79e7c3b3b98e34ea22fd6cd` — **matches the directive exactly**, verified independently |
| Subject | `CN=KNOUX X Android Production, OU=Engineering, O=KNOUX X, L=Abu Dhabi, ST=Abu Dhabi, C=AE` |
| Key | RSA 4096, `SHA384withRSA`, PKCS12, alias `knoux-x-production-2026`, valid to 2059 |
| Keystore SHA-256 | `0d66ffb88f4bd30391a34a1825deea26b50acee1dc51f0d04e0dfb470273e448`; `D:` and `K:` copies byte-identical |
| CI acceptance certificate | `b671431a…8a49f`, `CN=Knoux X CI Release Verification, OU=CI` — a **different** identity, correctly labelled `TEST_SIGNED` / `productionSigned: false` |
| Play app signing (distribution) key | **UNKNOWN** — not assigned; depends on the owner's Option A/B decision |
| Secrets | 2 of 5 present in `android-production`: `KNOUX_ANDROID_KEY_ALIAS` and `KNOUX_ANDROID_CERT_SHA256` (both public, uploaded this session). The keystore blob and the two passwords are **still absent**, so every publishable run correctly fails closed. 0 repository-level secrets. |
| Password handling | never requested, never entered, never logged; the keystore was not opened — only the exported public certificate was read |
| Custody limit | recovery is DPAPI-protected on the owner's Windows account; if that account is lost the key is unrecoverable, and no rotation path exists before Play enrollment |

## E. Google Play

| Item | Status |
|---|---|
| Developer account | **UNKNOWN** — never confirmed; must not be inferred from the GitHub org |
| App entry for `dev.knoux.playerx` | **NOT-STARTED** |
| Play App Signing enrollment | **BLOCKED** on the owner's irreversible Option A/B choice |
| Internal / closed testing | **BLOCKED** |
| 12-testers / 14-days duty | **UNKNOWN** — applies only to personal accounts created after 2023-11-13; account type is unconfirmed, so no exemption may be assumed |
| Production rollout | **NOT AUTHORISED** — Gate G requires explicit owner approval of an exact AAB hash |

## F. Privacy and permissions

- `targetSdkVersion='36'` satisfies the **31 August 2026** API-36 rule, confirmed
  against the official target-API page. No downgrade was performed or needed.
- **16 KB pages: satisfied by evidence** — zero `lib/**/*.so` in the shipped
  APK. The script now measures this and would fail on misalignment if native
  code ever appears.
- 14 permissions mapped to real features; **`CAMERA` removed** as genuinely
  unused. `READ_MEDIA_VISUAL_USER_SELECTED` is real code, not decoration
  (`mediastore-members.java:25`).
- Privacy policy drafted in Arabic and English, grounded in the actual build,
  with 6 owner placeholders each. **Not hosted anywhere** — no domain was
  invented.
- Data Safety: no analytics, no crash SDK, no advertising SDK, no advertising
  ID, no account. Local media stays local; `allowBackup=false` in the shipped
  APK. Two real egresses: first-run MediaPipe model download from
  `storage.googleapis.com` and the GitHub release update check.
- **AI content safety: nothing to declare on Android** — the Android build
  returns zero providers and throws honestly. Three honesty defects found and
  reported (a false "Gemini was enabled" message, an unconditional
  `mock: true`, a hardcoded unverified model id).

## G. Tests

See the table in section C. Additional runtime evidence already on the record
from the passing acceptance run: 21 functional case ids, `installedAndLaunched:
true`, real `MediaProjection` consent text captured from `com.android.systemui`,
a 122 264-byte MP4 validated at 6.54 s before being reported.

## H. Deliverables

```
reports/google-play/
  00-repository-baseline.md
  01-signing-and-play-app-signing-decision.md
  02-aab-provenance-and-verification.json
  03-permissions-and-policy-matrix.md
  04-android-functional-matrix.md
  store-assets-validation.json
  final-google-play-readiness.md
docs/google-play/store-listing-en.md
docs/google-play/store-listing-ar.md
docs/legal/privacy-policy-en.md
docs/legal/privacy-policy-ar.md
store/google-play/icon/knoux-x-play-icon-512.png            (512x512, PNG, 80.5 KB)
store/google-play/feature-graphic/…-1024x500.jpg            (1024x500, JPEG, no alpha, 34.1 KB)
store/google-play/phone-screenshots/                        (20 files = 10 distinct surfaces, each as a native capture plus a 1:2 crop)
tools/verify-production-signing-identity.cjs
tools/build-google-play-store-assets.cjs
tests/unit/android-production-signing-gate.test.ts
tests/unit/android-manifest-permission-minimisation.test.ts
```

## I. Blockers

**Owner-only (cannot be delegated to an agent):**
1. Choose Play App Signing Option A or B — irreversible after first upload.
2. Upload the **remaining three** secrets to `android-production` — `KNOUX_ANDROID_KEYSTORE_BASE64`, `KNOUX_ANDROID_KEYSTORE_PASSWORD`, `KNOUX_ANDROID_KEY_PASSWORD` (exact commands in report 01). The alias and certificate pin are already set.
3. Resolve the environment branch policy vs tag/dispatch triggers.
4. Add a required reviewer to `android-production` (the mechanical form of Gate G).
5. Confirm the Play Console developer account exists, its type and verification status.
6. Provide a support email and a host for the privacy policy — neither was invented.
7. Decide the fate of `assets/branding/knoux-logo-night.png`, whose tagline
   renders as `"Sateiy is not a luxury, it's atife."`
8. Record the foreground-service demonstration video from a real device.

**Engineering-blocked (external dependency, not effort):**
- No Android SDK, `bundletool`, `aapt2`, `zipalign` or `apksigner` on this
  workstation → the first real AAB can only be produced on a CI runner.
- No physical Android device → the entire device matrix is `BLOCKED`.
- No AI credential in CI → no live AI call is proven anywhere.

**Process hazard needing your decision now:**
- A concurrent process moved this worktree onto
  `feat/corporate-identity-polish-20261027` (`d3808e4`, unpushed, branched from
  PR #88's head). My changes are uncommitted and sit on that branch. Committing
  here would mix Android signing work into another agent's in-progress
  corporate-identity PR; checking back out to PR #88's branch could disturb
  their active session. **No git write has been performed.**

## J. Production release decision

# `NO-GO`

Reasons, in order of severity:

1. **No production-signed artifact exists**, and none can until the owner
   uploads the secrets and chooses an App Signing option.
2. **No AAB has ever been built and verified end to end.** Reviewing the
   publishing lane as an execution path rather than as unit tests surfaced a
   **pre-existing structural defect**: the signing step of
   `knoux-live-release.yml` declared no `working-directory`, so it ran at the
   workspace root where `app/build/outputs/...` does not exist, and wrote
   `../release-android` outside the checkout while every later step reads
   `release-android/` at the root. **That job could never have completed.** It is
   now fixed, and it is still unexecuted — which is precisely why a green unit
   suite was not sufficient evidence.
3. **Zero physical device testing.** An emulator pass is not a device pass, and
   the emulator had no audio hardware — so audio output is literally unmeasured
   (`audioPeak: 0`).
4. **No export is proven on device** for video, audio or slideshow.
5. **The privacy policy is not published**, so the Data Safety and privacy
   declarations cannot be submitted truthfully.
6. **The Play Console account is unconfirmed**, including whether the closed-test
   requirement applies.
7. Foreground-service declarations and the required demonstration video do not
   exist.

**Also corrected in this pass, after review:** the AAB provenance record claimed
zero environment secrets; the true state is 2 of 5 (both non-secret). The privacy
policy stated the camera permission "is not requested"; the removal is implemented
in build tooling but the last analysed APK still declares it. The store package
described 20 screenshots; there are **10 distinct surfaces**, each emitted twice as
a native capture and a 1:2 crop, and all are **emulator** captures, not device ones.

**Nearest achievable milestone:** after owner items 1–3, run
`gh workflow run knoux-live-release.yml --ref main -f mode=draft` to produce and
cryptographically verify a real AAB without publishing anything. That converts
gate C from `BLOCKED` to `VERIFIED` and makes internal testing reachable.

Nothing was published, no version was bumped from `2.1.0`, no app was
uninstalled, no key was exported, and no irreversible Play arrangement was made.
