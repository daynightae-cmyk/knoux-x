# R1 — Image Studio project and export integrity

## Reality

Baseline `origin/main`: `9ccf59310f9410a8832ef50b513d998c8ea54245`, independently fetched and checked on 2026-10-22. Checkout: `/workspace/knoux-x`. Branch: `fix/retouch-project-save-export-20261022`.

The latest pasted request explicitly targets KNOuX X Retouch and supersedes the earlier KNOuX REC Windows-path request. Both October 21 attachments were read as historical evidence and reconciled against current source. No access to the owner's Windows files or previous Base directory is assumed.

The baseline's Android APK, Android Release Acceptance, Windows Timeline Export E2E and Windows Full Rebuild runs all completed successfully. Those runs validate the baseline, not this patch. No open PRs existed at preflight. CLI authentication initially failed; public API reads and then authenticated repository access were independently verified before PR operations.

## Risks and unique work

The initial checkout was clean, with one worktree and no local stash. No history, branches, worktrees, media or user files were deleted or reset. Windows-local unique work remains outside this inspection. Vault, App navigation, signing, model assets, manifests, lockfiles, visual styles and unrelated product modules are unchanged.

No production release, deployment, tag or merge is authorized by this report. The PR must remain unmerged while required acceptance is missing.

## Confirmed defects and implementation

- Ctrl+S bypassed retouch synchronization and immediately marked the project saved before disk I/O completed. It now shares the toolbar's save command, awaits synchronization and actual persistence, handles cancellation/failure, and opens Save As for untitled projects. Ctrl+Shift+S is supported.
- Concurrent saves are blocked. Newer edits or a different document cannot be marked saved when an older pending save finishes. Ctrl+N cannot race a pending file operation.
- Flattened and per-layer exports previously received bytes without delivering a file. Export now selects a destination through the existing authorized file picker and writes the encoded bytes through the existing file bridge. Empty output and failed writes do not report success.
- Export no longer clears the editable project's dirty state, so closing still protects unsaved edits. Export cannot overwrite the active `.knouximage` project.
- Importing a new image clears the previous project destination, preventing accidental reuse of that path.
- Export dimensions follow the opened/imported document and reject non-finite values. Planning is split into a browser-safe module; Node PNG/BMP/SVG encoding remains in the existing backend module with compatible exports. A runtime test caught and corrected an initial Node `zlib` import crossing into the renderer.
- Real mouse testing found that the export format popup escaped the viewport inside its scrolling panel. The existing `NeonSelect` now supports an opt-in body portal with bounded positioning, enabled for this export control. The shared component's outside-click/ref handling is corrected and tested without replacing its styling or keyboard behavior.

### Exact implementation files

| File | Change |
| --- | --- |
| `src/features/image-studio/documentCommands.ts` | Shared, awaited project save and image export delivery |
| `src/features/image-studio/ImageStudioView.tsx` | Keyboard shortcuts use the shared save command and pending-operation guard |
| `src/features/image-studio/components/ImageStudioToolbar.tsx` | Shared save/export handlers; clear destination on new image import |
| `src/features/image-studio/components/ImageStudioExportDialog.tsx` | Real file delivery, document-sized defaults, disabled duplicate actions |
| `src/core/image-studio/export/plan.ts` | Browser-safe export planning and dimension validation |
| `src/core/image-studio/export/export.ts` | Reuse/re-export planner while retaining backend encoders |
| `src/components/neon/NeonSelect.tsx` | Opt-in unclipped popup positioning, refs and outside-click handling |
| `tests/unit/neon-select.test.tsx` | Clipped-panel, viewport, pointer, outside-click, cleanup and RTL regressions |
| `tests/unit/image-studio-document-commands.test.ts` | Save/export cancellation, errors, races, destination and dirty-state regression tests |
| `tests/unit/image-studio-export.test.ts` | Non-finite dimension regression tests |
| `tests/integration/image-studio-project-lifecycle.test.ts` | Real service/disk/masked-pixel/restart/export acceptance without network calls |
| `tools/verify-image-studio-project-lifecycle.cjs` | Actual Electron UI driver; automates only OS pickers and records failures |
| `.github/workflows/full-rebuild-windows.yml` | Runs the UI driver against the existing built checkout and preserves evidence, including on failure; does not add another build |
| `tools/installed-image-lifecycle-driver.cjs` | Drives the real installed EXE via Chromium CDP and the existing native Windows dialog helper; checks build and payload identity |
| `tools/slideshow-phase1-native-dialog.ps1` | Win32-only native dialog automation (visible dialogs, real key input, exact filename read-back, posted confirmations) |
| `tests/unit/slideshow-installed-verifier-recovery.test.ts` | Helper contract: Win32-only, no UIA, no hidden address edit, exact read-back, posted confirmation |
| `tests/unit/image-studio-installed-lifecycle-verifier.test.ts` | Installed verifier contract: picker settle, honest failure reason, cancelled-save and export assertions |
| `reports/retouch-r1-20261022/installed-evidence.json` | Passing installed Windows journey on the locally packaged `f7e33d0` payload |

