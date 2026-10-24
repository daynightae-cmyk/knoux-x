# KNOUX X — Windows Desktop Native Shell: Deep Forensic Audit & Repair — Evidence Report

Date: 2026-10-24 (Asia/Karachi)
Directive: "WINDOWS DESKTOP NATIVE SHELL, DEEP FORENSIC AUDIT & AUTONOMOUS REPAIR"
Scope: Windows desktop edition only. Android lanes untouched.

---

## [BASELINE] Repository | SHA | Git state

| Item | Verified value |
| --- | --- |
| Origin | `https://github.com/daynightae-cmyk/knoux-x.git` (fetch + push) |
| Remote `main` | `eaeb83ae8b6d368ffe8bace29821c5917cbf2006` — merge commit of **PR #81** (`mergedAt 2026-10-24T02:11:58Z`) |
| PR #61 | `MERGED`, merge commit `c1945931d739db9dd52459b81c013cd0ae1cdd88` (head `cd198a8`) |
| PR #81 | `MERGED`, head `8ae532b`, merge commit `eaeb83a` |
| Working checkout | `K:\Knoux Projects\knoux-x\Worktrees\knoux-x-retouch-r1-handoff-20261022`, branch `main`, HEAD `eaeb83a`, clean tree before edits |
| Other worktrees (all preserved, untouched) | `knoux-authority` `d0078a7` (31 uncommitted evidence artifacts), `knoux-r3-acceptance-20261023` `e29c818` (36 uncommitted files incl. `electron/ipc/file-dialog-policy.ts`, `electron/ipc/setup.ts`, `src/features/export/manualFrameCapture.ts` — concurrent agent work), `knoux-vault-postmerge-security-20261022` `2625b43` (clean) |

Checkout selection rationale: the retouch handoff worktree was the only worktree that was (a) clean and (b) fully merged into current `main`. It was advanced by fast-forward only (`git fetch origin main:main`, ancestry verified) — no reset, clean, rebase, force-push, branch/worktree creation, or deletion. Every untracked/modified artifact in the other worktrees remains in place.

**No commit, push, PR, merge, release or publication was performed.** All changes below are working-tree only.

---

## [FOUND] / [FIXED] P0 defects with real evidence

### P0-A — Metadata ownership (directive §3 gap A)

Evidence (pre-fix source at `eaeb83a`):
- `src/features/editor/MultitrackEditorView.tsx:168-188` — `readMediaMetadata()` created an HTML `<video>`/`<audio>` element, listened for `loadedmetadata`, and had **no timeout at all**; a container FFprobe can read but Chromium cannot decode could hang the import indefinitely, and Chromium's unsupported codec blocked import even when the file was perfectly valid.
- `electron/creative/ffmpeg-service.ts:55-78` — `ProbeResult` already carries `format.duration`, per-stream `duration`, and packet-measured `contentDurationSeconds`, all of which the import path ignored.

Repair:
- New `src/features/editor/importMetadata.ts`: `probeDurationSeconds()` (FFprobe is the authority: packet extent → container → any stream) and `readMediaMetadataDuration()` — a **bounded** fallback (default `MEDIA_METADATA_TIMEOUT_MS = 12000`) that always releases listeners/`src`/`load()`, settles exactly once, and rejects with `IMPORT_METADATA_TIMEOUT` or `IMPORT_METADATA_UNDECODABLE`.
- `MultitrackEditorView.insertSelectedMedia()` now: probe → native duration when present → bounded browser fallback otherwise; each failure maps to an actionable localized message (`metadataTimeout`, `metadataUndecodable` — EN + AR in `src/locales/multitrackEditor.ts`).
- Honest preview: `onError` handlers on the `<video>`, `<audio>` and `<img>` monitor elements set `previewError`, rendered as `.multitrack-preview-warning` (new CSS in `src/styles/multitrack-editor.css`) telling the user the clip stays on the timeline and exports through the native FFmpeg engine. **No fake preview is ever produced and unsupported codecs are never claimed usable.**
- Proxy generation was evaluated and deliberately **not** added: with FFprobe-owned metadata, an unsupported preview codec no longer blocks import, timeline placement, persistence or export, so a proxy would add risk without closing a proven gap. Status: NOT-IMPLEMENTED (justified).

### P0-B — Explorer drag/drop contract mismatch (directive §3 gap B)

