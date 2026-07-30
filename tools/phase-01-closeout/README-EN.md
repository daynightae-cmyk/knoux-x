# KNOUX Player X — Phase 01 Closeout

This package aligns TypeScript and ESLint, repairs the known TypeScript failures, creates timestamped backups, and runs the validation gates without working on `main`.

## Local execution

1. Close any running KNOUX Player X process.
2. Run `RUN-PHASE-01-CLOSEOUT.cmd`.
3. After the repair succeeds, run `VERIFY-PHASE-01-CLOSEOUT.cmd`.
4. Use `ROLLBACK-PHASE-01-CLOSEOUT.cmd` to restore the latest snapshot when required.

## Required environment

- Windows PowerShell 5.1 or later.
- Portable Node.js `v20.20.2` at `D:\Knoux-X-Bootstrap\.tools\node-v20.20.2-win-x64`.
- Visual Studio Build Tools 2022 with MSVC x64/x86.

Do not run the package on `main` or `master`. The branch must not be merged automatically.
