# KNOUX Player X Known Issues

Updated: 2026-07-31

## Release blockers

- Clean install, in-place upgrade with user-data retention, uninstall, reinstall, and Windows 10/11 high-DPI verification do not yet have final evidence.
- Player-area recording, direct editor drag/resize, and full editor composition export remain incomplete.
- Windows UI automation is still required for recording, capture output, autosave recovery, relink, and Arabic/Unicode path workflows.
- The release-candidate tag must not be created and PR #9 must remain Draft until every required manual and automated release gate passes.

## Resolved Windows startup gate

Windows workflow run `30614286539` is green on commit `610c1ce81137616638a967f9fbf9740591f6d9de`. It verifies deterministic install, 10 Jest suites / 43 tests, Electron package and Squirrel make, packaged FFmpeg/FFprobe, primary launch, Open With forwarding through a terminating second instance, primary survival, clean shutdown, and split artifact upload.

## Installer presentation

The Squirrel installer does not show the nine official screens during file installation. They are shown one at a time in the post-install first-run setup tour (fallback option C). No real installer progress is simulated or claimed.

## Artifact access

Run `30614286539` publishes a downloadable installer artifact, `knoux-windows-installer-0a46edfd245e0d4c2b06260c3a125eb085b231e5` (artifact ID `8786797516`, 224,499,477 bytes, artifact digest `sha256:c24c926d574ebf609f73475afe2e234f1c5cef62c392485e5c1a8bcaaa892f93`). The inner `KNOUX Player X-2.0.0 Setup.exe` SHA-256 is `7E1A3AFC0769F403AFCFB2D5A4AD0AD670DCDE77929821FEA153826FE56C98CE`. A separate 2 MB evidence artifact is also available as artifact ID `8786797858`.

## Vercel

KNOUX Player X is an Electron desktop application; GitHub Actions is the release path for its executable and installer. The optional Vercel configuration builds only the Vite renderer preview and does not replace or validate the desktop runtime. The current Vercel team no longer lists a KNOUX X project or project link, so connector deployment returns `INVALID_ARGUMENT`; a new preview requires explicitly linking or recreating that Vercel project. The local production Vite renderer build is green.

## Platform scope

The authoritative packaging gate currently targets Windows x64. macOS and Linux distributables and platform-specific runtime behavior are not release-certified by the Windows workflow.