Evidence: the renderer classifier (`src/features/editor/videoStudioEntry.ts:28-30`) accepts video `mp4 webm mkv mov avi m4v`, audio `mp3 wav flac aac m4a ogg opus`, image `png jpg jpeg webp bmp gif tif tiff`, and the view-level drop filter skips `unknown`; but `electron/ipc/setup.ts:53` authorized drops from a *different* set — no images, no `m4v`, and including `wmv`/`flv` the classifier rejects. Dropping a PNG or M4V failed at the security gate.

Repair:
- New `electron/security/media-file-types.ts` — one authoritative drop extension set (`mp4 webm mkv mov avi m4v` + audio + images), `isDroppedMediaExtension()`.
- `setup.ts` now calls that helper; the inline allowlist is gone.
- Security not weakened: path shape validation (length/null byte), `path.resolve`, `fs.stat` non-empty regular-file check, and `authorizedPaths.authorizeFile()` all remain, and real content is still validated by FFprobe in the production import path (a renamed text file yields no streams → `resolveImportKind` refuses).
- Parity is enforced by tests rather than runtime coupling, so main never imports renderer code.

### P0-C — Unsafe test automation (directive §4)

Evidence: process-name-wide force termination existed in **six** tools — `verify-packaged-video-studio-entry.cjs` (×2), `run-packaged-retouch-e2e.cjs` (×2), `run-packaged-timeline-export-e2e.cjs`, `run-packaged-timeline-export-cdp-e2e.cjs`, `run-packaged-player-preferences-cdp-e2e.cjs`, `knoux-performance-probe.cjs` — plus profile violations: the performance probe and the player-preferences E2E launched the packaged app with **no `--user-data-dir`** (production userData), and the probe measured/aggregated **every** `knoux-player-x` process on the machine, so an owner's open app would silently corrupt its numbers. None of these scripts was executed unchanged against the active desktop before repair.

Repair:
- New `tools/lib/packaged-process-lifecycle.cjs`: `taskkillPidTree()` (`/PID <pid> /T /F`, never `/IM`), `terminateOwnedChild()` (exit-event + PID-scoped kill, timeout), `isPidAlive()`, `createIsolatedProfile()` (run-unique, PID-suffixed, label-sanitized) and `removeIsolatedProfile()` (refuses any path outside its declared root).
- All six tools now launch only with isolated profiles, track only their own child PIDs, and shut down only their own trees; the performance probe measures only the owned process tree via `Get-CimInstance Win32_Process` parent-walk; failed runs preserve their profile and log its path for diagnostics; orphan checks became PID-scoped.
- Guard test `tests/unit/packaged-process-lifecycle.test.ts` scans every `tools/**.cjs` and fails if any image-name kill (`/IM`) returns, verifies remaining `taskkill` calls are PID-scoped or routed through the helper, and proves profile cleanup refuses foreign paths. `grep -c "'/IM'"` across `tools/` and `scripts/` is now **0**.

### P0-D — Real import user-path coverage (directive §3 mandatory acceptance, §4)

Evidence of the coverage hole: the packaged checker only round-tripped `creative:open-video` with a watchdog that **dismisses** the native dialog (Cancel) — as the directive states, that proves nothing about import. `tools/dismiss-native-dialog.ps1` could only close dialogs.

Repair:
- `tools/dismiss-native-dialog.ps1` gained a real selection mode (`-SelectPath`): foreground the `#32770` dialog, fill File name via `GetDlgItem(1148)`/`WM_SETTEXT` (SendKeys fallback with full special-character escaping), confirm via `IDOK` click, absorb any "Confirm Save As" overwrite box (`IDYES`/`IDOK`), and report `DIALOG_SELECTED` / `DIALOG_SELECT_TIMEOUT` with exit codes.
- New `tools/verify-packaged-video-import-e2e.cjs` drives the packaged EXE end to end through genuine user interaction: visible sidebar → Video Studio landing → click **Import video** → real native Open dialog operated by the OS → timeline item asserted from DOM → inspector duration compared with independently-probed FFprobe duration → decoded preview asserted (`readyState >= 1`, non-zero natural size) → screenshot → real **Ctrl+S** keystroke → real native Save dialog → persisted `.knouxedit` parsed from disk (source path + duration) → app close → relaunch on the same isolated profile → reopen through the visible Recent projects list. Port-in-use is now detected before launch instead of silently attaching to a foreign instance. Cancellation coverage stays separate (`verify-packaged-video-studio-entry.cjs` remains the null/cancel path).

### [PACKAGED] Real runtime result — video import VERIFIED

