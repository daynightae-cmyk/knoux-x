# Electron Security Foundation

## Implemented checkpoint

This checkpoint begins Phase 03 implementation without claiming the phase complete. It adds a single reusable validation boundary for renderer-provided paths, external URLs, and launch arguments.

- External navigation accepts credential-free `https:` and `mailto:` URLs only.
- File operations require an absolute path explicitly authorized by a user file/folder selection or the operating-system launch path.
- Directory authorization uses containment checks that reject traversal outside the selected root.
- Command-line and second-instance forwarding accepts only the browser-verified baseline containers `.mp4`, `.webm`, `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, and `.flac`.
- Permission requests are denied by default.
- Main-window navigation is restricted to the packaged `file:` origin or the configured development server origin.
- The preload exposes a narrow, removable listener for operating-system media-open events.
- Shutdown is guarded against recursive `before-quit` handling.

## Windows validation path

`.github/workflows/full-rebuild-windows.yml` is the authoritative Windows 2022 validation path. It fixes Node at 20.20.2, configures Python 3.12/MSVC 2022, uses `npm ci`, rebuilds native Electron modules, runs all quality gates, makes the package and installer, smoke-tests the executable, checks process cleanup, hashes artifacts, and uploads the output.

Because the repository still lacks a lockfile, `.github/workflows/generate-lockfile.yml` provides a manual, branch-restricted path that generates and validates the lockfile with Node 20.20.2 and commits only `package-lock.json` using `GITHUB_TOKEN`. No token or credential is embedded in the repository.

## Remaining Phase 03 work

- Validate every non-file IPC payload and bind requests to trusted renderer frames.
- Replace renderer settings storage of AI credentials with main-process `safeStorage`.
- Remove provider SDKs from the normal startup path and make AI disabled by default.
- Add CSP response headers and logging rotation/redaction.
- Run the focused Jest suite and Windows packaged runtime workflow after the lockfile workflow succeeds.

**Status: PARTIAL.** No package, installer, or runtime PASS is asserted without CI evidence.
