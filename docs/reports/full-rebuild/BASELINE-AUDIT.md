# Baseline Audit

## Scope and result

Phase 01 was inspected against supplied baseline `63beef1e38b7946e1a4207aba1dc149307035fa0`. The repository HEAD matched that commit and contains the Phase 01/02 reports, `ErrorBoundary`, `SystemOverlay`, and the KNOUX theme catalog. The required execution branch and safety tag were created without modifying production source.

**Result: PARTIAL.** This status is intentional: files being written is not evidence that build, packaging, launch, or shutdown works.

## Git baseline

- Starting branch: `work`.
- Starting and expected commit: `63beef1e38b7946e1a4207aba1dc149307035fa0`.
- Safety tag: `safety/full-rebuild-baseline-63beef1`.
- Execution branch: `codex/knoux-player-x-full-rebuild`.
- The checkout initially showed four `.cmd` files as modified only because of line-ending representation; `git diff --ignore-space-at-eol` confirmed no content change and they were restored.
- The checkout had no remote. `origin` was configured to the supplied GitHub URL, but fetch failed with `CONNECT tunnel failed, response 403`. The supplied commit therefore could not be independently compared with live `origin/main`.

## Existing functionality (not assumed verified)

The renderer exposes a shell, player, library, AI, settings, diagnostics, error recovery, and three theme presets. Electron declares main/preload boundaries and IPC handlers. These are implementation claims only until dependency-backed tests and runtime exercises pass.

## Gate evidence

| Gate | Result | Evidence |
|---|---|---|
| Node 20.20.2 | WARN | Portable Windows runtime is unavailable in Linux container; observed Node 24.15.0. |
| Dependency install | BLOCKED | No lockfile; `npm install --ignore-scripts` returned registry HTTP 403. |
| Doctor | PASS | Required baseline files present; warned Node 20 is recommended. |
| Typecheck | FAIL | Dependency type definitions are absent. |
| Lint | FAIL | Local dependencies absent; available ESLint 10 does not load `.eslintrc.json`. |
| Unit tests | FAIL | `jest` executable absent. |
| Package | NOT RUN | Cannot run meaningfully without installed dependencies. |
| Executable/launch/exit | NOT RUN | No package was produced; Windows runtime is unavailable. |

## Findings by priority

- **P0:** deterministic dependency state is absent (`package-lock.json` and `node_modules` missing); package and launch are unverified.
- **P0:** live `origin/main` could not be fetched due environment network policy.
- **P0:** portable Node 20.20.2 is not available in this Linux workspace.
- **P1:** file IPC currently exposes unrestricted renderer-selected read/write/delete paths and must not be treated as secure.
- **P2:** several services and UI features make broader capability claims than current evidence supports.
- **P3:** visible mojibake exists in metadata/source comments and must be audited for user-facing impact.

## Next action

Do not begin Phase 02 implementation until Phase 01 can be completed with a deterministic install, package, executable existence check, limited runtime smoke test, and clean exit evidence.
