# KNOUX Player X Known Issues

Updated: 2026-07-31

## Release blockers

- The packaged Windows single-instance smoke test still reports that the secondary launcher remains alive. Startup-level file tracing is enabled in the current CI run to determine whether Electron blocks inside `requestSingleInstanceLock()` or returns an incorrect role.
- Clean install, in-place upgrade with user-data retention, uninstall, reinstall, and Windows 10/11 high-DPI verification do not yet have final evidence.
- The release-candidate tag must not be created and PR #9 must remain Draft until all required gates pass.

## Installer presentation

The Squirrel installer does not show the nine official screens during file installation. They are shown one at a time in the post-install first-run setup tour (fallback option C). No real installer progress is simulated or claimed.

## Vercel

KNOUX Player X is an Electron desktop application; GitHub Actions is the release path for its executable and installer. The optional Vercel configuration builds only the Vite renderer preview and does not replace or validate the desktop runtime. The connected Vercel team's current check is blocked by its build-rate limit, not by the locally verified Vite build command.

## Platform scope

The authoritative packaging gate currently targets Windows x64. macOS and Linux distributables and platform-specific runtime behavior are not release-certified by the Windows workflow.