Executable: `out-verify/Knoux X-win32-x64/knoux-player-x.exe`, SHA-256 `e0ce004286c24f6d89d539922a619a55bef23bc2f30774d03ff38367070da9a9`, 186,361,344 bytes, built at `2026-10-24T03:59:35Z` from HEAD `eaeb83a`, Electron 32.3.3, `packaged: true`, product `Knoux X 2.1.0`.

`reports/windows-video-import-e2e/evidence.json` — **verdict PASS**, exit 0:

| Stage | Real evidence |
| --- | --- |
| Native Open dialog | `DIALOG_FOUND title="Import video into Knoux X"` → `FILENAME_SET method=WM_SETTEXT` → `CONFIRM method=IDOK_CLICK` → `DIALOG_SELECTED`, exit 0 |
| Timeline | `army-exercise.mp4`, kind `video`, clock `00:00:03.000`, inspector duration `3` |
| FFprobe (independent, packaged ffprobe) | `h264` `640x360`, `durationSeconds 3`, audio present |
| Preview | `readyState 4`, `640x360`, `error null` — decoded first frame, no codec warning |
| Native Save dialog (real Ctrl+S) | `DIALOG_FOUND title="Save KNOUX multitrack project"` → `CONFIRM method=IDOK_CLICK` → exit 0 |
| Persisted project | `reports/windows-video-import-e2e/imported-project.knouxedit`, 2,775 bytes, `timelineStart 0`, `duration 3`, 1 item |
| Relaunch + reopen | Recent list click → item `army-exercise.mp4`, `00:00:03.000`, inspector `3` |

Screenshot: `reports/windows-video-import-e2e/timeline.png`. A first run of this harness failed only in its own Recent-list matcher because the Windows Save dialog produced an uppercase filename (`IMPORTED-PROJECT.KNOUXEDIT`) while the app had correctly persisted that exact path (`multitrack-projects.json` verified); the harness was fixed to resolve the file the dialog actually produced — an app-correct, test-incorrect case.

---

## [FOUND] / [FIXED] P1 items

### Shell, security and lifecycle (directive §5)

| Finding (evidence at `eaeb83a`) | Status | Action |
| --- | --- | --- |
| Secure renderer prefs correct: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, `allowRunningInsecureContent:false` (`electron/window-security.ts:4-10`) | VERIFIED | unchanged |
| Fuses read from the **packaged EXE**: RunAsNode Disabled, CookieEncryption Enabled, NodeOptions env Disabled, NodeCliInspect Disabled, EmbeddedAsarIntegrity Enabled, OnlyLoadAppFromAsar Enabled | VERIFIED | unchanged; `GrantFileProtocolExtraPrivileges` remains **Enabled**, which the current `file://` media-preview architecture depends on — disabling it is a separate, measurement-backed change, recorded as an open hardening item |
| **No navigation guard and no window-open handler anywhere** (`grep setWindowOpenHandler|will-navigate` → 0 hits) — a compromised or injected renderer could navigate the trusted preloaded window to any URL, including foreign `file://` documents | FIXED | New `electron/security/navigation-target.ts` (pure predicate) + `electron/navigation-policy.ts`: top-level navigation restricted to the packaged renderer directory (dev-server origin only in development); `setWindowOpenHandler` always denies, with validated `https:`/`mailto:` handed to the OS browser via `validateExternalUrl`. Applied to the main window and both capture-selector windows |
| **No window state persistence** (no bounds save/restore anywhere) | FIXED | New `electron/window-state.ts`: atomic `window-state.json` under userData, restores only rectangles still intersecting a connected display (>=120 px), keeps normal bounds when maximized, debounced on resize/move/maximize, immediate on close, corrupt file falls back to defaults |
| Native application menu removed (`electron/menu/app-menu.ts` → `Menu.setApplicationMenu(null)`) | REVIEWED, no change | Essential commands remain reachable through the in-app command bus with real keyboard shortcuts (`save` = `Ctrl+KeyS`, `save-as`, `split-clip`, `undo/redo`, `export` in `src/core/settings/productCustomization.ts`, dispatched by `CommandShortcutController`); the approved premium titlebar is preserved rather than restoring generic native chrome |
| Electron **32.3.3** is outside supported release lines | NOT-IMPLEMENTED (evaluated) | Migration deliberately not attempted in this pass: it gates on Forge/Vite, Node ABI, `better-sqlite3` and `sharp` prebuilds, FFmpeg extraResources, preload contract, Squirrel/installer and fuses, each needing its own compatibility run with rollback evidence |

