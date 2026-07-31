# KNOUX Player X Full Rebuild Task Board

Updated: 2026-07-31 08:00 UTC

This board is the authoritative phase ledger. A phase advances only after every required gate passes. Engineering foundations may proceed in parallel when they do not bypass P0/P1 acceptance gates.

| Phase | Task | Priority | Status | Dependencies | Remaining errors |
|---:|---|---|---|---|---|
| 01 | TASK-01: Repository Audit and Verified Baseline | P0 | **PARTIAL** | None | Automated Windows package/runtime evidence is green; clean-install evidence remains |
| 02 | TASK-02: Dependency and Native Module Stabilization | P0 | **PASS** | PHASE 01 | Deterministic Windows install, native rebuild, packaging, and runtime loading passed |
| 03 | TASK-03: Electron Architecture and Security Foundation | P0 | **PARTIAL** | PHASE 02 PASS | Remaining full IPC payload audit and manual security review |
| 04 | TASK-04: KNOUX Design System and Visual Shell | P3 | **IN_PROGRESS** | PHASE 03 | Visual/keyboard/high-DPI automation pending |
| 05 | TASK-05: Production Video and Audio Playback | P1 | **IN_PROGRESS** | PHASE 03, PHASE 04 | Full codec and long-playback regression pending |
| 06 | TASK-06: Local Media Library and Database | P1 | **IN_PROGRESS** | PHASE 05 | Migration, restart persistence, and large-scan regression pending |
| 07 | TASK-07: Queue, Playlists, History and Favorites | P2 | **IN_PROGRESS** | PHASE 05 PASS, PHASE 06 PASS | Persistent queue workspace exists; playlists/history/favorites integration and persistence regression remain |
| 08 | TASK-08: Subtitles, Audio Tracks and Chapters | P2 | **PENDING** | PHASE 05 PASS, PHASE 06 PASS | None |
| 09 | TASK-09: KNOUX AI and Smart Tools | P2/P4 | **PENDING** | PHASE 06 PASS, PHASE 08 PASS | None |
| 10 | TASK-10: Settings, Arabic, English and Accessibility | P3 | **IN_PROGRESS** | PHASE 04–09 | Arabic/English creative UI is wired; keyboard, overflow, and persisted-switch regression pending |
| 11 | TASK-11: Performance, Stability and Runtime Modernization | P1/P2 | **PENDING** | PHASE 05 PASS, PHASE 06 PASS, PHASE 07 PASS, PHASE 08 PASS, PHASE 09 PASS, PHASE 10 PASS | None |
| 12 | TASK-12: Windows Installer and System Integration | P0 | **IN_PROGRESS** | PHASE 01–11 | Squirrel package/make and Open With pass; clean install, upgrade, uninstall, and reinstall pending |
| 13 | TASK-13: Full Regression Testing and Final Cleanup | P0 | **PENDING** | PHASE 01–12 PASS | None |
| 14 | TASK-14: Original Main Merge Gate | P0 | **PENDING (SUPERSEDED)** | TASK-19 is the authoritative release gate | Release cannot occur before Creative Suite tasks pass |
| 15 | TASK-15: Iconography, Accessories and Desktop Experience | P2 | **IN_PROGRESS** | PHASE 04, PHASE 05 | Icon reproducibility passes; remaining accessory and high-DPI verification pending |
| 16 | TASK-16: Screenshot, Frame Capture and Media Recording | P1/P2 | **IN_PROGRESS** | PHASE 03, PHASE 05 | Frame, burst, contact sheet, and recording services exist; player-area recording and Windows UI automation pending |
| 17 | TASK-17: KNOUX Smart Editor and Export Pipeline | P1/P2 | **IN_PROGRESS** | PHASE 05, PHASE 06 | Preview, markers, zoom, shortcuts, persistence, and range export exist; drag/resize, composition export, migration, and Windows UI automation pending |
| 18 | TASK-18: Extended Languages and Global UX | P3 | **PENDING** | PHASE 10, TASK-16, TASK-17 | Begins after Arabic/English and creative UI stabilize |
| 19 | TASK-19: Creative Suite Regression and Final Release Merge | P0 | **PENDING** | TASK-01 through TASK-18 PASS | Final regression, installer, merge, and RC tag pending |

## Phase 01 evidence

- **Implemented:** auditable task board and baseline inventories.
- **Integrated:** Phase 01/02 reports and curated interface foundations are already present in `main`.
- **Preserved:** baseline source and existing behavior.
- **Tests run:** doctor, typecheck, lint, unit-test command, and dependency-install attempt in the restricted environment.
- **Failed:** dependency-backed gates could not complete in that environment.
- **Fixed:** a Windows 2022 validation path and lockfile-generation workflow are included in PR #7.
- **Remaining:** obtain authoritative Windows CI package/runtime evidence.
- **Build/launch:** not yet promoted to PASS.

## Implementation checkpoint — dependency and Electron security

- Added Windows 2022 workflows for deterministic lockfile recovery and native/package validation.
- Added an authorized-path registry, traversal protection, strict external protocols, permission denial, navigation restrictions, and focused unit coverage.
- Added command-line and second-instance media forwarding protected by a conservative extension allowlist.
- Fixed recursive application shutdown behavior.
- Phase 02 remains `IN_PROGRESS` and Phase 03 remains `PARTIAL` until Windows CI and remaining security controls pass.

## Creative Media Suite extension

The final merge and release-candidate gate is **TASK-19**. TASK-14 is retained only as historical planning context and cannot authorize release.

- TASK-15: verified iconography and desktop accessories.
- TASK-16: screenshot, frame capture, and recording integration.
- TASK-17: non-destructive editor and export pipeline.
- TASK-18: extended languages and global UX.
- TASK-19: creative-suite regression, final merge, and release candidate.

## Windows and creative workspace checkpoint — 2026-07-31

- Branch commit: `610c1ce81137616638a967f9fbf9740591f6d9de`.
- Windows workflow: `KNOUX Full Rebuild Windows`, run `30614286539`, conclusion `success`.
- Automated quality: 10 Jest suites / 43 tests, TypeScript PASS, ESLint zero warnings.
- Packaged runtime: Electron 32.3.3 x64, Squirrel installer, FFmpeg/FFprobe 6.1.1, SQLite native runtime, Open With/single-instance, launch, and cleanup PASS.
- Installer artifact: ID `8786797516`, 224,499,477 bytes, digest `sha256:c24c926d574ebf609f73475afe2e234f1c5cef62c392485e5c1a8bcaaa892f93`; inner setup SHA-256 `7E1A3AFC0769F403AFCFB2D5A4AD0AD670DCDE77929821FEA153826FE56C98CE`.
- Creative UI: Arabic/English Capture, Recording, Editor, and Export workspaces are connected to local services.
- Editor: recent projects, autosave recovery, relink, deterministic reorder/reflow, trim/split, preview, markers, zoom, keyboard shortcuts, undo/redo, and Save/Save As are operational.
- Release decision: PR #9 remains Draft. Clean install/upgrade/uninstall/reinstall, high-DPI, and remaining creative UI automation are still required.