The existing Image Studio store, retouch operations, masks, renderer, `syncRetouch` preload/IPC, `ImageStudioService`, persistence envelope, Sharp codecs and authorized file bridge are retained. No replacement editor or AI engine was introduced.

### Installed Windows acceptance (native dialogs)

The `validate-package` job of Windows Full Rebuild run `39782293184` failed waiting for `.image-studio-saved`. Its uploaded artifact (`knoux-installed-image-lifecycle-7a0aaa86187d7cb4793cd66609ecbdb391e89a4f/evidence.json`) records the harness's own reason:

```
Native dialog directory mismatch after 3 attempts:
requested 'D:\a\knoux-x\knoux-x\_temp\installed-image-lifecycle-evidence\knoux-image-lifecycle-mG53dt',
observed ''
```

The helper required a UI Automation `Address:` label that the Windows common file dialog does not expose, so the Save dialog was never driven and `saveFile` never resolved. The application save and export were not reached and were not the defect. Root cause and repair:

- The helper is Win32-only again: `EnumWindows`/`EnumChildWindows` over the app's own visible `#32770`, no `UIAutomationClient`, no process-wide automation search.
- Save targets are typed into the dialog's own file-name edit as real `WM_CHAR` input; the hidden address edit (`id=41477`) is never used.
- Windows applies the dialog's default file name asynchronously, so the first pass can produce `portrait.knouximageC:\...`. The helper now reads the edit back with `WM_GETTEXT` (marshalled across processes) and retypes until the box holds exactly the requested path, then fails with the observed value if it never does.
- Confirmation buttons are activated with a posted `BM_CLICK` so an overwrite prompt cannot block the helper. Only a secondary window exposing `Yes`/`Replace`/`Save` is treated as an overwrite prompt; a file dialog that is still rebuilding is ignored.
- The driver resolves a picker on the helper's JSON record instead of on PowerShell teardown (CSC kept the inherited pipe open for ~14 s after the dialog was gone) and reports timeout/exit honestly.
- The verifier waits until the app has persisted the Image Studio workspace section before proceeding. The shell restores the last section when its settings load resolves; navigating before that settle could leave the app on another view mid-journey.