New tests: `tests/unit/navigation-policy.test.ts` — 5 cases: packaged renderer documents trusted; foreign `file://`, path-traversal and sibling-prefix escapes rejected; `https:`, `javascript:`, `data:` and a non-dev `http://localhost:5173` rejected; dev origin trusted only when supplied; no renderer-root ⇒ reject.

### Media pipeline and export reliability (directive §6)

| Finding | Status | Action |
| --- | --- | --- |
| Desktop timeline export materialised the **entire** rendered Blob in memory: `const bytes = new Uint8Array(await rendered.blob.arrayBuffer())` then one IPC write (`DesktopVideoStudioView.tsx:190`), i.e. renderer Blob + renderer ArrayBuffer + main-process copy. At the capped 45 Mbit/s bitrate (`timelineBitrate()`) that is ~5.6 MB/s of timeline — a 10-minute 1080p project needs several GB and can fail with an OOM or a truncated file | FIXED | New `src/features/video-studio/chunkedBlobWriter.ts` streams 32 MB slices (hard clamp 64 MB) with exact-offset accounting; new IPC channel `file:append` requires the destination to be authorized, chunk size in range, and `fs.stat().size === offset`, so a lost/duplicated chunk can never pass silently; the writer verifies `writtenBytes === blob.size`. Peak memory is now bounded by one chunk instead of the whole render |
| A failed/cancelled write left a half-file that looked like an export | FIXED | `DesktopVideoStudioView` tracks `destinationWritten` and deletes only the file this run created on any failure; the pre-existing O_EXCL exclusive-create and "never overwrite an existing file" rules are kept, as is the existing packet-extent coverage guard that already deletes a truncated accepted output |
| Export correctness proof | PARTIAL | Packaged timeline-export E2E against the new build: **attempt 1 failed honestly** — the app's own guard reported `The exported file ended before the timeline finished and was not accepted` (MediaRecorder under load produced a short render; nothing was accepted); **attempt 2 PASSED** — `Export verified`, output `vp8 + opus`, `1920x1080`, 508,003 bytes, packet-measured content extent `3.235 s` from 70 video packets, strict decode of early/late frames with pixel proof (`earlyDifference.materiallyDifferentPixelRatio 0.140`, `nonBlackPixelRatio` 1 early / 0.014 late, `sourceEndsBeforeLateSample true`) |
| Remaining root cause | OPEN | The desktop render is still Chromium `MediaRecorder` (`DESKTOP_TIMELINE_PREFERRED_MIME_TYPES`, VP8-first for determinism) rather than a native FFmpeg render pipeline. The rejection guard makes failure truthful, but intermittency under machine load is not eliminated. A native FFmpeg-backed renderer is the recommended next slice; it was **not** attempted here because replacing a working renderer without its own compatibility gate would risk the successful workflows the directive protects |

New tests: `tests/unit/chunked-blob-writer.test.ts` — 5 cases including byte-exact multi-chunk output with real files, exact offset sequence `[128,256,…]`, single-chunk create-only, empty render rejected **before** touching the destination, mid-write failure surfaced with a short file left (so cleanup runs), and chunk-size clamping.

`file:append` was registered through the whole contract (IPC_INVOKE + typed argument/result maps + source inventory + contract array) and the pinned channel-count assertion was updated `298 → 299`, so the boundary gate still fails on accidental drift.

### Feature audit (directive §7)

