# Phase 3A Runtime Status

## Current Verdict

> **PHASE 3A PORTRAIT RUNTIME: PASS for the required real Electron acceptance.**

The former high-resolution proxy failure was a **harness interaction defect**, not a product defect. The range element had been measured before it was brought into view, so Playwright's page-level mouse coordinates were not guaranteed to target the visible thumb. The acceptance harness now scrolls the real range control into view and hovers it before obtaining its bounding box and executing the real mouse-down, incremental moves, proxy observation, and mouse-up sequence.

The acceptance ran under the project-local, untracked Node **v20.20.2** binary in `_toolchains/node-v20.20.2-win-x64`, whose downloaded archive was SHA-256 verified against Node's official checksum file. Electron Forge x64 packaging succeeded under this runtime. The Electron acceptance then passed in full, with no engine calls, store injection, forced interaction, or synthetic input/change dispatch used for the proxy gesture.

| Gate | Result |
|---|---|
| Node runtime | PASS — v20.20.2 project-local portable runtime |
| TypeScript | PASS |
| Focused retouch engine + Phase 3 integration tests | PASS — 39 tests across 2 suites |
| Electron Forge x64 package | PASS |
| Real Electron D0–D6 pixel progression | PASS |
| Undo/Redo exactness | PASS |
| Before/After | PASS, state unchanged |
| Layer isolation | PASS |
| Save/Reopen | PASS |
| Full-resolution PNG export | PASS, exact pixel comparison |
| High-resolution Proxy → Final | PASS |
| Stale supersession | PASS |
| `git diff --check` | PASS |
| Full Jest run | PASS — 88 suites, 942 tests |

## Electron Acceptance Evidence

The deterministic small portrait fixture was **400×533**. The real Electron state hashes were:

| State | SHA-256 |
|---|---|
| D0 Baseline | `d2467121576296f74a0a0f2a3dc0ea5e13f6a6ab3a8c796ece46e920cb405f7d` |
| D1 Makeup Tint | `139934a8060ae121f0c31adbd93ccf29735b4e600eb5fdab9a73a36d4ccc00bb` |
| D2 Makeup Glow | `8372ed0f3e5c916de3211570251a0ffafbafcae58c703ba57fb64ab7d791d6fa` |
| D3 Geometry Warp | `76e070d0ee7981902ab6fdeb92134a8d6421af156af96500a4fbf7054f465f2a` |
| D4 Manual Smooth | `22e590e68b83779c3bb2bd01335756479292eaa7d68e8b99883e068ba979a290` |
| D5 Manual Healing | `282f4c497e1f801cd7da24bcb2077dab6efe681c12831e7b188845ccb56fd689` |
| D6 Dodge/Burn | `4751cb4e8582d2a750fa8c7683ae4cc65606ba46ebb421cf076f927f273b0745` |

The high-resolution local proxy fixture was **1200×1599**. While the real range thumb was held down, the renderer reported `preview` and the proxy path, yielding SHA-256 `73819152af2c0a24d50f343cfc5e5cb1b44ddff39dbbb3d81f8dbc995cc13583`. After mouse-up and transaction commit, the full-resolution result was **1200×1599** with SHA-256 `45ebbed6d097aa6773d4d64aabf978fc6e7d97243c1840fdea03d451a5c01780`. The stale-supersession check found the stable final hash exactly equal to this final C value.

The complete raw evidence is recorded in `_temp/live-evidence/retouch-phase3-runtime-smoke.json`. The high-resolution acceptance records `proxyQuality: "preview"`, `finalQuality: "final"`, and `verified: true`.

## Preserved Manual-Tool Semantics

Manual Heal is byte-identical when armed but missing a valid source/target, and becomes a localized edit only after a real canvas gesture. Manual Smooth and Dodge/Burn are likewise pixel-neutral before their first valid stroke. The retouch store does not create an independent undo history snapshot merely from arming a manual brush; the first gesture owns the transaction.

## Temporary Instrumentation

Temporary UI and canvas trace events were used to distinguish a product defect from a harness defect, then removed from production source before the final Electron package and acceptance run. The permanent harness correction is limited to ensuring the actual slider is scrolled into view and hovered before calculating pointer coordinates.

## Phase 3B Gate

The Electron acceptance, `git diff --check`, and final Node 20 full Jest run are complete. The full Jest result is **88 suites and 942 tests passing**. The Phase 3A quality gate is closed and Phase 3B work may begin.
