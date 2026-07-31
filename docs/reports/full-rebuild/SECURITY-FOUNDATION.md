# Electron Security Foundation

## Implemented checkpoint

Phase 03 now uses a single secure desktop startup path and a reusable validation boundary for renderer-provided paths, external URLs, and launch arguments.

- External navigation accepts credential-free `https:` and `mailto:` URLs only.
- File operations require an absolute path explicitly authorized by a user file/folder selection or the operating-system launch path.
- Directory authorization uses containment checks that reject traversal outside the selected root.
- Command-line and second-instance forwarding accepts verified local media extensions only.
- Permission requests are denied by default.
- Main-window navigation is restricted to the packaged `file:` origin or the configured development server origin.
- The preload exposes a narrow, removable listener for operating-system media-open events.
- The renderer receives Open With and second-instance media paths through that listener.
- Legacy eager `SystemOrchestrator` startup was removed from the production main process.
- AI and media-processing providers are initialized only through the optional creative-service boundary.
- Window and external-link IPC handlers are registered explicitly in the main process.
- Placeholder application-menu and tray commands were removed; every remaining visible command performs a real action.
- Playback history now increments a play count once per bounded playback session instead of every periodic position checkpoint.

## Windows validation path

`.github/workflows/full-rebuild-windows.yml` is the authoritative Windows 2022 validation path. It fixes Node at 20.20.2, configures Python 3.12/MSVC 2022, creates and persists a deterministic lockfile when required, uses `npm ci`, rebuilds native Electron modules, runs all quality gates, makes the package and installer, smoke-tests the executable, verifies media-process cleanup, hashes artifacts, and uploads the output.

`.github/workflows/generate-lockfile.yml` remains a branch-restricted recovery path. No token or credential is embedded in the repository; GitHub Actions uses the scoped `GITHUB_TOKEN`.

## Required release evidence

The security implementation is complete at source level. Release status remains pending until the latest branch head proves all of the following on Windows CI:

- deterministic dependency installation;
- TypeScript and zero-warning ESLint;
- unit/integration tests;
- Electron package and installer creation;
- packaged executable launch;
- clean shutdown with no KNOUX, Electron, FFmpeg, or FFprobe orphan process;
- non-empty artifacts and SHA-256 manifest.

**Status: IMPLEMENTED — WINDOWS RELEASE GATES PENDING.**
