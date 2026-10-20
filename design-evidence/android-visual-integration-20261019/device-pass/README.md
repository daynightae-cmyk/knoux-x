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

## Run 39311673504 — "Android APK (Capacitor)" real-workflows — **FAIL (device loss mid-run)**

The installed-APK functional loop (`tools/android-real-workflows.cjs`) did not complete because the emulator died mid-run. Trusted-tap onboarding skip and the Home→SAF open were performed and verified first; the emulator then vanished during the system file-picker phase (h264 frame-decode spam at 19:39:36, `device 'emulator-5554' not found` from 19:41:25; `real-workflows-run-39311673504.json` records `diagnosticsAtExit`).

| Case | Status |
| --- | --- |
| `onboarding-skip` | `ANDROID_EMULATOR_VERIFIED` (trusted adb tap; correct WebView origin math, dpr 2.625) |
| `mp4-actual-player-first-frame-seek-audio` | `FAILED` — `No Android device/emulator visible to Playwright Android API` (device gone) |
| `photos-to-video-saf-persistence` | `BLOCKED_NO_LIVE_WEBVIEW_SESSION` |
| `native-recording-finalize-editor-handoff` | `BLOCKED_NO_LIVE_WEBVIEW_SESSION` |

This is the same signature as the pre-existing failures on the recovery head (runs 39205968095, 39204331679, 39203107074, 39202259463 — same `device 'emulator-5554' not found` exit, same case statuses). Playback / SAF persistence / recording handoff therefore remain **untested on this CI emulator** and are reported as such.

## Retry run 39315915167 — **FAIL (same external device-loss, progressed further)**

`real-workflows-run-39315915167.json` records this attempt. What the harness actually accomplished before the device vanished:

| Step | Result |
| --- | --- |
| `onboarding-skip` | `ANDROID_EMULATOR_VERIFIED` — trusted adb tap (308,1615), Home reachable |
| SAF walk | `home:open-video` → `saf:show-roots` (attempt 1) → `saf:downloads-root` (attempt 1) → `saf:file` (attempt 2) — the full state-driven chooser walk succeeded |
| Playback | `player:play` and `player:reveal-controls-for-scrub` taps issued through the OS input pipeline |
| Subsequent loss | `locator.evaluate: Target page, context or browser has been closed` — the post-chooser renderer-death signature already recorded on runs 39188659686 / 39196654875 — then adb transport loss: `device 'emulator-5554' not found`, surviving 5 bounded recovery attempts |
| Cases | `mp4...` → `BLOCKED_NO_ADB_DEVICE` (bounded recovery exhausted, no tap behind a dead session); `photos-to-video-saf-persistence` and `native-recording-finalize-editor-handoff` → `BLOCKED_NO_LIVE_WEBVIEW_SESSION` |
| Measurement | chooser-to-decoded-frame 36,960 ms (N=1, includes the native chooser; not a performance claim) |

## Functional acceptance status — proven on an ancestor build, not re-provable on this emulator

The full installed-APK functional loop **is green on PR head `a3ee6d8`** (an ancestor of this branch), run [39195490261](https://github.com/daynightae-cmyk/knoux-x/actions/runs/39195490261): 3/3 scoped cases `ANDROID_EMULATOR_VERIFIED` with `syntheticEventsUsed=false` and zero touch fallbacks — playback decoded 65 frames / 130 distinct colors with the real document title `KNOUX-QA.mp4`; recording produced a real 161,785-byte h264 MP4 (7 packets, 6.517 s) and opened it in the timeline editor; onboarding skip via trusted tap. The committed acceptance record is `release-closure-artifacts/PHASE-04-20261019-0000/03-REAL-ANDROID-ACCEPTANCE.json`.

After that green run, every attempt on this CI emulator (recovery head runs 39203107074 / 39204331679 / 39205968095, and this head's 39311673504 / 39315915167) ended the same way: the WebView renderer session died right after the system file chooser returned (`Target page, context or browser has been closed`), after which the emulator became unreachable (`device 'emulator-5554' not found`) despite bounded recovery attempts. Doubling emulator cores/RAM did not prevent it, so the loss is **not** a resource-margin problem. What is established is the *sequence* (renderer session death, then transport loss); what is **not** established is the cause of the renderer death — it is not attributed to the app, to the emulator host, or to the runner, and no infrastructure-only root cause is claimed. The integrated head's own re-run is therefore reported as blocked by that device-loss sequence — not as a pass, and not as an app regression. DEF-16 (trusted timeline touch scrub) and DEF-17 (photos-to-video SAF persistence) remain **unit-verified, device-pending** for the same reason.

## Honest gaps

- No touch-typing (no Android IME driving) — verbatim text entry untested.
- No audio assertions (`-noaudio` emulator) — `BLOCKED_HARDWARE`; audio-track presence and advancing position are the verifiable claims.
- No MediaProjection consent-flow completion in CI; the recording handoff case is blocked with the rest (the flow itself is covered by the green ancestor run).
- Production signing key is not available in CI; `TEST_SIGNED` only.
- Timeline touch-scrub and photo-to-video SAF persistence on the integrated head: device-pending (DEF-16/DEF-17).
- Windows interactive recording acceptance is **not covered**: the CI job for it is an echo-only step and the committed `reports/recording-real-e2e/evidence.json` is a stale 2026-09-10 file stating `NOT_TESTED`; desktopCapturer needs an interactive desktop session (evidence in `../windows/`).
