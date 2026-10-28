# 01 — Signing remediation and the Google Play App Signing decision

Two separate things, deliberately kept apart: what was **fixed in code** (done,
testable, no owner input needed) and what only the **owner can decide** before
the first upload (open, and it is irreversible).

---

## Part A — what was fixed

### The shared contract

`tools/verify-production-signing-identity.cjs` is now the single authority for
"is this keystore the pinned production identity". Both lanes call it. It exists
because the acceptance script and the live-release workflow each grew their own
signing code, and fixing one left the other exposed.

It reads passwords **by environment-variable name only** — never as a command
argument, so they cannot appear in a process listing — and never writes them to
evidence. The certificate is exported as DER and parsed with
`crypto.X509Certificate`, so no claim depends on locale-formatted `keytool` text.

It fails closed with a machine-readable reason for each of:
`PIN_MISSING`, `PIN_MALFORMED`, `KEYSTORE_MISSING`, `KEYSTORE_EMPTY`,
`STORE_PASSWORD_INCORRECT`, `KEYSTORE_UNREADABLE`, `ALIAS_MISSING`,
`ALIAS_NOT_PRIVATE_KEY`, `CERTIFICATE_UNEXPORTABLE`, `CERTIFICATE_UNPARSABLE`,
`CERTIFICATE_EXPIRED`, `CERTIFICATE_NOT_YET_VALID`, `CI_IDENTITY_REJECTED`,
`FINGERPRINT_MISMATCH`, `KEY_PASSWORD_MISSING`,
`KEY_PASSWORD_DIFFERS_FROM_STORE_PASSWORD`, `USAGE`.

A pin must be exactly 64 hex digits after normalisation. A one-character pin is
`PIN_MALFORMED`, not a match.

### Defect-by-defect

| # | Defect | Resolution |
|---|---|---|
| A | Pin optional → production signed with any keystore | `KNOUX_ANDROID_CERT_SHA256` is now **mandatory** in production mode; the run aborts before Gradle. The shipped bytes are re-checked against the pin after signing, for APK *and* AAB. |
| B | Independent signing implementation | Both lanes now call the shared gate. `knoux-live-release.yml` previously had **zero** pin logic; it now has the same contract plus a post-signature check. |
| C | Silent CI fallback during publishing | Removed for publishable runs. A tag push or `mode=publish` with an incomplete secret set stops with `PRODUCTION_SECRETS_INCOMPLETE`. A CI key remains available **only** for `mode=draft`, and the publish job independently refuses to make anything public unless `android.signing == production` **and** a verified certificate fingerprint was recorded. |
| D | Secrets in process arguments | `apksigner --ks-pass env:…`, `jarsigner -storepass:env …`, `keytool -storepass:env …`. No `pass:` literal survives in either lane. |
| E | Artifact identity | `android-release-acceptance.json` now carries `sourceSha`, `versionName`, `versionCode`, `certificateSha256`, `bundleCertificateSha256`, `keystoreType`, `apkSha256`, `aabSha256`, byte sizes, native-library counts and the alignment verdict. |

Also fixed: two competing pin variable names collapsed to one; the dead
`apksigner verify`-on-a-keystore block deleted; the store type is now explicit
(`PKCS12` for production — previously the `.p12` was written to a file named
`.jks` with no store type, which risked a silent load failure into the CI
branch); `verify-apk-signing-block.cjs` rejects prefix pins and requires **every**
signer certificate to equal the pin; the acceptance lane now builds
`assembleRelease bundleRelease` so a bundle exists on every run, and the two
artifacts are cross-checked for one signer identity.

### A finding worth stating plainly

PKCS12 **cannot carry a separate key password** — the JDK prints
`Different store and key passwords not supported for PKCS12 KeyStores. Ignoring
user-specified -keypass value.` and discards it. So the directive's "wrong key
password" case is not testable as an unwrapping failure against the owner's
store; the real failure mode is a `KNOUX_ANDROID_KEY_PASSWORD` that differs from
the store password and breaks `apksigner` late and opaquely. The gate now
detects exactly that and names it. Any implementation that claimed to verify
independent PKCS12 key unwrapping would have been theatre.