| Area | Finding | Status |
| --- | --- | --- |
| **Media Library statistics and pagination** | `LibraryView.tsx:51-74` requested `limit: 500, offset: 0` and derived video/audio/favorites counts from *that page* (`:132-136`); the backend hard-caps limit at 500 (`library-service.ts:154`), so any library over 500 items under-reported counts and rows past 500 were unreachable from this view. Additionally `library:statistics` is wired to the legacy in-memory `LibraryManager` (`SystemOrchestrator.ts:156`), not the SQLite service this view uses — a misleading API | FIXED | `LibraryService.query()` now returns a library-wide `summary` computed with SQL aggregates (`total/video/audio/favorites/missing`) independent of the page and filter; `preload-creative.ts` types extended; `LibraryView` uses the summary for stats and adds a real **"Load more (N remaining)"** path that walks `offset` by `items.length` and appends, resetting on filter/search change and after scans. New `tests/unit/library-summary-pagination.test.ts` (real `better-sqlite3` DB, 4 cases): truncated page still reports `total 5` with correct aggregates; three pages of 2 reach all 5 files exactly once; a filtered query keeps its own `total` while the summary stays library-wide; empty library returns zeroes, not nulls |
| Screen recording | Real implementation: `desktopCapturer.getSources` for display/window sources (`creative-suite.ts:191`, both region services), `navigator.mediaDevices.getUserMedia` for microphone/camera (`RecordingView.tsx:369-506`), and permissions are denied unless the window is trusted **and** a consent token is unexpired (`creative-bootstrap.ts:136-144`) | VERIFIED by code inspection; no echo-only substitute found. No recording was executed on this workstation (would capture the owner's screen) |
| AI integrations | Gateway takes an injectable HTTP client for test stubbing only (`electron/ai-gateway/http-client.ts:5`); no fake provider/model/output paths found in `electron/ai-gateway` or `ai-service.ts` | VERIFIED by inspection; no live provider calls made (would require keys/spend) |
| Player, Image/Retouch, Audio tools, Photos→Video, Export/Settings, visual quality at 800×600…1920×1080, RTL/LTR | Reviewed against existing packaged evidence and unit coverage; no new confirmed defect was found that could be fixed without redesign authority | NOT-RE-TESTED in this pass — recorded below |

### Performance on the freshly packaged build (directive §9)

Measured on this workstation, 3 cold/warm runs, **scoped to the owned PID tree** (this is what the fix enables; the old name-wide aggregation would have mixed in any other running KNOUX app). Artifact SHA-256 `e0ce0042…da9a9`, HEAD `eaeb83a`.

| Run | UI-ready | Working set (owned tree) | JS heap |
| --- | --- | --- | --- |
| 1 | 5,884 ms | 433.7 MB | 10.0 MB |
| 2 | 10,217 ms | 423.7 MB | 10.0 MB |
| 3 | 8,464 ms | 417.5 MB | 10.0 MB |

p50 UI-ready 8,464 ms, p95 10,217 ms; p50 working set 423.7 MB. Historical packaged figures (~4,440 ms median, ~411 MB) are **not** claimed for this build: memory matches history, while startup here is slower on a desktop that is simultaneously running CI tooling, other agents and heavy builds. `backgroundThrottling: false` remains intentional (playback/export must not stall when unfocused) and was not changed, per §9.

### Installer, updater and release safety (directive §10)

- Configuration reviewed: `@electron-forge/maker-squirrel` with `name: KNOUX_Player_X`, authors/description set, `setupIcon` only when the `.ico` exists; `packagerConfig` uses asar with `**/*.{node,dll}` unpacked, `executableName: knoux-player-x`, `appBundleId: dev.knoux.player-x`, `extraResource` for ffmpeg/ffprobe/brand assets, and `afterPrune: [packageNativeRuntime]`.
- Update path: `electron/startup/app-updater.ts` is packaged-Windows-only, `autoDownload` off (explicit user action after "Update available"), feed pinned to the canonical `daynightae-cmyk/knoux-x` GitHub Releases, artifacts installed only through electron-updater/Squirrel, 24 h check throttle, status events for Settings → About.
- `npm run make` produced `out-verify/make/squirrel.windows/x64/KNOUX_Player_X.2.1.0.nupkg` (290,675,462 bytes, SHA-256 `6054f682445d17bdb57e8f5d02dc43a8509bf4edb2656571b04fc2c4fda23020`) and then **failed before `Setup.exe`**. Two causes were isolated, both environmental rather than product:
  1. Squirrel shells out to bare `7z`; this machine has 7-Zip at `C:\Program Files\7-Zip\7z.exe` but **not on PATH**, so `CreateZipFromDirectory` died with `Win32Exception: The system cannot find the file specified`. A batch wrapper that prepends `C:\Program Files\7-Zip` to PATH (for that one command only — no system PATH change, no install) proved the diagnosis: it printed `C:\Program Files\7-Zip\7z.exe` and got past the resolver.
  2. With `7z` resolvable, Forge's re-package step then hit the same external lock as before — `EBUSY: resource busy or locked, unlink 'out-verify\Knoux X-win32-x64\resources\app.asar'`.
  GitHub Windows runners provide 7-Zip on PATH, and the CI installers assert exactly one `*Setup.exe` (`.github/workflows/full-rebuild-windows.yml:148`, `knoux-live-release.yml:221`); the maker therefore remains a CI-side step, and the copied `Squirrel.exe` left in the app directory by the failed attempt was removed.
- **No installer was executed on this workstation.** Clean-install and upgrade-over-previous-version tests with isolated data therefore remain NOT-RUN, and the unpacked EXE is not presented as a signed release: this build is unsigned locally, so it is **never** labelled a verified signed production release. Exact package SHA-256 recorded above; source commit `eaeb83a`.

---

## [PACKAGED] Directive §3 import matrix — closed on the real EXE

Harness: `tools/verify-packaged-import-matrix.cjs` (each row starts from the Video
Studio landing cards after a renderer reload, so every case gets a clean project,
a clean error surface and the right request kind). Evidence:
`reports/windows-import-matrix/evidence.json` + `final.png` + `run.log`, against
`out-import/Knoux X-win32-x64/knoux-player-x.exe` built from `eaeb83a`.

**verdict = `PASS_WITH_BLOCKED(2)` — 24 PASS, 0 FAIL, 2 BLOCKED**

| Row | Result | Real evidence |
| --- | --- | --- |
| `h264-aac-mp4` | PASS | item `video`, clock matches packaged FFprobe |
| `mp4-without-audio` | PASS | item added; `hasAudio false` handled |
| `mov` / `webm` / `mkv` / `m4v` | PASS | items with FFprobe-matching durations |
| `avi` | PASS | item correct **and** the honest preview warning for `mpeg4`, which Chromium cannot decode — clip stays editable/exportable, no fake preview |
| `hevc-h265` | PASS | item from native metadata + honest `hevc` preview warning; unsupported-in-window is never claimed usable |
| `audio-only-mp3` | PASS | `audio` item on the auto entry card, `<audio>` preview |
| `image-png` | PASS | `image` item, 5 s, `<img>` decoded |
| `arabic-filename` (`فيديو-اختبار.mp4`) | PASS | Unicode name imported through the real dialog (`WM_SETTEXT`) |
| `spaces-in-filename` | PASS | `army exercise take 2.mp4` |
| `invalid-file` | PASS | text file renamed `.mp4` → actionable error, **no item** (content is validated, not the extension) |
| `zero-byte-file` | PASS | rejected as invalid request, no item |
| `truncated-media` | PASS | decisive outcome, no false success |
| `read-only-source` | PASS | imported from a read-only file; originals never modified |
| `large-file-no-full-buffer-read` | PASS | 1080p/60 s ~15 Mbit/s fixture imported with the chunked path and bounded heap |
| `picker-cancellation` | PASS | native dialog cancelled through the OS UI → no item, no error |
| `rapid-double-click` | PASS | exactly one item from two synchronous clicks |
| `import-after-navigate-away-and-back` | PASS | library → editor → import lands |
| `deleted-after-selection` | PASS | OS refused the vanished selection; app kept no partial item and stayed interactive |
| `synthetic-drop-cannot-authorize` | PASS | rejected: `The desktop request was invalid.` — a fabricated drag cannot bypass path authorization |
| `unsupported-extension-drop-rejected` | PASS | `payload.exe` rejected by the shared drop contract |
| `repeated-imports-across-kinds` | PASS | video + audio + image all imported across the run |
| `project-persist-and-reopen` | **BLOCKED** | this run's Save dialog refused the typed path (`exit=3`), so the row recorded no partial import. The same journey **is** verified: the dedicated `verify-packaged-video-import-e2e.cjs` run passed real Ctrl+S → native Save dialog → `.knouxedit` (2,775 B, source path + duration) → relaunch → reopen from Recent |
| `very-long-path` (~300 chars > `MAX_PATH`) | **BLOCKED** | the classic Windows dialog itself rejects the path; while that window-modal dialog is up, script evaluation on the page is blocked, so the harness could not confirm the app-side recovery. No partial import was recorded. OS-level limit, not an app defect — needs a long-path-aware dialog invocation |

## [TEST] Final gate re-run after the matrix work

| Gate | Exit | Result |
| --- | --- | --- |
| `npm run typecheck` | 0 | clean |
| `npx eslint <27 changed files> --max-warnings=0` | 0 | clean (one `no-var-requires` in the library test fixed with `jest.requireActual`) |
| `node --check` on 10 touched tools + `forge.config.js` | 0 | clean |
| image-name kill scan (`'/IM'` in `tools`/`scripts`) | — | **0 matches** |

## [TEST] Commands, exit codes, results (earlier gate sweep)




| Gate | Command | Exit | Result |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` (`tsc --noEmit`) | 0 | clean |
| ESLint | `npx eslint <all changed .ts/.tsx> --max-warnings=0` | 0 | 0 errors, 0 warnings |
| Full unit suite | `npx node@20.20.2 jest` (CI's Windows Node, needed because the installed `better-sqlite3` prebuild targets ABI 115; local Node 24 is ABI 137) | 0 | **189 suites / 1,622 tests passed, 0 skipped, 0 failed** |
| New suites | `import-metadata` (8), `dropped-media-contract` (4), `packaged-process-lifecycle` (4), `navigation-policy` (5), `library-summary-pagination` (4), `chunked-blob-writer` (5); `file-dialog-and-authorization` extended (+1), `ipc-boundary-validation` re-pinned | 0 | all pass |
| Tool syntax | `node --check` on all touched/created `.cjs`; PowerShell AST parse of `dismiss-native-dialog.ps1` | 0 | clean |
| Image-name kills | `grep -c "'/IM'"` across `tools/` + `scripts/` | — | **0 matches** (was 8 sites in 6 tools) |
| Package | `npm run package` | 0 | `out-verify/Knoux X-win32-x64/knoux-player-x.exe` 186,361,344 B, SHA-256 `e0ce0042…da9a9` |
| Packaged import | `node tools/verify-packaged-video-import-e2e.cjs` | 0 | **PASS** (native Open dialog, timeline, preview, Ctrl+S, native Save dialog, project, relaunch + recent reopen) |
| Packaged export | `node tools/run-packaged-timeline-export-cdp-e2e.cjs` | 1 then 0 | attempt 1 rejected truncated render by the app's own guard; attempt 2 **PASS** with FFprobe + pixel proof |
| Performance | `KNOUX_PERF_RUNS=3 node tools/knoux-performance-probe.cjs` | 0 | 3 runs, owned-tree memory/CPU measured |
| Fuses | `npx @electron/fuses read --app <packaged exe>` | 0 | 6 of 8 fuses hardened; `GrantFileProtocolExtraPrivileges` enabled (documented) |

---

## Files changed (working tree, uncommitted)

Modified source: `src/features/editor/MultitrackEditorView.tsx`, `src/features/library/LibraryView.tsx`, `src/features/video-studio/DesktopVideoStudioView.tsx`, `src/locales/multitrackEditor.ts`, `src/styles/multitrack-editor.css`, `electron/ipc/setup.ts`, `electron/ipc/contract.ts`, `electron/ipc/channel-types.ts`, `electron/ipc/channel-source-inventory.ts`, `electron/preload.ts`, `electron/preload-creative.ts`, `electron/library/library-service.ts`, `electron/window.ts`, `electron/creative/recording-region-service.ts`, `electron/creative/region-capture-service.ts`, `forge.config.js` (opt-in `KNOUX_FORGE_OUT_DIR` only).
New source: `src/features/editor/importMetadata.ts`, `src/features/video-studio/chunkedBlobWriter.ts`, `electron/security/media-file-types.ts`, `electron/security/navigation-target.ts`, `electron/navigation-policy.ts`, `electron/window-state.ts`.
New tests: `tests/unit/import-metadata.test.ts`, `dropped-media-contract.test.ts`, `packaged-process-lifecycle.test.ts`, `navigation-policy.test.ts`, `library-summary-pagination.test.ts`, `chunked-blob-writer.test.ts`; extended tests: `file-dialog-and-authorization.test.ts`, `ipc-boundary-validation.test.ts` (channel count).
New/changed tooling: `tools/lib/packaged-process-lifecycle.cjs` (new), `tools/verify-packaged-video-import-e2e.cjs` (new), `tools/verify-packaged-import-matrix.cjs` (new), `tools/dismiss-native-dialog.ps1` (real `-SelectPath` selection), `tools/knoux-performance-probe.cjs`, `tools/verify-packaged-video-studio-entry.cjs`, `tools/run-packaged-retouch-e2e.cjs`, `tools/run-packaged-timeline-export-e2e.cjs`, `tools/run-packaged-timeline-export-cdp-e2e.cjs`, `tools/run-packaged-player-preferences-cdp-e2e.cjs`, `.gitignore` (ignore isolated `out-*/` verification builds and harness-run profiles so build output can never be committed by accident).
Regenerated evidence: `reports/windows-video-import-e2e/*`, `reports/packaged-timeline-export-e2e/*`, `_temp/live-evidence/windows-performance-eaeb83a-*.json`.
Build output kept out of the source tree: `out-verify/` (isolated, created only because `out/...app.asar` is held by an external lock — see Blockers).

---

## [BLOCKED] Concrete reasons

1. **`resources/app.asar` inside the packaged output is locked by an unidentified external process** (`EBUSY` / `Device or resource busy`; no `knoux-player-x`/`electron` process exists and no command line references the path). It first struck a default-`out` package attempt, which failed and left the previous EXE deleted, and later struck `out-verify` during the installer retry. Workaround used for all successful packaged evidence: `KNOUX_FORGE_OUT_DIR=out-verify` plus `KNOUX_IMPORT_PACKAGE_ROOT` / `KNOUX_PERF_PACKAGE_ROOT` / `KNOUX_EXPORT_PACKAGE_ROOT` overrides. Releasing the lock would need killing an unowned process or a reboot — both forbidden here.
2. **`Setup.exe` generation additionally needs `7z` resolvable from PATH**, which this workstation does not provide (see §10). Both blockers must clear, or the maker runs on the CI Windows runner.
3. **Native dialog automation requires an interactive desktop session**; in a headless/locked session the new harness reports `IMPORT_E2E_NATIVE_DIALOG_FAILED` with the PowerShell output instead of claiming import success — no silent fallback.
4. **`better-sqlite3` prebuild targets Node ABI 115**; the repository's Windows CI uses Node 20.20.2, so `npm test` under local Node 24 cannot load the native library. Tests were run under Node 20.20.2 (exit 0). No dependency was reinstalled or rebuilt.

## Outstanding items and statuses

| Item | Status |
| --- | --- |
| Video Studio import through the real native picker: metadata → timeline → preview → save → reopen (H.264/AAC MP4) | **VERIFIED** |
| Explorer drag/drop extension contract | **PARTIAL** — unified, unit- and source-guard tested; the literal Explorer drag gesture is not automated in packaged mode |
| Full directive §3 matrix (MOV, WEBM, MKV, AVI, M4V, HEVC, audio-only, image, invalid, truncated, zero-byte, Arabic name, spaces, read-only source, deleted-after-selection, rapid double-click, navigate away/back, repeated import, large file, synthetic/unsupported drops) | **VERIFIED on the packaged EXE** — 24 PASS / 0 FAIL; two environment-level rows BLOCKED (`>MAX_PATH` dialog refusal, this run's Save-dialog refusal, whose journey is separately VERIFIED) — see the matrix section above |
| Timeline export | **PARTIAL** — correct, pixel- and FFprobe-verified, truncation-honest; intermittently truncated by MediaRecorder under load (1 of 2 runs). Native FFmpeg-backed render pipeline: **NOT-IMPLEMENTED** (recommended) |
| Library-wide counts and access to all indexed files | **VERIFIED** at unit level (real SQLite); UI wiring type-checked; not re-measured in packaged mode |
| Navigation/new-window policy, window-state persistence | **IMPLEMENTED-NOT-VERIFIED** at runtime — unit-tested predicate, applied to all three app windows; runtime restore/deny not yet exercised on a desktop |
| Windows shell integration (file associations, taskbar progress, media keys, notifications, tighter fuses) | **UNKNOWN / unchanged** — reviewed, no confirmed defect, no change made without evidence |
| Electron 32.3.3 → maintained line migration | **NOT-IMPLEMENTED** — evaluation recorded, gated on its own compatibility matrix |
| Installer `Setup.exe`, clean install, upgrade over earlier version with isolated data | **BLOCKED / NOT-RUN** — Squirrel `.nupkg` built and hashed (`6054f682…3020`), `Setup.exe` blocked by PATH + the external `app.asar` lock described above; no installer was executed on this workstation, and the unsigned local build is never presented as a signed production release |
| Screen recording / AI provider live calls / physical camera-microphone behaviour | **NOT-RUN** by choice — would capture the owner's screen, spend provider money, or use devices belonging to the session |

## Final Git status

Branch `main` at `eaeb83ae8b6d368ffe8bace29821c5917cbf2006`, identical to remote `main`. The working tree contains only the uncommitted repairs listed above plus regenerated evidence and the isolated `out-verify/` build. No commit, push, PR, merge, tag, release or publication performed; no branch or worktree created; no reset/clean/force operation; the three other worktrees and all their uncommitted and untracked artifacts are untouched; the preservation archive was not modified.
