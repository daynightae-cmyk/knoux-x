# KNOUX Player X — Sprint 01 verification

Final result: **PASS**, pending independent Evaluator review.

- Branch: `fix/native-runtime-and-creative-suite-completion`
- Final HEAD: `e9ff96d1c6ab63ac2c6a6efc47c2d0ca42b7358e`
- Base: `db922069d7a4e01fc9858a7f31f75b71874a9faa`
- Scope: 50 tracked files, 3,718 insertions, 712 deletions
- Tests: 30 suites / 241 tests passed
- IPC schema: 165 keyed invokes plus 5 inbound listeners and 17 outbound events; concrete machine-readable shapes and bidirectionally verified production source roots
- IPC source parity: all 187 manifest entries exactly match production constant-use roots; six subscriber-only outbound declarations are explicitly reserved with concrete reasons
- IPC startup: Ready; 165 exposed invoke channels; 165 unique registered handlers; zero missing; zero duplicates
- Inbound listeners: all 5 declared listener channels represented, including renderer-ready and dynamic capture/recording selectors
- Packaged bridge: all expected namespaces present; immutable desktop descriptor; main and smoke renderers initialized through the real ASAR preload
- Packaged operations: settings get/set/get/get-all/export/reset/import/cleanup; open/save cancellation; authorized exists; system/build/health
- Window security: main and smoke runtime preferences confirm Node off, context isolation on, sandbox on, web security on, insecure content off
- Browser preview: real headless Chrome reports `web-preview`, no Electron process or native claim, and a visible unobstructed Browser preview badge

## Package bindings

| Artifact | Absolute path | SHA-256 |
|---|---|---|
| Executable | `D:\Knoux-X-Bootstrap\repository\out\KNOUX Player X-win32-x64\knoux-player-x.exe` | `73487eb7487b6fc96e708298a6efbb132f3273a4010be908a79f4b4830a002fa` |
| ASAR | `D:\Knoux-X-Bootstrap\repository\out\KNOUX Player X-win32-x64\resources\app.asar` | `12cd80e2bfbf4f71cb2e772ecbdec294bbb99f29d851466a1c4c32f0ea41ff4d` |
| Package manifest | `D:\Knoux-X-Bootstrap\repository\reports\native-completion\sprint-01\asar-inspection\package.json` | `8a94cd58e73651e9d88e599807ed1792291ff60ed3d1ba180611516ada7cee66` |
| Configured main entry | `D:\Knoux-X-Bootstrap\repository\reports\native-completion\sprint-01\asar-inspection\main-entry.js` | `0f45e00af3103a0c21478a483549b29459bd808f883bbeb7fed8af9d5fb3b1b4` |
| Main runtime bundle | `D:\Knoux-X-Bootstrap\repository\reports\native-completion\sprint-01\asar-inspection\main-runtime.js` | `947de0fb3aa5a78280ea07cc1f2344fa189357f76caa03f6e86720961e90fb2c` |
| Preload bundle | `D:\Knoux-X-Bootstrap\repository\reports\native-completion\sprint-01\asar-inspection\preload-entry.js` | `7f9ed3e49981aa5d1d2d1d072e0f3ea53ddb74d485a12daa1b3ebf07a3d877ad` |

## Evidence index

- `verification-commands.json` — exact final command ledger
- `ipc-manifest.json` — typed all-direction manifest with ownership/exposure/registration counts and source roots
- `ipc-health.json` — packaged startup health report
- `packaged-ipc-runtime.json` — raw packaged renderer and main runtime proof
- `packaged-ipc-smoke.json` — ASAR/executable hashes plus combined packaged proof
- `packaged-ipc-smoke.log` — packaged process log
- `asar-inspection/` — extracted package manifest, configured main bootstrap, resolved main runtime, and preload
- `browser-preview.json` / `browser-preview.png` / `browser-preview-stages.log` — real-browser runtime, occlusion, and visible screenshot proof

One non-product browser console message records the CSP correctly blocking the external Google Fonts stylesheet. There are zero browser page errors and zero Electron/contextBridge errors.
