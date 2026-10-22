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

### Exact implementation files

| File | Change |
| --- | --- |
| `src/features/image-studio/documentCommands.ts` | Shared, awaited project save and image export delivery |
| `src/features/image-studio/ImageStudioView.tsx` | Keyboard shortcuts use the shared save command and pending-operation guard |
| `src/features/image-studio/components/ImageStudioToolbar.tsx` | Shared save/export handlers; clear destination on new image import |
| `src/features/image-studio/components/ImageStudioExportDialog.tsx` | Real file delivery, document-sized defaults, disabled duplicate actions |
| `src/core/image-studio/export/plan.ts` | Browser-safe export planning and dimension validation |
| `src/core/image-studio/export/export.ts` | Reuse/re-export planner while retaining backend encoders |
| `tests/unit/image-studio-document-commands.test.ts` | Save/export cancellation, errors, races, destination and dirty-state regression tests |
| `tests/unit/image-studio-export.test.ts` | Non-finite dimension regression tests |
| `tests/integration/image-studio-project-lifecycle.test.ts` | Real service/disk/masked-pixel/restart/export acceptance without network calls |
| `tools/verify-image-studio-project-lifecycle.cjs` | Actual Electron UI driver; automates only OS pickers and records failures |
| `.github/workflows/full-rebuild-windows.yml` | Runs the UI driver against the existing built checkout and preserves evidence, including on failure; does not add another build |

The existing Image Studio store, retouch operations, masks, renderer, `syncRetouch` preload/IPC, `ImageStudioService`, persistence envelope, Sharp codecs and authorized file bridge are retained. No replacement editor or AI engine was introduced.

## Capability matrix

| Feature | Existing path / handler | Processing and export | Evidence / status |
| --- | --- | --- | --- |
| Desktop project save | `ImageStudioView` / `ImageStudioToolbar` → `saveStudioProject` → `syncRetouch` / save IPC | Existing service + integrity envelope | VERIFIED in Node; Electron Linux import BLOCKED |
| Flattened/layer export delivery | Toolbar / ExportDialog → `exportStudioImage` | Existing backend retouch/compositor/Sharp → authorized file write | VERIFIED real Node output for flattened PNG/JPEG/WebP; layer dispatch unit-tested |
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
| `node node_modules/vite/bin/vite.js build --config vite.renderer.config.ts --outDir .vite/renderer/main_window` | PASS; 2283 modules, 2m 4s |
| `node --check tools/verify-image-studio-project-lifecycle.cjs` | PASS |
| Electron image lifecycle on Linux | FAILED at image import: independently reproduced native Sharp/libvips assertion; no full GUI-flow pass claimed |
| New Windows UI lifecycle CI step | Added, NOT_RUN locally; it verifies the built source checkout, not installed acceptance |
| Candidate Windows packaged / Android installed retouch acceptance | NOT_TESTED |

The full suite and additional integration test are separate invocations: 170 suites / 1469 tests passed across them, not a single 170-suite run. The initial slow integration attempt was stopped while optimizing byte comparison in the test; its replacement completed successfully without weakening pixel assertions.

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

R1 is implemented and locally source/build/Node-verified; native application acceptance is incomplete. Do not represent the whole Retouch mission as complete. Do not merge merely because the build or baseline CI is green.

Run the candidate Windows workflow and inspect its new real-file/UI artifact. Windows packaged retouch, Android installed retouch, real human portrait quality, face/body model/license proof, temporal video export disclosure, background protection, performance on real devices and R2–R4 remain outstanding. No release has been created. CPU/RAM/latency baseline-versus-after benchmarking: NOT_MEASURED.
