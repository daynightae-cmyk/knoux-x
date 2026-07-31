# Creative Suite Tests

## Automated coverage

The Creative Suite now has executable domain and integration coverage for:

- Windows and Unicode screenshot naming and invalid-character replacement.
- Capture timestamps and image payload sizing.
- Recording state transitions, cancellation, and invalid operations.
- Playback-rate-aware trim and split calculations.
- Non-destructive edit-project validation and undo/redo isolation.
- Queue ordering, shuffle, repeat, and persistence behavior.
- Subtitle parsing, malformed-cue isolation, timing, Arabic text, and locale fallback.
- Electron path and external-URL validation.
- A real FFmpeg/FFprobe pipeline generated entirely from legal synthetic fixtures:
  - synthetic video and sine-wave audio generation;
  - stream probing;
  - exact-frame PNG capture;
  - bounded clip export;
  - output existence, size, stream, and duration validation.

## Windows release validation

The authoritative Windows Server 2022 workflow uses Node 20.20.2, Python 3.12, and MSVC 2022. It requires a committed lockfile, regenerates and compares KNOUX icons, rebuilds native modules, runs TypeScript, zero-warning ESLint and Jest, packages the application, creates the installer, verifies packaged FFmpeg and FFprobe, generates an Open With fixture, validates single-instance handling, checks clean shutdown, hashes artifacts, and uploads the release candidate output.

## Acceptance rule

No creative feature is considered release-ready solely because its files exist. The current PR may be merged only after the latest head completes all Windows gates successfully and produces non-empty artifacts with hashes.
