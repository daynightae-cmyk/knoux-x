# UI-to-service contract audit

Tree: integration baseline 1d76a0d plus closure commits. A rendered control is
not a runtime pass. Native acceptance refers only to recorded installed cases.

| Journey | UI / state owner | Service and persisted artifact | Failure / reopen contract | Current evidence |
|---|---|---|---|---|
| Native launch → React → onboarding → Home | main.tsx, App.tsx, MobileSplashOverlay, MobileOnboarding, MobileHomeDashboard | Generated launch resources; onboarding completion key; isHomeReady | Completion persistence unchanged; readiness-driven handoff; existing safety timeout | UI sources unchanged; API35 Debug/Release cold launch and trusted skip PASS on 33764b6 |
| Navigation / Back / drawer / fullscreen / lifecycle | androidBackButton controller, appStore, registered screen interceptors | Capacitor App native plugin; KnouxMediaSessionPlugin; document fullscreen | Modal/drawer before navigation; save-before-leave; root two-press Activity exit | Generated registration PASS in both builds; trusted drawer-dismiss + Settings-to-Home Back PASS on both installed APKs; root-exit blocked later |
| Library / SAF | MobileMediaLibraryView → androidSafBridge / androidFileBridge | KnouxSafPlugin ACTION_OPEN_DOCUMENT / persisted grants; metadata and content URI | Permissions kept by native provider; read/metadata failures remain visible; display name used | SAF result count=1 recorded in both APKs; full playback/seek case blocked by emulator loss. Persist/restart not reached; no base64-root-cause claim |
| Player | UltimateMobilePlayer / mobilePlayerSession / playerStore | HTML video and native media session/audio bridges; recent/resume records | True decoder state, subtitle/audio availability and errors; per-media reopen | No API-play/seek fallback passes; playback case did not complete before QEMU disappeared |
| Recording → editor | MobileScreenRecordingView → androidCaptureBridge → recordingEditorHandoff | KnouxScreenCapturePlugin / MediaProjection service / H264 MP4 in MediaStore; saved multitrack project | Consent/cancel/stop/finalize states; handoff only after save acknowledgment | Installed case retains byte/ffprobe/editor assertions but NOT_ATTEMPTED after session loss |
| Video Studio | MobileVideoStudioView / MobileVideoTimelineEditor → mobileTimelineGestures | knouxMultitrackAPI; Android local project and active export envelope | Save acknowledgment before export; dirty state retained on save failure | Native swipe/split/persist case NOT_ATTEMPTED after session loss; Windows persisted fixture reopened through hit-tested CDP mouse input |
| Photos-to-Video | MobileSlideshowEditor → Android slideshow APIs / androidSafBridge | Local project JSON references persistent SAF URIs; androidSlideshowRenderBridge | Source access is resolved again on reopen; stale grant surfaces errors | Test now requires restart + UI reopen, but NOT_ATTEMPTED after session loss |
| Photo Editor | MobileImageEditorView canvas / adjustment state | androidImageEditorBridge → SAF saveFile/writeFile; JPEG/PNG bytes | Export validation and reopening are separate from the preview | Byte encode/reopen unit gate exists; installed native save/reopen NOT_TESTED |
| Beauty Studio | MobileBeautyRetouchView → ImageStudioView / local retouch pipeline | AndroidRetouchModels, faceAnalysisClient; image document/export contracts | Deadline/error states; original file retained; actual model output required | Unit full-run timeout observed; isolated rerun recorded; installed face/model/save NOT_TESTED |
| Export / success / failure | MobileExportView / DesktopVideoStudioView → mobileTimelineRenderer | In-memory encoded blob; then explicit SAF/Electron file save; independent probe | Completion of render alone is not durable save; desktop rejects truncated video and removes rejected output | Windows IPC PASS. Export mixed: first FAIL, one service-output PASS (3.328s / 99 packets), latest hit-tested UI FAIL at duration guard. Native save + ffprobe NOT_TESTED |
| Windows atomic output | Electron IPC file-write → electron/fs/atomic-write.ts | Same-directory exclusive temp, fsync, bounded transient rename retry | Existing destination retained on failure; no weakened retry/coverage tests | Already contains PR57 functionality and stronger tests; no replacement made |

PR reconciliation: #57 has one unique commit but its substantive back-policy
and atomic-write implementation already exists in the integration tree. Its
missing build/runtime registration coverage is retained here without reverting
newer viewport measurements. #52's sole unique commit changes React import
spelling; Android StrictMode exclusion and lazy optional overlay are already
present. Both branches and their commits are preserved.

Root-cause boundary: previous runs 39311673504 / 39315915167 recorded SAF/session
loss followed by missing ADB transport. Run 39332856588 instead failed before
cases while acquiring native WebView bounds. No captured cause proves OOM,
product crash or emulator crash. This change adds pre-loss device/host streams
and native callbacks; it does not label a cause or auto-reload a lost renderer.

Fresh boundary on 33764b6: QEMU host processes 4815 (Debug) and 4966 (Release) disappear by 00:13:01Z / 00:12:53Z. Both host samples show ~9.4 GiB available immediately before disappearance, with no swap use. Neither a renderer-gone callback nor an app fatal crash was found in the captured selected device log lines. These are observations, not proof of the emulator exit cause. API34 comparison and host kernel/cgroup capture are added on ee1a62f.

API34 comparison (39354147723, ee1a62f): launch smoke and static gates PASS, 152 suites / 1335 tests PASS; initial Playwright WebView attachment timed out before any functional case. App PID 3640, ADB and host QEMU remained alive until action cleanup. Provider com.google.android.webview 113.0.5672.136. No success inferred for unattempted cases. This failure is distinct from API35 device loss.