### Negative tests

`tests/unit/android-production-signing-gate.test.ts` — 29 tests, all passing,
executing real `keytool` against throwaway keystores and executing the real
shell script against stubbed `gradlew`/`apksigner` to prove the build is never
reached. Coverage against the directive's eleven cases:

| Required rejection | Covered | Mechanism |
|---|---|---|
| No keystore | yes | `KEYSTORE_MISSING` + script aborts before Gradle |
| Wrong keystore | yes | `FINGERPRINT_MISMATCH` against a second valid RSA-4096 store |
| Wrong password | yes | `STORE_PASSWORD_INCORRECT` |
| Wrong alias | yes | `ALIAS_MISSING`, and `ALIAS_NOT_PRIVATE_KEY` for a cert-only alias |
| Missing certificate pin | yes | `PIN_MISSING` + script aborts before Gradle |
| Incorrect certificate pin | yes | `FINGERPRINT_MISMATCH` |
| Malformed certificate pin | yes | four variants incl. 63-char and 1-char |
| APK and AAB signed by different identities | yes (code) | script compares both signer digests and aborts |
| CI build labelled production | yes | `CI_IDENTITY_REJECTED` fires **even when the CI key's own fingerprint is correctly pinned** |
| Publish with incomplete secrets | yes (workflow) | `PRODUCTION_SECRETS_INCOMPLETE` + publish-job assertion |
| Debug-enabled / source-map production build | pre-existing gates retained | WebView-debug assertion, `.map` refusal |

The last two rows are enforced at the workflow level rather than by a local unit
test; they cannot be exercised here without a runner and a real secret set, and
that is stated rather than papered over.

### Still not done, on purpose

The five secrets are **not uploaded**. The store password is owner-held behind
DPAPI and the directive forbids asking for it in chat. `gh secret set` would
also put the value in a shell argument. The owner-only commands are in Part C.

---

## Part B — the Google Play App Signing decision (OWNER, irreversible)

Google separates the **upload key** (authenticates the AAB you submit) from the
**app signing key** (signs the APKs Play actually delivers). KNOUX X has a
newly created, owner-managed key and no prior Play publication, so both options
below are genuinely open. This choice must be made **before the first upload**;
after enrollment, changing the app signing key requires Google support and a
reset that breaks update continuity.

### Option A — Google-managed app signing key, `.p12` becomes the upload key

- Google generates and holds the distribution key in its infrastructure.
- `knoux-x-android-production-2026.p12` is enrolled as the **upload key only**.
- Two fingerprints must then be tracked separately and never conflated:
  - upload: `695ef97d…2fd6cd` (verified above)
  - distribution: assigned by Google at enrollment, currently **unknown**
- Consequences for this repository: the certificate pin used for *publication*
  verification is the **upload** pin (what we sign the AAB with), while any
  claim about the certificate on a user's device must use the **distribution**
  pin read back from Play Console after enrollment. The acceptance lane keeps
  its own separate test identity and must never be pinned as either.
- Loss of the upload key is recoverable: rotate the upload key in Console, keep
  updating existing installs.
