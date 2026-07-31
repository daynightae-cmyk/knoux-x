# KNOUX Player X Known Issues

Updated: 2026-07-31

## Release blockers

- Clean install, in-place upgrade with user-data retention, uninstall, reinstall, and Windows 10/11 high-DPI verification do not yet have final evidence.
- Capture burst/contact-sheet controls, player-area recording, editor preview/markers/zoom, and editor composition export remain incomplete.
- Windows UI automation is still required for recording, capture output, autosave recovery, relink, and Arabic/Unicode path workflows.
- The release-candidate tag must not be created and PR #9 must remain Draft until every required manual and automated release gate passes.

## Resolved Windows startup gate

Windows workflow run `30609881686` is green on commit `c72112aa2fc5ffb9cc2927adb9bee5f1bd3d3fc4`. It verifies deterministic install, 9 Jest suites / 36 tests, Electron package and Squirrel make, packaged FFmpeg/FFprobe, primary launch, Open With forwarding through a terminating second instance, primary survival, clean shutdown, and artifact upload.

## Installer presentation

The Squirrel installer does not show the nine official screens during file installation. They are shown one at a time in the post-install first-run setup tour (fallback option C). No real installer progress is simulated or claimed.

## Artifact access

The Windows artifact from run `30609881686` is `knoux-windows-8a68cc0603ff9b3c463355d0ea44fd97566ff9f5` (artifact ID `8785124651`, digest `sha256:53ea22079ff25bce14b1a11da209ba94b83d9c24f23737544ec407675a90a4e2`). Its combined archive is about 683 MB; future workflow work should split installer and unpacked application artifacts for easier download.

## Vercel

KNOUX Player X is an Electron desktop application; GitHub Actions is the release path for its executable and installer. The optional Vercel configuration builds only the Vite renderer preview and does not replace or validate the desktop runtime. A prior preview is Ready, while newer connected checks are blocked by the free deployment-rate limit rather than a renderer build failure.

## Platform scope

The authoritative packaging gate currently targets Windows x64. macOS and Linux distributables and platform-specific runtime behavior are not release-certified by the Windows workflow.
