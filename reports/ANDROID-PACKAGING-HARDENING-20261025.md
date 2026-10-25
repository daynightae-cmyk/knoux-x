# KNOUX X — Android packaging & boot hardening (2026-10-25)

Triggered by a real device report: the installed release build stopped on a purple
spinner, plus three packaging findings about WebView debugging, `allowBackup`, and
source maps inside the APK. Everything below is fixed, gated, and verified; nothing is
claimed from inspection alone.

## 1) The endless spinner on the device

**Evidence.** The screenshot shows the pre-React loader (`#initial-loading` +
`.loading-spinner` from `index.html`), not the branded React splash. The packaged
`index.html` in the delivered APK loads Inter from `fonts.googleapis.com` through a
plain render-blocking `<link rel="stylesheet">` placed **before** the module entry:

- a stylesheet blocks the scripts that follow it, and a module script is deferred,
  so `DOMContentLoaded` waits behind it as well;
- on a network that cannot reach `fonts.googleapis.com` (blocked, throttled, or
  captive), the module never runs and the inline handler that hides the loader never
  fires — the spinner turns forever with no message, no error, no way out.

The emulator used by CI has direct internet, which is exactly why its acceptance run
reached Home (`android-launch.png` shows the full Dashboard) while the phone did not.

**Fix (commit `6818766`).**
- The font stylesheet is loaded as `media="print"` then promoted on `load`, with a
  `<noscript>` fallback. Typography is preserved when the network cooperates and the
  stylesheet can no longer block the app when it does not.
- A boot supervisor replaces "hide on `DOMContentLoaded`": it hides the loader when
  `#root` actually mounts (polled), records the first `error` /
  `unhandledrejection`, and after **12 s** shows a readable panel (EN + AR) with the
  failure code (`BOOT_TIMEOUT` / `BOOT_SCRIPT_ERROR`) and a **Retry** button that
  reloads the surface. Files are never touched by a retry.
- Verified in the packaged output: a renderer build keeps `BOOT_TIMEOUT_MS` and the
  non-blocking font in `dist/index.html` (and the Android assets are a copy of it).

**Honest limit.** The exact network condition on the device is inferred from the
packaged HTML, not captured from the phone (no adb on that machine). If the app still
fails there, it will now say **why** (`BOOT_SCRIPT_ERROR — <message>` or
`BOOT_TIMEOUT`) instead of spinning, which turns the next report into a diagnosis.

## 2) `webContentsDebuggingEnabled: true` inside the packaged Capacitor config

**Why it was true.** `tools/configure-android-webview-debugging.cjs` enables it for
`debug` and `acceptance` modes, because the installed acceptance step attaches to the
WebView over `webview_devtools_remote`. The delivered APK was an **acceptance** build.
The real defect was in the publishing lane: `knoux-live-release.yml` never set the
mode at all and relied on a Capacitor default.

**Fix.** The publish lane now runs `configure-android-webview-debugging.cjs android
production` before Gradle and refuses to build if any `.map` is present.
`tools/verify-android-apk.cjs` now reads `assets/capacitor.config.json` from the APK
and fails when the flag does not match the expected mode
(`KNOUX_ANDROID_EXPECT_WEBVIEW_DEBUG`), with the publish lane setting `off`. The
acceptance lane keeps `on` and says so in its own evidence.

## 3) `android:allowBackup="true"`

**Why it was true.** The Android project is generated per build (`npx cap add
android`), so the attribute came from the Capacitor template on every run.

**Fix.** New idempotent `tools/harden-android-manifest.cjs` pins
`android:allowBackup="false"` and removes the now-dead `fullBackupContent` /
`dataExtractionRules` references. It runs in **every** lane that can produce an APK
(debug, release acceptance, publish), the release script refuses to continue if the
attribute is not false, and the packaged verifier reads the **compiled** manifest and
fails otherwise.

**Why disable rather than curate.** Keystore key material that decrypts Vault entries
is never included in Android backups, so a restored backup would contain projects and
metadata without the ability to decrypt the vault — a half-restore that looks like
data loss. KNOUX X is local-first; moving data is done through its own export paths.

## 4) 138 source maps with `sourcesContent` inside the APK

**Why.** `vite.renderer.config.ts`, `vite.main.config.ts` and
`vite.preload.config.ts` all set `sourcemap: true` unconditionally, so every renderer
chunk shipped a `.map`, many with full original sources.

**Fix.** Source maps are opt-in via `KNOUX_SOURCEMAPS=1` for local debugging only.
Measured with real builds: **default 0 `.map`; `KNOUX_SOURCEMAPS=1` → 138** (the exact
count found in the APK, which confirms these were the renderer maps). The release
script refuses to package any `.map`, and the packaged verifier fails on a single one.

## Gates added (and where they run)

| Gate | Implementation | Runs in |
| --- | --- | --- |
| Zero source maps in the APK | `tools/verify-android-apk.cjs` | every lane that verifies an APK |
| `allowBackup=false` in the compiled manifest | same verifier, read from `aapt dump xmltree` | same |
| WebView debugging matches the build mode | same verifier, from the packaged Capacitor config | same, with `KNOUX_ANDROID_EXPECT_WEBVIEW_DEBUG` |
| Manifest hardened before Gradle | `tools/harden-android-manifest.cjs` + `grep` assertion | debug, acceptance, publish |
| No `.map` reaches the package | release script + publish lane `find` check | acceptance, publish |
| Boot surface exists and cannot be blocked by a remote stylesheet | `tests/unit/boot-resilience.test.ts` (4 cases) | Node 20 CI + local |
| All of the above contracts | `tests/unit/android-packaging-hardening.test.ts` (10 cases) | same |

PR [#83](https://github.com/daynightae-cmyk/knoux-x/pull/83) merged as `29b70f4e`
after **every** lane passed, including the two Android lanes (26m each) which executed
the new gates against a signed APK.

## What the next artifact is — and is not

- It contains the boot supervisor, 0 source maps, and `allowBackup=false`.
- It is still **acceptance**-signed (`TEST_SIGNED`, `productionSigned=false`, WebView
  debugging **on** for the attach step). A production-signed APK requires
  `KNOUX_ANDROID_KEYSTORE` + password/alias/key, which this repository does not have;
  when that secret exists, the publish lane will produce it with debugging forced off
  and all four gates enforced.
