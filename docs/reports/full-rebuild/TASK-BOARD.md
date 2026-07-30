# KNOUX Player X Full Rebuild Task Board

Updated: 2026-07-30 20:00 UTC

This board is the authoritative phase ledger. A phase advances only after every required gate passes. The current environment cannot complete Phase 01, so no later phase has started.

| Phase | Task | Priority | Status | Dependencies | Remaining errors |
|---:|---|---|---|---|---|
| 01 | TASK-01: Repository Audit and Verified Baseline | P0 | **PARTIAL** | None | origin fetch blocked by HTTP 403 in this environment; Portable Node 20 is unavailable; system Node is v24.15.0; package-lock.json and node_modules are absent; Dependency install blocked by npm registry HTTP 403; Typecheck, lint, tests, package, executable and launch gates cannot pass without dependencies |
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
| 12 | TASK-12: Windows Installer and System Integration | P0 | **PENDING** | PHASE 01 PASS, PHASE 02 PASS, PHASE 03 PASS, PHASE 04 PASS, PHASE 05 PASS, PHASE 06 PASS, PHASE 07 PASS, PHASE 08 PASS, PHASE 09 PASS, PHASE 10 PASS, PHASE 11 PASS | None |
| 13 | TASK-13: Full Regression Testing and Final Cleanup | P0 | **PENDING** | PHASE 01 PASS, PHASE 02 PASS, PHASE 03 PASS, PHASE 04 PASS, PHASE 05 PASS, PHASE 06 PASS, PHASE 07 PASS, PHASE 08 PASS, PHASE 09 PASS, PHASE 10 PASS, PHASE 11 PASS, PHASE 12 PASS | None |
| 14 | TASK-14: Main Merge and Release Candidate Preparation | P0 | **PENDING** | PHASE 01 PASS, PHASE 02 PASS, PHASE 03 PASS, PHASE 04 PASS, PHASE 05 PASS, PHASE 06 PASS, PHASE 07 PASS, PHASE 08 PASS, PHASE 09 PASS, PHASE 10 PASS, PHASE 11 PASS, PHASE 12 PASS, PHASE 13 PASS | None |

## Phase 01 evidence

- **Implemented:** auditable task board and baseline inventories.
- **Integrated:** no source integration was performed.
- **Preserved:** baseline source and existing behavior; no production module was rewritten.
- **Tests run:** doctor, typecheck, lint, unit test command, and dependency install attempt.
- **Failed:** dependency installation and all dependency-backed gates.
- **Fixed:** configured the missing `origin` remote locally and created the required execution branch.
- **Remaining:** restore network/package access and portable Node 20, install from a committed lockfile, then rerun all package/runtime gates.
- **Build/launch:** not verified; Phase 01 remains `PARTIAL`.

## Implementation checkpoint — dependency and Electron security

- Added Windows 2022 workflows for deterministic lockfile recovery and complete native/package validation.
- Added an authorized-path registry, traversal protection, strict external protocols, permission denial, navigation restrictions, and focused unit coverage.
- Added command-line and second-instance media forwarding and protected it with a conservative extension allowlist.
- Fixed recursive application shutdown behavior.
- Phase 02 remains `IN_PROGRESS` and Phase 03 remains `PARTIAL` until authoritative Windows CI and the remaining security controls pass.

## Creative Media Suite extension

The final merge and release-candidate gate moves to **TASK-19**. The former TASK-14 cannot authorize a release before TASK-15 through TASK-18 pass.

| Task | Priority | Status | Objective | Current evidence |
|---|---|---|---|---|
| TASK-15 | P2 | **PENDING** | Iconography, Accessories and Desktop Experience | Awaiting verified icon generation and operational accessory integration. |
| TASK-16 | P1/P2 | **IN_PROGRESS** | Screenshot, Frame Capture and Media Recording | Capture naming, timestamp conversion, supported image payload validation, and recording state transitions implemented with tests. |
| TASK-17 | P1/P2 | **IN_PROGRESS** | KNOUX Smart Editor and Export Pipeline | Versioned non-destructive project validation, trim, split, duration, and isolated undo/redo core implemented with tests. |
| TASK-18 | P3 | **PENDING** | Extended Languages and Global UX | Begins after the mandatory Arabic/English foundation and creative UI stabilize. |
| TASK-19 | P0 | **PENDING** | Creative Suite Regression and Final Release Merge | Requires TASK-01 through TASK-18 PASS. |
