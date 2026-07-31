# KNOUX Player X Known Issues

Updated: 2026-07-31

## Release blockers

- Clean install, in-place upgrade with user-data retention, uninstall, reinstall, and Windows 10/11 high-DPI verification do not yet have final evidence.
- Player-area recording, direct editor drag/resize, and full editor composition export remain incomplete.
- Windows UI automation is still required for recording, capture output, autosave recovery, relink, and Arabic/Unicode path workflows.
- The release-candidate tag must not be created and PR #9 must remain Draft until every required manual and automated release gate passes.

## Resolved Windows startup gate

Windows workflow run `30615732971` is green on commit `427aeae77f3277f365cfe36ff2df6f3a16272e3c`. It verifies deterministic install, 10 Jest suites / 43 tests, Electron package and Squirrel make, packaged FFmpeg/FFprobe, primary launch, Open With forwarding through a terminating second instance, primary survival, clean shutdown, and split artifact upload.

## Installer presentation

The Squirrel installer does not show the nine official screens during file installation. They are shown one at a time in the post-install first-run setup tour (fallback option C). No real installer progress is simulated or claimed.

## Artifact access

Run `30615732971` publishes a downloadable installer artifact, `knoux-windows-installer-2b48ab943debeeaecebf69d4f73feab61bceb19b` (artifact ID `8787379658`, 224,499,821 bytes, artifact digest `sha256:4d9a9c799f72115bf9753c56bc309cfad22df699d5aea23315a7dd7d8b7cf56a`). The inner `KNOUX Player X-2.0.0 Setup.exe` SHA-256 is `438D2015441683B8AB519F7B5C264D2DB4EEF8CF694BBCA3D593009B30FD02EB`. A separate 2 MB evidence artifact is also available as artifact ID `8787380400`.

## Vercel

KNOUX Player X is an Electron desktop application; GitHub Actions is the release path for its executable and installer. The optional Vercel configuration builds only the Vite renderer preview and does not replace or validate the desktop runtime. The current Vercel team no longer lists a KNOUX X project or project link, so connector deployment returns `INVALID_ARGUMENT`; a new preview requires explicitly linking or recreating that Vercel project. The local production Vite renderer build is green.

## Platform scope

The authoritative packaging gate currently targets Windows x64. macOS and Linux distributables and platform-specific runtime behavior are not release-certified by the Windows workflow.
