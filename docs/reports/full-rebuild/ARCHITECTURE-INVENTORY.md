# Architecture Inventory

## Build and entrypoints

- Package manifest: `package.json`; no lockfile is present.
- Electron Forge: `forge.config.js`, using Vite, native unpacking, fuses, Squirrel (Windows), and ZIP (macOS/Linux).
- Vite: `vite.main.config.ts`, `vite.preload.config.ts`, and `vite.renderer.config.ts`.
- TypeScript: strict `tsconfig.json`.
- ESLint: legacy `.eslintrc.json` with warnings that become failures under the required zero-warning gate.
- Canonical main entry candidate: `electron/main.ts`.
- Canonical preload candidate: `electron/preload.ts`.
- Canonical IPC layer candidate: `electron/ipc/setup.ts`.
- Canonical renderer entry: `src/main.tsx`; root shell: `src/App.tsx`.

## Subsystems

| Subsystem | Current candidate | Verification note |
|---|---|---|
| Orchestration | `src/core/orchestrator/SystemOrchestrator.ts` | Imported by Electron main; runtime unverified. |
| Player | `src/core/services/player/PlayerService.ts` | Canonical candidate; real playback unverified. |
| Video | `src/core/services/video/VideoEngine.ts` | Separate engine coordinated by orchestrator. |
| Audio | `src/core/services/audio/AudioEngine.ts` | Separate engine coordinated by orchestrator. |
| Library | `src/core/services/library/LibraryManager.ts` | No canonical SQLite service or migrations found. |
| Playlist | `src/core/services/playlist/PlaylistManager.ts` | Persistence unverified. |
| Subtitles | `src/core/services/subtitle/SubtitleEngine.ts` | Parser/rendering claims unverified. |
| Settings | `src/core/services/settings/SettingsManager.ts` | Schema/migration and secret boundary unverified. |
| AI | `GeminiService.ts`, `OpenRouterService.ts` | Duplicate provider-specific implementations; nominate a future disabled-by-default provider abstraction. |
| Security | `src/core/security/SecurityManager.ts` | Does not replace main-process IPC/path enforcement. |
| State | `src/store/appStore.ts`, `src/store/playerStore.ts` | Separate domain stores; not duplicate entrypoints. |
| Diagnostics | `ErrorBoundary`, `SystemOverlay`, `runtimeDiagnostics.ts` | Curated Phase 02 integration is present. |

## Duplicate and unsupported architecture findings

No alternate main, preload, player, or database entrypoint was found in the checked-in tree. AI has two provider-specific services but no single privacy-safe abstraction. Database dependencies exist in the manifest, while no database service or migration implementation was found. Empty placeholder directories exist but were not deleted because usage and future architecture have not been proven.

## Assets and installer

`assets/logo.png` is present. Forge conditionally expects `assets/icons/app-icon.ico`, but no verified icon tree was found. Squirrel configuration exists, although no Windows installer artifact has been built or tested in this environment.
