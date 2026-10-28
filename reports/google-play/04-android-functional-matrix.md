# 04 — Android functional matrix

Traces each journey as **UI → action → bridge → service → result → verified
output**, and classifies it honestly. Evidence is the release-acceptance run on
the installed CI-signed APK (`real-workflows.json`, 21 functional case ids,
`installedAndLaunched: true`) plus source inspection at `03cb8db`.

Classifications: `VERIFIED` / `PARTIAL` / `IMPLEMENTED-NOT-VERIFIED` /
`BLOCKED` / `NOT-IMPLEMENTED`. A `BLOCKED` result is never reworded into a pass.

| Journey | Class | Strongest real evidence | What is missing |
|---|---|---|---|
| A. First launch & splash | **VERIFIED** | `startup-home-without-forced-onboarding`; `android-premium-splash.png`; bounded boot supervisor with a readable failure/retry panel (`index.html:263,323-333`); splash max-safety 4.8 s / min-hold 1.65 s (`MobileSplashOverlay.tsx:10-11,73-81`); logo is a **bundled** asset with a 3 s preload timeout, so an offline boot still dismounts (`BrandMark.tsx:9`) | Cold/warm start and reduced-motion are proven on one emulator profile only. No low-end or slow-network device run. |
| B. Media import | **VERIFIED** (core) | Native `KnouxSaf` plugin using `ACTION_OPEN_DOCUMENT` + `EXTRA_ALLOW_MULTIPLE` + `takePersistableUriPermission` (`prepare-android-functional-closure.cjs:61-66,126`); `photos-to-video-saf-persistence` survives `am force-stop`; `mediastore-selected-video-access` has `restartVerified: true`; `image-lab-saf-save-cancel-no-false-success` proves a cancelled picker writes nothing | Large-file import goes whole-file **base64** (`closure.cjs:152-161`, `androidSafBridge.ts:154`) with no memory ceiling test. Unsupported-codec behaviour has no case. |
| C. Playback | **PARTIAL** | `mp4-actual-player-first-frame-seek-audio`: real first frame decoded, trusted seek 10.7 s → 17.4 s; `KnouxMediaSessionPlugin` is real Java with a `mediaPlayback` foreground service, MediaSession and notification (`prepare-android-native-media.cjs:199-351`) | **Audio output was never proven.** The evidence records `audioPeak: 0` and `speaker: "BLOCKED_HARDWARE (emulator -noaudio: PCM mixer absent…)"` (`real-workflows.json:1563-1565`). No case for background survival, Bluetooth/headset, rotation, fullscreen, or resource cleanup. Background survival depends on `webView.resumeTimers()` in `onStop` (`:87-95`) — untested. |
| D. Video Studio | **PARTIAL** | `timeline-touch-scrub-split-and-save`: playhead moved, 1 clip → 2, `persistedClips: 2` | **No export file was ever produced on Android.** There is no MediaCodec and no ffmpeg on Android; export is a canvas replay through the WebView's `MediaRecorder` (`MobileExportView.tsx:84-93,271`, `mobileTimelineRenderer.ts:221-294`, provider `android-webview` in `platformCapabilities.ts:114`). Project "save" is localStorage behind a `knoux-android://…` path (`androidRuntimeBridge.ts:296-304`). |
| E. Image Studio / Retouch | **PARTIAL** | SAF import is real (`androidImageEditorBridge.ts:64-92`); undo/redo real (`AndroidBeautyExtension.tsx:719-773`); the photo-editor export is verified by save → reopen → decode → pixel probe (`MobileImageEditorView.tsx:531-551`); `image-lab-saf-import-transform-save-reopen` and `…-save-cancel-no-false-success` ran on the installed build | No Android functional case for the **retouch** pipeline specifically. Face/pose models are downloaded at first use and SHA-256 verified (`androidRetouchModels.ts:28-36,72-92`) → **first use requires internet**; never proven on a device. `importRetouchAsset` base is `async () => ({})` (`androidRuntimeBridge.ts:550`) — only saved by bridge install order, which is fragile and untested. |
| F. Audio Lab | **PARTIAL** | Real render path: `OfflineAudioContext` + lame MP3/WAV with bitstream validation and byte-count read-back (`androidAudioToolsBridge.ts:280-330`), 512 MB / 200 MB guards (`:45,204-214`); `audio-lab-catalog-and-merge-workspace` proves `engineReady` and navigation | No on-device case ever produced an audio file. **Microphone recording is NOT-IMPLEMENTED on Android** — confirmed: no `getUserMedia` in any audio path (only desktop `RecordingView.tsx` and screen capture). |
| G. Slideshow | **IMPLEMENTED-NOT-VERIFIED** | PR #87 (`d1184f0`, an ancestor of HEAD) adds `resolveSlideshowEncoding` MP4→WebM fallback with an explicit user warning (`androidSlideshowRenderBridge.ts:45-62`); verified in source: `WEBM_CANDIDATES = ['video/webm;codecs=vp9,opus', '…vp8,opus', 'video/webm']` at `:23`, extension chosen at `:320`; unit-tested (`tests/unit/slideshow-encoder-fallback.test.ts`); honest about memory (`:329-335`) and throws unless the byte count reads back (`:368-390`); GIF refused honestly (`:169`) | **No CI or device case ever rendered a slideshow output file.** `photos-to-video-saf-persistence` proves import only. The WebM would be genuinely playable (MediaRecorder VP8/VP9+Opus) but that is reasoning, not measurement. |
| H. Screen capture | **VERIFIED** (scoped) | `native-recording-finalize-editor-handoff`: the real system consent dialog text was captured from `com.android.systemui`; produced 122 264 bytes, `validMp4: true`, duration 6.54 s, 6 packets; service has `FOREGROUND_SERVICE_MEDIA_PROJECTION`, a stop action in the notification, `MediaProjection.Callback.onStop`, and validates duration/width **before** publishing (`closure.cjs:446-459,509-545`) | Emulator only. **Microphone track unproven** (see RECORD_AUDIO note). System-revocation mid-recording untested. Android 14 foreground-service exemption review not done. |
| I. Vault | **VERIFIED** | 7 of the 21 cases: `vault-encrypted-media-lifecycle`, `-identifier-membership-gate`, `-tamper-and-plaintext-containment`, `-corrupt-index-recovery`, `-delete-integrity`, `-pin-rotation-and-large-media`, `-plaintext-cache-survives-kill`. AES-GCM + PBKDF2 + AndroidKeyStore (`tools/android/knoux-vault-core.java:49-51`); `KNVX` container header asserted; wrong PIN refused; 8 membership attack vectors rejected; `allowBackup=false` **in the shipped APK** | No recovery path if the PIN is forgotten — the UI says so honestly (`MobileVaultView.tsx:489`). That is a real user consequence and a Data Safety answer, not a bug to hide. No real-device run. |
| J. AI features | **NOT-IMPLEMENTED on Android (honestly)** | Confirmed in source at `androidRuntimeBridge.ts:525,541,543,580`: `listProviders: async () => []`, and `createJob` / `retryJob` **throw** `"No Android image provider is configured, so this job was not created."` `knouxCreativeAPI.ai` is the web-preview stub that throws (`browserPreviewBridge.ts:346-353`) | Nothing to verify — the correct behaviour is the honest refusal. Desktop declares real providers (huggingface / fal / knoux-cloud / replicate / openrouter) plus a `mock` provider marked `liveVerification:'catalog-only'`, but **no AI credential exists in CI**, so no live AI call has been proven anywhere (`verify-ai-providers.cjs:71,189` self-reports `SKIPPED — set HUGGINGFACE_API_KEY`). |

