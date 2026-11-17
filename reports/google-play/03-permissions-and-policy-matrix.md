# 03 — Permissions and Google Play policy matrix

Read from the **compiled** artifact, not a config file: `aapt2 dump badging`
output captured by the release-acceptance job for
`KNOUX-X-Android-release-ci-signed.apk` (43 715 578 bytes, commit `6ca5bf71…`,
the merge candidate of PR #88).

```
package: name='dev.knoux.playerx' versionCode='20100' versionName='2.1.0'
         platformBuildVersionCode='36' compileSdkVersion='36'
sdkVersion:'24'
targetSdkVersion:'36'
application-label:'KNOUX X'
```

Fourteen `uses-permission` entries were present. The directive's list of
"previously observed" permissions is confirmed accurate, with one exception
handled below.

| Permission | Feature that uses it | Runtime evidence | User-facing explanation | Play policy | Decision |
|---|---|---|---|---|---|
| `INTERNET` | First-run model download, in-app update check | `androidRetouchModels.ts` fetches from `storage.googleapis.com`; `ReleaseUpdatePanel` reads GitHub Releases | Network needed for model and update checks | Not sensitive | **Keep** |
| `POST_NOTIFICATIONS` | Media-playback and screen-recording foreground-service notifications | `prepare-android-native-media.cjs:363`; recording notification with a stop action | Android 13+ requires it to show the ongoing-recording and now-playing notifications | Normal | **Keep** |
| `FOREGROUND_SERVICE` | Both foreground services | declared with the two service types below | Required for any foreground service | Normal | **Keep** |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Background audio while the app is not in the foreground | `KnouxMediaSessionPlugin` — real Java service, `mediaPlayback` type, MediaSession + notification (`prepare-android-native-media.cjs:199-351`) | Now-playing continues while you use other apps | **FGS declaration required** | **Keep — needs Console declaration** |
| `FOREGROUND_SERVICE_MEDIA_PROJECTION` | Screen recording | `KnouxScreenCaptureService`, `foregroundServiceType="mediaProjection"`, `closure.cjs:446-545` | Records the screen you just consented to | **FGS declaration + demonstration video required** | **Keep — needs declaration and video** |
| `READ_MEDIA_IMAGES` | Media library discovery and organisation | CI `mediastore-library-organization`, `mediastore-discovered-library`; screenshots `library-org-*.png` | Browse your photos inside the app | **Photo/Video permission declaration required** | **Keep — justification below** |
| `READ_MEDIA_VIDEO` | Same, for video | CI `mediastore-selected-video-access`, `mp4-actual-player-first-frame-seek-audio` | Browse your videos inside the app | Same | **Keep — justification below** |
| `READ_MEDIA_AUDIO` | Music library | CI `mediastore-library-organization` | Browse your music inside the app | Declared, less restrictive | **Keep** |
| `READ_MEDIA_VISUAL_USER_SELECTED` | Android 14 partial photo access | `tools/android/mediastore-members.java:25` returns `"limited"` when this is granted on SDK ≥ 34; permission alias `selected` at `closure.cjs:567`; CI revokes and re-checks it at `android-real-workflows.cjs:2086` | Lets you share only the photos you pick | Encouraged by Google | **Keep — genuinely implemented** |
| `READ_EXTERNAL_STORAGE` `maxSdkVersion='32'` | Legacy read path on Android ≤ 12 | Same MediaStore code, gated by `sdk >= 33` at `android-real-workflows.cjs:2084` | Backwards compatibility only | Legacy, correctly bounded | **Keep** |
| `RECORD_AUDIO` | Microphone track **of screen recording** | `closure.cjs:312` and `:479` — checked only when the capture request sets `microphone: true` | "Record your screen with your voice" | Sensitive (microphone) | **Keep — narrow, real use** |
| `MODIFY_AUDIO_SETTINGS` | Playback routing/volume behaviour in the player | Present in compiled manifest | Adjusts audio output settings | Normal | **Keep** |
| `dev.knoux.playerx.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX-generated protection for internal broadcasts | Automatic from AndroidX `core` | None needed | Not a user-facing permission | **Keep (framework-generated)** |
| ~~`CAMERA`~~ | **Nothing** | No `getUserMedia({video})`, no `ACTION_IMAGE_CAPTURE`, no project script declares it — it came from the Capacitor template | — | Sensitive; an unused camera permission invites rejection | **REMOVED in this pass** |

## Camera removal

`tools/harden-android-manifest.cjs` now rewrites the template's camera
declaration to `tools:node="remove"`, which is what the manifest merger needs —
deleting the line is not enough because a library re-adds it. The transform is
idempotent and is covered by
`tests/unit/android-manifest-permission-minimisation.test.ts` (9 tests).

The `DCIM/Camera` folder visible in `library-org-camera.png` is a *directory
name* being read through MediaStore, not camera capture.

## Broad media access: the justification Play will ask for

Play requires a declaration for `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`, and
will ask why the system photo picker is not enough. The honest answer, and the
one to submit:

KNOUX X is a media **library** application. It organises the device's existing
MediaStore content into collections, favourites, recents and folder views
(proven by `mediastore-library-organization` and the `library-org-*` captures),
and plays files the user did not select in a single picker session. The photo
picker returns an ephemeral grant for the items chosen in that one interaction;
it cannot back a persistent library view that survives process restart, which is
what this app's core surface is.

Counter-consideration to record honestly: the app **also** implements SAF
`ACTION_OPEN_DOCUMENT` with persistable URI grants (`KnouxSafPlugin`,
`closure.cjs:61-66`), proven by `photos-to-video-saf-persistence`. A picker-only
design is therefore technically feasible for *import*. The broad permission is
justified by the library-browsing feature specifically, not by import. If Play
rejects the declaration, the library view must be rebuilt on
`READ_MEDIA_VISUAL_USER_SELECTED` + SAF persistence — that is the fallback, and
it is a real product change, not a settings tweak.

## Foreground-service declarations to prepare

Both need a Console declaration; `mediaProjection` additionally needs a
**demonstration video**.

| Service type | Justification | Start | Stop | Notification | Evidence |
|---|---|---|---|---|---|
| `mediaPlayback` | Continue audio playback while the app is backgrounded | User presses play | Pause / close / media button | Ongoing now-playing with MediaSession controls | `prepare-android-native-media.cjs:199-351` |
| `mediaProjection` | Record the screen the user just consented to | User-initiated, after the system consent dialog | Explicit stop action in the notification; `MediaProjection.Callback.onStop` | Ongoing, with stop control | CI `native-recording-finalize-editor-handoff` — real consent text captured from `com.android.systemui`, 122 264-byte MP4, 6.54 s, validated before publishing |

**Gap:** no demonstration video exists yet. It must be recorded from a real
device, not synthesised. See `06-play-console-privacy-declarations.md`.

## Behaviour still unverified against these permissions

- `RECORD_AUDIO` is only reached when a capture request asks for a microphone
  track. The CI recording case ran on an emulator **without** audio hardware, so
  the mic path is `IMPLEMENTED-NOT-VERIFIED`. Do not claim "record screen with
  audio" in the listing until it is proven on a device.
- Permission **denial** and mid-session **revocation** are partially covered
  (`mediastore-revoked.png`, `vault-*` gates). Camera denial no longer applies.
  Runtime-permission denial for microphone has no case.
- Background playback survival depends on `webView.resumeTimers()` in `onStop`
  (`prepare-android-native-media.cjs:87-95`) and has **no** CI case.

## Target API and 16 KB memory pages

- `targetSdkVersion='36'`, `compileSdkVersion='36'`, build-tools `36.0.0`.
  Google Play requires API 36 for new apps and updates from **31 August 2026**
  (confirmed against the official target-API page on 27 October 2026). **This
  requirement is met.** No downgrade was performed or needed.
- **16 KB pages: satisfied by construction, with evidence.** The APK contains
  **zero** `lib/**/*.so` entries (`unzip -l` over the shipped artifact;
  `apkNativeLibraries: 0`). There is no native code to align, so no tooling
  change was introduced. The release script now measures this instead of
  assuming: if any `.so` ever appears, it runs
  `zipalign -c -P 16 -v 4` and **fails the build** on misalignment.
- The heavy media code is WebAssembly (`assets/public/mediapipe/vision_wasm_*.wasm`),
  which runs in the WebView and is not subject to the ELF alignment rule.
- Android 15/16 behaviour changes still to be walked on a real API 36 device:
  edge-to-edge insets, predictive back, gesture navigation, notification and
  media-permission timing. The hardware-back policy is implemented and CI-tested
  (`hardware-back-drawer-and-navigation`, `hardware-back-root-exit`).
