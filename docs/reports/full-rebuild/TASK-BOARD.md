# KNOUX Player X Full Rebuild Task Board

Updated: 2026-07-30 20:50 UTC

This board is the authoritative phase ledger. A phase advances only after every required gate passes. Engineering foundations may proceed in parallel when they do not bypass P0/P1 acceptance gates.

| Phase | Task | Priority | Status | Dependencies | Remaining errors |
|---:|---|---|---|---|---|
| 01 | TASK-01: Repository Audit and Verified Baseline | P0 | **PARTIAL** | None | Authoritative Windows install, package, executable, launch, and clean-exit evidence pending |
| 02 | TASK-02: Dependency and Native Module Stabilization | P0 | **IN_PROGRESS** | PHASE 01 PASS | Lockfile generation and Windows native/package evidence pending |
| 03 | TASK-03: Electron Architecture and Security Foundation | P0 | **PARTIAL** | PHASE 02 PASS | Remaining IPC payload validation, safeStorage, CSP, trusted-frame checks, and Windows evidence |
| 04 | TASK-04: KNOUX Design System and Visual Shell | P3 | **PENDING** | PHASE 03 PASS | None |
| 05 | TASK-05: Production Video and Audio Playback | P1 | **PENDING** | PHASE 03 PASS, PHASE 04 PASS | None |
| 06 | TASK-06: Local Media Library and Database | P1 | **PENDING** | PHASE 05 PASS | None |
| 07 | TASK-07: Queue, Playlists, History and Favorites | P2 | **PENDING** | PHASE 05 PASS, PHASE 06 PASS | None |
| 08 | TASK-08: Subtitles, Audio Tracks and Chapters | P2 | **PENDING** | PHASE 05 PASS, PHASE 06 PASS | None |
| 09 | TASK-09: KNOUX AI and Smart Tools | P2/P4 | **PENDING** | PHASE 06 PASS, PHASE 08 PASS | None |
| 10 | TASK-10: Settings, Arabic, English and Accessibility | P3 | **PENDING** | PHASE 04 PASS, PHASE 05 PASS, PHASE 06 PASS, PHASE 07 PASS, PHASE 08 PASS, PHASE 09 PASS | None |
| 11 | TASK-11: Performance, Stability and Runtime Modernization | P1/P2 | **PENDING** | PHASE 05 PASS, PHASE 06 PASS, PHASE 07 PASS, PHASE 08 PASS, PHASE 09 PASS, PHASE 10 PASS | None |
| 12 | TASK-12: Windows Installer and System Integration | P0 | **PENDING** | PHASE 01–11 PASS | None |
| 13 | TASK-13: Full Regression Testing and Final Cleanup | P0 | **PENDING** | PHASE 01–12 PASS | None |
| 14 | TASK-14: Original Main Merge Gate | P0 | **SUPERSEDED** | TASK-19 is the authoritative release gate | Release cannot occur before Creative Suite tasks pass |
| 15 | TASK-15: Iconography, Accessories and Desktop Experience | P2 | **PENDING** | PHASE 04, PHASE 05 | Verified icon generation and operational accessory integration pending |
| 16 | TASK-16: Screenshot, Frame Capture and Media Recording | P1/P2 | **IN_PROGRESS** | PHASE 03, PHASE 05 | Renderer integration, permissions, output, and packaged runtime evidence pending |
| 17 | TASK-17: KNOUX Smart Editor and Export Pipeline | P1/P2 | **IN_PROGRESS** | PHASE 05, PHASE 06 | Persistence, timeline UI, FFmpeg worker, export probing, and packaging pending |
| 18 | TASK-18: Extended Languages and Global UX | P3 | **PENDING** | PHASE 10, TASK-16, TASK-17 | Begins after Arabic/English and creative UI stabilize |
| 19 | TASK-19: Creative Suite Regression and Final Release Merge | P0 | **PENDING** | TASK-01 through TASK-18 PASS | Final regression, installer, merge, and RC tag pending |

## Phase 01 evidence

- **Implemented:** auditable task board and baseline inventories.
- **Integrated:** Phase 01/02 reports and curated interface foundations are already present in `main`.
- **Preserved:** baseline source and existing behavior.
- **Tests run:** doctor, typecheck, lint, unit-test command, and dependency-install attempt in the restricted environment.
- **Failed:** dependency-backed gates could not complete in that environment.
- **Fixed:** a Windows 2022 validation path and lockfile-generation workflow are included in the current change set.
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
