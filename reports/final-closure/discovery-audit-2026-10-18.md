# KNOUX X - Final Discovery Audit (2026-10-18)

Branch: `feat/knoux-x-final-release-closure` (product code identical to merged main `db0160b`).
Method: read-only audit of `src/**`, `electron/**`, Android integration; markers TODO/FIXME/not implemented/coming soon/placeholder/stub/mock; caller tracing against `electron/preload.ts`, `electron/preload-creative.ts`.
Reviewer notes: findings verified by the closure owner; corrections and statuses are marked **[verified]** / **[corrected]** / **[documented]**.

## A. Desktop renderer / main-process findings

| path:line | finding | status |
|---|---|---|
| `electron/ai-gateway/knoux-cloud-video-adapter.ts:11-14` | KNOUX Cloud video adapter self-declared "STATUS: CODE VERIFIED / LIVE UNKNOWN"; `/v1/video-jobs` and `/v1/health` are architectural placeholders pending real backend verification | **[verified] BLOCKED_EXTERNAL** - code is defensive and truthful (needs a real gateway to prove live); provider stays selectable by design, `probe()` reports unverified/unreachable |
| `electron/ipc/setup.ts:201-253` + `src/core/services/player/PlayerService.ts` | `knouxAPI.player.*` IPC handlers; renderer's shipped player uses `knouxCreativeAPI`/`library` paths instead; zero renderer callers | **[verified] dead IPC surface, documented** - not user-visible; removal deferred to a dedicated PR (no destructive churn in closure) |
| `electron/ipc/setup.ts:339-375` + `SubtitleEngine.ts` | `knouxAPI.subtitle.*`: online search returns `[]`, download `''`, sync/translate no-ops ("intentionally deferred"); zero renderer callers | **[verified] documented** - subtitles in the shipped player are handled elsewhere; online subtitle features are not advertised in UI |
| `electron/ipc/setup.ts:558-573` + `GeminiService.ts` | `knouxAPI.ai.*` IPC dead (0 callers); chat returns "not configured" string; AI UI runs through `knouxCreativeAPI.ai` | **[verified] documented** |
| `electron/ipc/setup.ts:259-333, 381-422` + `AudioEngine.ts` / `VideoEngine.ts` | main-process `audio.*`, `video.*`, `library.*` IPC: 0 renderer callers (renderer uses creative/library APIs) | **[verified] documented** |
| `src/features/editor/EditorView.tsx` (821 lines) | legacy editor view; no static or dynamic import anywhere (grep `features/editor`, `EditorView` import: 0) | **[verified] dead module, documented** |
| `src/App.tsx:98-101,163` + `DesktopVideoStudioView.tsx` | audit claimed "never rendered" | **[corrected] NOT a finding**: `case 'editor': return android ? <MobileVideoStudioView/> : <VideoStudioView/>` renders `DesktopVideoStudioView`; the packaged video-studio gate navigates this route successfully |
| `src/core/services/ai/OpenRouterService.ts:26,300` | exported via barrel only; `openrouter` provider catalog entry `wired:false` for image/video | **[verified] documented** - provider intentionally not enabled |
| `electron/library/organization-service.ts:48`, `electron/menu/system-tray.ts:15`, `RetouchWorkspace.tsx:85` | zero imports; dead modules | **[verified] documented** |
| `src/core/orchestrator/SystemOrchestrator.ts:379-385` | `initializeWorkerPool` empty loop | **[verified] documented** (no worker offload implemented; no user-visible promise found) |
| `src/features/{playlists,subtitles,updater,plugins,diagnostics}/.gitkeep` | empty feature directories | **[verified] documented** |
| `electron/ipc/channel-source-inventory.ts:19,34,114-129` | reserved channels with no emitters (`ai:stream`, `player:ended/error/state-change/time-update`, `audio:visualizer-data`) | **[verified] documented** |

## B. Android lane

Context (verified): the `android/` project is CI-generated - the workflow installs pinned `@capacitor/{core,cli,android}` tooling with `--no-save`, generates the project (`cap add/sync`), injects native plugins (KnouxSaf, KnouxScreenCapture), builds and signs a release APK, and runs the KVM emulator install-launch-render smoke.

| path:line | finding | status |
|---|---|---|
| `src/platform/androidRuntimeBridge.ts:553-565, 507-519` | Android video-studio AI (`knouxVideoStudioAPI` createJob fake) and image-studio provider APIs stubbed | **[verified] documented** - desktop-only routes render these surfaces; mobile routes (MobileVideoStudioView etc.) do not advertise AI jobs |
| `src/platform/browserPreviewBridge.ts:255-258` | AI chat throws "AI remains disabled in web preview." | **[verified] documented** - by design for preview; the AI entry exists on the desktop Sidebar only |
| `src/platform/androidAudioToolsBridge.ts:190-191` | non-WAV export throws "supports WAV" | **[verified] documented** - Android audio export supports WAV only |
| `src/platform/platformCapabilities.ts:130` | `gifExport` unsupported on android-webview | **[verified] documented** |
| `src/platform/androidRuntimeBridge.ts:490,495,504,537-541` | fake-true adjustments/checkpoints, empty recovery sessions, leftover recording API | **[verified] documented** - consumed only by desktop-routed views or unused |
| `src/**` | no Capacitor `backButton` listener (grep count 0) | **[verified] `ANDROID_BACK_BUTTON_UNWIRED`, documented** - hardware back exits the app instead of navigating views; a fix needs `@capacitor/app` (not a package.json dependency; installed CI-side only) and a device-level verification we cannot run locally, so it is out of scope for this closure PR |
| `src/features/slideshow/MobileSlideshowEditor.tsx:310` | stale "MP4 slideshow rendering is not implemented" error branch (androidSlideshowRenderBridge handles mp4/webm first) | **[verified] documented** |
| `src/platform/androidSafBridge.ts:115-116` + `MobileMediaLibraryView.tsx:107` | library requires the KnouxSaf plugin (content:// SAF flow); absent only in non-CI preview builds | **[verified] by design** - the CI APK injects the plugin and the emulator smoke exercises launch/render |

## C. Highest-risk items (with closure disposition)

1. KNOUX Cloud AI video live behavior - **BLOCKED_EXTERNAL** (backend not reachable from this environment; adapter keeps truthful `LIVE UNKNOWN` probe status).
2. Dead main-process IPC surfaces (player/subtitle/ai/audio/video/library) - documented; no renderer caller, no user-visible failure; removal as follow-up PR.
3. Android AI parity zero - documented; no mobile route advertises AI features (desktop-only paths).
4. Legacy dead modules (EditorView, organization-service, system-tray, OpenRouterService, RetouchWorkspace, empty dirs) - documented; removal as follow-up PR.
5. Android hardware back-button - documented as `ANDROID_BACK_BUTTON_UNWIRED`; requires device-verifiable change, deferred.