The verifier now also proves the product path independently of dialog automation: launching the packaged app with its existing `--retouch-phase3b-acceptance-config` seam (used by the app's own acceptance tests, not added for this run) and importing/exporting through the real UI wrote a 108,127-byte PNG with zero renderer errors.

## Capability matrix

| Feature | Existing path / handler | Processing and export | Evidence / status |
| --- | --- | --- | --- |
| Desktop project save | `ImageStudioView` / `ImageStudioToolbar` → `saveStudioProject` → `syncRetouch` / save IPC | Existing service + integrity envelope | VERIFIED in Node; VERIFIED in installed Windows app through actual native dialogs |
| Flattened/layer export delivery | Toolbar / ExportDialog → `exportStudioImage` | Existing backend retouch/compositor/Sharp → authorized file write | VERIFIED real Node output for flattened PNG/JPEG/WebP; installed Windows PNG matches the preview exactly; layer dispatch unit-tested |
| Masks, zero strength, source preservation | Store → retouch preview bridge / backend flatten | Existing CPU retouch pipeline | VERIFIED on repository-authored synthetic fixture; human portrait quality NOT_TESTED |
| Android Beauty | `MobileBeautyRetouchView` / Android runtime bridge | Existing mobile path retained | Installed candidate NOT_TESTED |
| Video retouch | `VideoRetouchInspector`, preview overlay → `VideoFrameProcessor`; `mobileTimelineRenderer` export | Existing tracked frame pipeline retained | STATIC_VERIFIED connection; skipped-layer disclosure and segmentation fallback remain PARTIAL and unchanged |
| Face/body models | Existing workers and model services | Existing local runtime only when dependencies are verified | Inference and commercial-license acceptance NOT_TESTED in this slice |

## Tests and actual output

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm run lint` | PASS, exit 0 after correcting the new filename-sanitizer lint error |
| `npm test -- --runInBand --watch=false` | PASS: 169 suites, 1468 tests; 669.808 s |
| `npm test -- --runInBand tests/integration/image-studio-project-lifecycle.test.ts` | PASS: 1 additional suite/test; actual processing/disk workflow 11.756 s |
| Targeted ESLint for the additional integration test and planner | PASS, exit 0 |
| `npm test -- --runInBand tests/unit/neon-select.test.tsx` after the popup correction | PASS: 25 tests, including 4 new cases; existing mouse and keyboard behavior retained |
| TypeScript and targeted ESLint after the popup correction | PASS, exit 0 |
| Actual Electron mouse selection of JPEG and WebP | PASS after the popup correction; no export/inference claimed by this interaction-only check |
| Complete local suite after the popup correction | PASS: 170 suites, 1473 tests, 327.02 s; zero failed/skipped |
| Production renderer build after the popup correction | PASS: 2283 modules, 1 minute |
| Windows Full Rebuild on `5c65f299baa53c364be6dad73843c3dd055f46f6` | PASS, including the full image UI lifecycle against the built source checkout |
| `node node_modules/vite/bin/vite.js build --config vite.renderer.config.ts --outDir .vite/renderer/main_window` | PASS; 2283 modules, 2m 4s |
| `node --check tools/verify-image-studio-project-lifecycle.cjs` | PASS |
| `node --check tools/installed-image-lifecycle-driver.cjs` and `node --check tools/run-slideshow-phase1-installed-verification.cjs` | PASS |
| `npm run typecheck` (final) | PASS, exit 0 |
| `npm run lint` (final) | PASS, exit 0 |
| `npm test` (final, full suite) | PASS: 171 suites, 1481 tests, 84.5 s; zero failed/skipped |
| Installed Windows lifecycle on packaged `f7e33d09a354755bdedf36a210c901e93d383e20` | PASS: import → retouch → cancelled save stays dirty → Ctrl+S project save → PNG exact match → JPEG/WebP → close/reopen after restart → original unchanged |
| Electron image lifecycle on Linux | FAILED at image import: independently reproduced native Sharp/libvips assertion; no full GUI-flow pass claimed |
| Source-checkout lifecycle driver on this Windows host | BLOCKED: `better-sqlite3` built for `NODE_MODULE_VERSION 115` while Electron 32 needs 128; no Visual Studio/Windows SDK for `electron-rebuild`. CI remains the environment for that step. |
| New Windows UI lifecycle CI step | Added; also runs the installed mode after repair and before uninstall |
| Android installed retouch acceptance | NOT_TESTED |

The full suite and additional integration test are separate invocations: 170 suites / 1469 tests passed across them, not a single 170-suite run. The initial slow integration attempt was stopped while optimizing byte comparison in the test; its replacement completed successfully without weakening pixel assertions.

The 169-suite run predates the final select-popup correction. Its affected 25-test select suite and typecheck/lint were rerun successfully, and the complete candidate suite is rerun by Windows CI. The initial Windows UI check on `4c8305f` successfully imported, saved and exported a pixel-matching PNG, then failed on a wrong selector for the existing format control. Correcting the selector exposed and led to the real clipped-popup fix. Earlier failed runs are not reported as passes. The latest PR check results must be read on its current head.

The final local rerun after the popup correction passed all 170 suites / 1473 tests. The Windows source-checkout journey then passed on `5c65f29`. The installed mode reuses the installer already built by CI, runs after repair and before uninstall, controls actual native Open/Save dialogs with the existing `slideshow-phase1-native-dialog.ps1`, and requires packaged build SHA and installed EXE hash to match the checkout/payload. It adds no production app test flag, weakens no fuse, and does not rebuild the installer a second time. The locally packaged `f7e33d0` payload passed that journey end to end; CI must reproduce it on the final head.

`reports/retouch-r1-20261022/installed-evidence.json` is the passing installed run on the locally packaged `f7e33d09a354755bdedf36a210c901e93d383e20` app. It records `success: true`, `restartReopenExact: true`, `originalUnchanged: true`, a 147,417-byte `.knouximage`, and outputs that are all 640×960: PNG 73,543 bytes with `maxPreviewDelta: 0` (byte-identical to the rendered preview), JPEG 15,883 bytes, WebP 7,530 bytes. The same evidence directory holds `before.png`, `after.png`, `reopened.png` and the seven `native-picker-*.png` captures of the real dialogs. The Windows CI job uploads its own artifact; the local screenshots are not committed.

`evidence.json` records the real service/file results. The test closes the backend, creates a new backend instance, reopens the saved project, and checks the masks/operations. This models backend restart; it is not an installed application restart.

- Fixture: `tests/android/fixtures/portrait-two-faces.jpg`, generated from repository-authored SVG by `tools/create-android-e2e-fixtures.cjs`. It is synthetic, not evidence of face detection or natural skin quality.
- PNG/JPEG/WebP outputs are 640×960. The PNG matches the preview byte-for-byte.
- 307,200 pixels changed inside the left-half mask; no pixel changed outside it; alpha remained unchanged.
- Strength zero reproduces source pixels exactly. The original fixture SHA-256 remains `55626765f0ac963643139d8f5e60fc77f27aa407ed96a2fa7ee2419179e7d2f1`.
- Exporting zero-strength edits leaves those edits dirty and leaves the previously saved strength unchanged on disk.
- Network attempts during the real backend test: 0. No inference, upload or provider response was fabricated.

## Visual evidence and runtime limitation

`ui-ltr.png` and `ui-rtl.png` are actual 1440×1000 Electron screenshots of the empty Image Studio workspace, not screenshots of a completed editing flow. They preserve the violet/lavender identity. Existing untranslated Retouch labels and the `nav.image-studio` title key remain visible; full bilingual visual acceptance is PARTIAL.

`portrait.png`, `portrait.jpeg`, `portrait.webp` are real encoded backend outputs. `difference.png` shows absolute RGB differences amplified 4× against the repository fixture; it is a diagnostic image, not an application screenshot.

Linux native isolation evidence is retained in `/tmp/retouch-sharp-electron-isolation.log`, `/tmp/knoux-image-lifecycle-Q4Y8uZ/evidence.json` and the other uniquely named lifecycle directories. The same Sharp decode succeeds in Node 20.20.2 but aborts in Electron 32.3.3, including `ELECTRON_RUN_AS_NODE=1`, without loading project source. A diagnostic library-preload attempt also failed and is not used in saved setup or product code. No dependency verification was disabled.

Raw local gates are retained as `/tmp/retouch-r1-all-tests.log`, `/tmp/retouch-r1-real-files-final.log`, `/tmp/retouch-r1-typecheck-final.log`, `/tmp/retouch-r1-lint-final.log`, `/tmp/retouch-r1-lint-extra.log`, and `/tmp/retouch-r1-build-final.log`. The full editable project remains under `_temp/live-evidence/retouch-r1-d764fe6e-6a3d-48be-85bb-c9581c2424fa/`.

## Remaining / safe next action

Windows installed acceptance now passes locally on the packaged `f7e33d0` payload with actual native dialogs. R1 still must not be represented as complete until CI reproduces that evidence on the pushed head SHA and the Android installed lane is exercised; no merge is authorized by this report.

Two observations are recorded rather than fixed here because they are outside R1's save/export contract: (1) an intermittent renderer error `Cannot read properties of undefined (reading 'parse')` appeared in two exploratory probes but not in any passing acceptance run, and its origin is not yet identified; (2) `electron/ipc/file-dialog-policy.ts` drops `properties`, so `createDirectory`/`showOverwriteConfirmation` passed by callers are not forwarded to the OS dialog. Neither blocks the verified save/export behavior; both should get their own scoped follow-up.

Run the candidate Windows workflow on the final head and inspect its new real-file/UI artifact, including the installed-mode evidence. Android installed retouch, real human portrait quality, face/body model/license proof, temporal video export disclosure, background protection, performance on real devices and R2–R4 remain outstanding. No release has been created. CPU/RAM/latency baseline-versus-after benchmarking: NOT_MEASURED.
