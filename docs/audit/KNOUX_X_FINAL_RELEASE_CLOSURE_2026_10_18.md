# KNOUX X - Final Release Closure Ledger (continuation)

Base: `main` @ `db0160b124b7efea8dbdfd54aa24102960aefdf1` (PR #54 merged 2026-10-18T04:59:02Z).
Branch: `feat/knoux-x-final-release-closure`.
Product code on this branch is unchanged from `db0160b`; all continuation commits are tooling, evidence and CI wiring.

## Head progression

- `db0160b` - merged main (CI green: Windows Timeline Export E2E 39098962349, Android APK 39098962356, Full Rebuild 39098962347, Android Release Acceptance 39098962353).
- `de3371b` - packaged player preferences / partial-merge / persistence / resume-across-relaunch E2E tool + evidence.
- `1d7f77c` - CI: run the player preferences E2E next to the timeline export gate, upload its evidence.
- `8cad214` - extend the player E2E with live playback, mid-playback speed change, real seek via progress slider, UI-pause persistence.
- `8412433` - native-dialog watchdog for the video-studio entry gate; refreshed video-studio / retouch / creative gate evidence.

## Verified evidence (packaged exe sha256 6da42455e1d08f437bfb9a33780a9e6f63a4e801a0239590878b73f56562bb29, 178 MB)

1. Player preferences + resume across relaunch - PASS 13/13 (`reports/player-preferences/evidence.json`):
   folder registered through the real native dialog, real SQLite scan, per-media prefs `{2.5, false, 1.6, 350}` applied with `video.playbackRate = 2.5`,
   partial update `{1.5, false, 1.6, 350}` merges and preserves boost/delay (regression guard), playback advanced via UI play, live speed change mid-playback,
   real seek via progress slider, UI pause persists `lastPosition = 15.849507`, relaunch resumes at exact position with notice "Resumed playback at: 0:15",
   media B independence, library folder cleanup.
2. Video Studio packaged entry gate - PASS (`reports/windows-video-studio-entry.json`):
   asar inspection, real editor navigation, landing actions, h264 probe, `openVideo` round-trip `null` via watchdog dismissal (`method=WM_CLOSE`), orphans=0.
3. Packaged retouch E2E - PASS (`reports/windows-packaged-retouch-e2e.json`): relaunchSuccess=true, argvOpenWithSuccess=true, orphans=0, fresh `reports/retouch-packaged-e2e-output.mp4`.
4. Packaged creative functional gate - PASS exit 0 (`reports/windows-packaged-functional-e2e/evidence.json`); scope note in-file: identity + IPC smoke only.
5. Player viewport packaged smoke - PASS, 10 measured scenarios (`npm run test:player-viewport`).
6. Windows timeline export E2E - PASS (VP8+Opus, 1920x1080, late-frame pixel proof; `reports/packaged-timeline-export-e2e/`).
7. Local verification sweep on `8412433`: doctor 0, typecheck 0, lint 0, jest 140/140 suites - 1245/1245 tests (116.2 s).
8. Performance probe on `db0160b` (quiet machine): uiReady p50 889 ms / p95 1094 ms; historical under load 4097 ms p50 -> 3143 ms p50 after merged startup work (`reports/performance/`).

## Root causes found and fixed in this continuation

- `library.scan` rejects folders that are not already registered (`electron/ipc/creative-suite.ts` `requireLibraryFolder`); the only registration path is the native `chooseFolder` dialog. The player E2E now drives that real dialog (`tools/pick-folder-dialog.ps1`).
- The video-studio entry gate assumed the native `Import video into Knoux X` dialog resolves itself; in this environment it never does. `tools/dismiss-native-dialog.ps1` finds the dialog by title/process and cancels it (WM_CLOSE, verified), so the gate exercises the documented `null` (cancelled) round-trip.
- Windows PowerShell 5.1 parses script files with the ANSI code page: automation scripts in `tools/` must stay ASCII-only.
- CI-only failure of the new player gate (run 39105467790, head eb64ab5): the GitHub runner sets `TEMP` to the 8.3 short form (`C:\Users\RUNNER~1\...`) while the native picker returns the canonical long path, so the equality check rejected every pick and retried three times. Fixed in `74cbafa` by canonicalizing the fixture directory up front (`fs.realpathSync.native`) and canonicalizing both sides of folder comparisons, plus per-attempt pick diagnostics recorded into the evidence/failure JSON. Local re-verification after the fix: PASS 13/13.

## CI matrix on the continuation PR (#55)

First cycle (head `eb64ab5`):
- KNOUX Windows Timeline Export E2E: export E2E PASS, new player preferences gate FAILED (root cause above), fix pushed.
- KNOUX Player Viewport Windows: PASS (10 scenarios) and produced the Squirrel installer artifact.
- KNOUX Windows Packaged Creative + Recording Real E2E: PASS.
- KNOUX Full Rebuild Windows: PASS.
- Android Release Acceptance: PASS (signed APK, KVM emulator install-launch-render smoke).
- Android APK (Capacitor): PASS.
Final cycle (head `74cbafa`): timeline export E2E PASS including the packaged player preferences/resume gate on the short-TEMP runner (14/14 steps, folder registration on attempt 1 - fix proof, evidence artifact 12128473223); viewport PASS and produced the installer artifact 12128812550; creative+recording, full rebuild, Android acceptance and Android APK all PASS. The PR head is fully green. Machine-readable matrix: `reports/final-closure/ci-matrix-2026-10-18.json`.

## Windows installer artifact (Squirrel, from CI run 39105467634)

- `Knoux X-2.1.0 Setup.exe` - 285,468,672 bytes - SHA256 `d9ea93733aea210d35430618b7a1640b546042c2e43338eb264ad98989d6c86d`.
- `KNOUX_Player_X-2.1.0-full.nupkg` - 284,730,515 bytes - SHA256 `425771b40ae1321deff281b9442649288895a569e1203a503653d865680ad52b`, SHA1 `a5fe1595568313ce34dbbb1948412df6a7f58272` matching the RELEASES feed entry.
- Authenticode: NotSigned (no signing certificate in this environment; SmartScreen will warn until a certificate is configured). Full record: `reports/final-closure/installer-artifact-2026-10-18.json`.

## Known limitations / blocked

- Android: no local adb / SDK / Java on this machine; acceptance relies on CI (KVM emulator install-launch-render smoke, signature verification). Physical device: PHYSICAL_DEVICE_NOT_TESTED.
- Android hardware back button is unwired (`ANDROID_BACK_BUTTON_UNWIRED`): exit-on-back instead of in-app navigation; fix requires `@capacitor/app` (CI-side tooling only) plus device-level verification that cannot run locally - deferred, documented in the discovery audit.
- KNOUX Cloud video generation live behavior: BLOCKED_EXTERNAL (backend placeholder endpoints; adapter keeps truthful `LIVE UNKNOWN` probe status).
- Dead IPC surfaces (`knouxAPI.player/subtitle/ai/audio/video/library`) and dead modules (legacy `EditorView`, `organization-service`, `system-tray`, `OpenRouterService`, `RetouchWorkspace`, empty feature dirs) contain no renderer callers and no user-visible failure; removal deferred to dedicated follow-up PRs (no destructive churn in the closure PR).
- PR #52 (`fix/android-runtime-performance-20260916`) is open and conflicting; preserved untouched per owner instructions.
- PR #53 (`fix/android-ci-lazy-lint-20260919`) remains open; preserved untouched.
- Legacy `K:` drive has ~0.1 GB free; builds run on the `D:\KnouxX-Builds` junction.
- Early picker experiment: a second `chooseFolder` while a dialog was already open preceded one clean app quit; not reproduced since, mitigated by single-attempt registration and ESC-close before retries.

## Discovery audit (verified disposition)

Full report: `reports/final-closure/discovery-audit-2026-10-18.md` (audit findings verified against the tree; one audit claim corrected: `DesktopVideoStudioView` IS routed at `src/App.tsx:163` and renders in the packaged video-studio gate).

## Open workstreams at ledger time

- CI on this PR: timeline export E2E (now including the player preferences gate), viewport workflow (`npm run make` -> Squirrel installer artifact), Android acceptance.
- Installer artifact hash from CI to be recorded under `reports/release/`.
- Final Arabic delivery report (sections A-H) pending.