## Mocks and false successes found

These matter because a store screenshot implies a working feature.

1. **`src/features/ai/AIAssistant.tsx:54`** prints *"Gemini was enabled…"*
   unconditionally after `configure()`, while the returned settings still say
   `provider: 'disabled'`. A false success on the desktop surface.
2. **`AIAssistant.tsx:18`** hardcodes model `gemini-3.6-flash`; no artifact
   verifies that model id exists.
3. **`src/core/image-studio/ai/offline.ts:77`** sets `mock: true`
   unconditionally, letting `router.ts:152-159` hand back a mock model with
   `requiresPaymentConfirmation: false`. The mock chunk ships inside the APK.
   Not reachable on Android (J above refuses all jobs), but it is present.
4. **`androidRuntimeBridge.ts:550-551`** stubs `importRetouchAsset → {}`;
   currently masked by bridge install order (`main.tsx:84-91`), not by a test.
5. `assets/public/assets/opencv/` contains **only a README** — the OpenCV WASM
   is absent, so `cv.ximgproc.guidedFilter` acceleration never runs and silently
   falls back to the TypeScript path.
6. A test-harness chunk `packaged-retouch-e2e-*.js` and a developer README ship
   inside the production `assets/public/` tree.

## Release-blocking for a Play submission

- **No production-signed artifact exists.** The only installable build is
  `TEST_SIGNED` with `productionSigned: false`. Production signing is now
  correctly *blocked* until the owner uploads the secrets and chooses an App
  Signing option.
- **No AAB has ever been produced by a lane that runs.** Fixed in code this
  pass (`assembleRelease bundleRelease`); the first real bundle is still to come.
- **`webContentsDebuggingEnabled: true` in the release APK** — deliberate for
  the acceptance lane so an installed WebView can be driven, and asserted to be
  `false` in production mode. It must never reach a Play channel.
- **No on-device proof of any export** (video, audio, slideshow) and **no proof
  of audio output**. The listing must not imply these.
- **No physical device has run this build at all.** See
  `device-test-results/README.md`.

## What may be advertised today

Only A, B, I and H (scoped), plus timeline *editing* (not export) and video
*playback* (not audio). Everything else in the table above must be described
with its actual boundary, or left out.
