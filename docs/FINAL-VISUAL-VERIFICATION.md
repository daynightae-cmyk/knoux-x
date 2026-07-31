# KNOUX Player X — final visual verification

This file records the repeatable release gates for the final visual customization branch. It does not replace the executable GitHub Actions evidence.

## Source baseline

- Base: `origin/main` at `82521bb23a4592c697095ed4fcf99b00d048ba95`
- Branch: `codex/knoux-final-visual-customization`
- Pull request: `#12`

## Required gates

- Brand asset manifest verification
- TypeScript with no emit
- ESLint with zero warnings
- Jest suites
- Windows x64 package and Squirrel installer
- FFmpeg and FFprobe presence
- Single-instance, Open With, smoke, and cleanup checks
- Vercel browser-preview build and live URL check

## Browser-preview boundary

The hosted build is a renderer preview, not a substitute for the Windows desktop application. Native recording, SQLite, FFmpeg export, Open With, system tray, and installer features must remain guarded and must never be simulated in the browser.
