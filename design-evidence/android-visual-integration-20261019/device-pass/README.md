# Device pass — integrated source on the Android emulator

Head under test: `124a023ab1ccda8dc1861046a8370cc5978f9d8d` (branch `feat/knoux-x-integration-20261019`).

## Run 39311657153 — "Android Release Acceptance" — **PASS**

Release APK built, CI-signed, installed on the API 35 / Pixel 7 emulator, cold-launched.

| Item | Value |
| --- | --- |
| APK | `KNOUX-X-Android-release-ci-signed.apk` (43,987,450 bytes) |
| SHA-256 | `fc4322176d20fa17b1e79a6a5dfd2d8aeeeee542902c2c41654f599b4a509fc9` |
| Signing | `TEST_SIGNED` — CI acceptance certificate only, **not production-signed** |
| Signer | `CN=Knoux X CI Release Verification, OU=CI, O=Knoux X, L=Abu Dhabi, ST=Abu Dhabi, C=AE` (RSA 3072), APK Signature v2 + v3 verified |
| Identity | Knoux X 2.1.0 (versionCode 20100), package `dev.knoux.playerx` |
| Cold launch | `LaunchState: COLD`, `TotalTime: 3255 ms`, verdict PASS |

Viewport verification on the real emulator (the fixed harness; `android-viewport-report.txt`):

```
requested=360x800 applied=Override size: 360x800 density=160 png=360x800 settled=yes
requested=390x844 applied=Override size: 390x844 density=160 png=390x844 settled=yes
requested=412x915 applied=Override size: 412x915 density=160 png=412x915 settled=yes
```

Independent pixel check of the captured PNGs: `android-phone-360x800.png` = 360x800, `android-phone-390x844.png` = 390x844, `android-phone-412x915.png` = 412x915 — the stale-size capture bug (360 file holding a 1080x2400 frame) is gone.

`android-phone-360x800.png` is the first-run onboarding on-device: full-bleed to both edges, dark card legible, no Pearl right-edge strip — the `android-mobile.css` dialog-cap fix verified on the installed app, not just in Chromium.

`android-launch.png` shows the cold-launch transition: native Pearl splash window (light status bar, `#F8F7FC`) cross-fading into the themed in-app splash (white "Knoux X" ink, violet X) — both legible.

## Run 39311673504 — "Android APK (Capacitor)" real-workflows — **FAIL (emulator infrastructure)**

The installed-APK functional loop (`tools/android-real-workflows.cjs`) did not complete because the emulator died mid-run. Trusted-tap onboarding skip and the Home→SAF open were performed and verified first; the emulator then vanished during the system file-picker phase (h264 frame-decode spam at 19:39:36, `device 'emulator-5554' not found` from 19:41:25; `real-workflows-run-39311673504.json` records `diagnosticsAtExit`).

| Case | Status |
| --- | --- |
| `onboarding-skip` | `ANDROID_EMULATOR_VERIFIED` (trusted adb tap; correct WebView origin math, dpr 2.625) |
| `mp4-actual-player-first-frame-seek-audio` | `FAILED` — `No Android device/emulator visible to Playwright Android API` (device gone) |
| `photos-to-video-saf-persistence` | `BLOCKED_NO_LIVE_WEBVIEW_SESSION` |
| `native-recording-finalize-editor-handoff` | `BLOCKED_NO_LIVE_WEBVIEW_SESSION` |

This is the same signature as the pre-existing failures on the recovery head (runs 39205968095, 39204331679, 39203107074, 39202259463 — same `device 'emulator-5554' not found` exit, same case statuses). Playback / SAF persistence / recording handoff therefore remain **untested on this CI emulator** and are reported as such; a retry run (39315915167) was dispatched after this artifact set was captured.

## Honest gaps

- No touch-typing (no Android IME driving) — verbatim text entry untested.
- No audio assertions (`-noaudio` emulator).
- No MediaProjection consent-flow completion in CI; the recording handoff case is blocked with the rest.
- Production signing key is not available in CI; `TEST_SIGNED` only.