- Direct-distribution APKs (the Windows app's in-app Android update path) would
  carry a **different** signature from Play builds, so a device cannot migrate
  from a sideloaded build to a Play build without uninstalling.

### Option B — keep the owner key as the app signing key

- The owner's key signs what users install; direct APK and Play builds stay
  compatible and can update each other.
- Enrollment requires exporting the **private** key to Google through their
  supported transfer, or providing an externally-managed key path.
- Custody risk is permanent: if this keystore is lost and Play's copy is
  unavailable, the app can never be updated again for existing users.
- Rotation is materially harder and needs Google support.

### Recommendation

**Option A**, unless cross-channel update continuity between sideloaded builds
and Play builds is a product requirement. It is the lower-custody-risk choice
for a first publication, it matches how the pipeline is already built (we sign
an upload artifact and pin its certificate), and an upload-key loss is
self-service recoverable.

Nothing was enrolled, no key was exported, and no private key material left
`D:\KNOUX-Private-Signing`.

### One prerequisite the owner should know before choosing

Pre-existing CI-signed test APKs on any device carry
`b671431a…8a49f`. **Neither** option lets those installs upgrade to a Play
signature — the signature differs, so Android refuses the update. Any device
holding a CI-signed build needs uninstall-and-reinstall, which destroys its
local Vault. Vault data must be exported first. See
`07-versioning-and-update-safety.md`.

---

## Part C — owner-only actions, in order

Nothing here can be completed by an agent without either the private password
or Play Console access.

1. **Decide Option A or B** (Part B). Irreversible after the first upload.
2. **Upload the five secrets to the `android-production` environment.** Run
   locally so no value transits a chat window. On Windows PowerShell, `Read-Host
   -AsSecureString` is not enough for `gh`; use the file form so the value never
   lands in a shell argument either:

   ```powershell
   # From D:\KNOUX-Private-Signing, in a console on the owner's account.
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("knoux-x-android-production-2026.p12")) |
     Set-Content -NoNewline "$env:TEMP\ks.b64"

   gh secret set KNOUX_ANDROID_KEYSTORE_BASE64 --env android-production --bodyFile "$env:TEMP\ks.b64"
   gh secret set KNOUX_ANDROID_KEYSTORE_PASSWORD --env android-production --body (Read-Host "keystore password" -AsSecureString | ConvertFrom-SecureString ...)  # or paste at the prompt
   gh secret set KNOUX_ANDROID_KEY_ALIAS --env android-production --body "knoux-x-production-2026"
   gh secret set KNOUX_ANDROID_KEY_PASSWORD --env android-production   # prompt mode; must EQUAL the store password (PKCS12)
   gh secret set KNOUX_ANDROID_CERT_SHA256 --env android-production --body "695ef97df906e91ce5e06d809b1303fdb0a209b9f79e7c3b3b98e34ea22fd6cd"
   Remove-Item "$env:TEMP\ks.b64"
   ```

   `gh secret set` with no `--body` reads from the terminal prompt, which is the
   preferred path for the two passwords. The last two values above are not
   secrets — the alias and the public fingerprint are already recorded in
   `00-repository-baseline.md` — so those three commands can be run as-is.
3. **Understand the environment branch policy — it is narrower than first
   recorded.** `android-production` uses `protected_branches: true`, and `main`
   **is** protected (three required contexts, `strict: true`). So a
   `workflow_dispatch` run against `main` satisfies the policy and can read the
   environment secrets. A **tag push** is the case that does not match a branch
   policy, so publishing by tag may not see the secrets at all.

   Correction to the earlier draft of this file, which said the policy "can
   prevent the release job from ever seeing the environment secrets": that is
   true for tag-triggered runs, not for dispatch from `main`. The practical
   consequence is that `mode=verify` should be run as
   `gh workflow run knoux-live-release.yml --ref main -f mode=verify`, and that
   if tag publication is wanted later, custom branch/tag policies must be added
   first. Either way the run now **fails loudly** rather than falling back to a
   CI key.
4. **Add a required reviewer to `android-production`** (Console → Settings →
   Environments → `android-production` → Deployment protection rules). This is
   the mechanical form of Gate G: no human approval, no production signing.
5. **Confirm the Play Console developer account exists and its type** — see
   `08-play-console-readiness.md`.
6. **Brand decision**: `assets/branding/knoux-logo-night.png` renders the
   corporate tagline as `"Sateiy is not a luxury, it's atife."` — corrupted
   lettering. The store icon and feature graphic therefore use
   `knoux-logo-master.png`. Either fix the night master or retire it.
