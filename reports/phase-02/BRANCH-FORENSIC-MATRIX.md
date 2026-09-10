# Branch Forensic Matrix — Knoux X

Date: 2026-09-10. Baseline: `3188c2d`.

## Remote branches (complete enumeration via `git ls-remote --heads`)

| Branch | Head | vs main | Class | Reason |
|---|---|---|---|---|
| main | `3188c2d` | — | AUTHORITY | Current product authority, CI green |
| feat/desktop-timeline-export-plan | `74f75e8` | 0 ahead (ancestor) | A. FULLY ABSORBED | Merged as PR #48 |
| fix/windows-timeline-export-e2e | `6677d6b` | 0 ahead (ancestor) | A. FULLY ABSORBED | Merged as PR #49 |

Historical `customization/*`, `codex/*`, `backup/*` branches: DO NOT EXIST
remotely (deleted in earlier sessions). No other `feat/*` or `fix/*` remains.

## Local branches

| Branch | Class | Reason |
|---|---|---|
| main | AUTHORITY | Tracks origin/main, clean |
| traycer/retouch-v2-temporal | F. UNSAFE/UNKNOWN — PRESERVE | Foreign worktree (`3c2dec4`, 0 ahead / 15 behind); never touch another agent's checkout |

## Historical PR heads (`refs/pull/*/head`, 49 refs fetched read-only)

- 37 of 49 are ancestors of main: A. FULLY ABSORBED.
- 12 diverged heads forensically diffed file-by-file (see
  `SOURCE-RECOVERY-MATRIX.md`): 11× B/D (historical-only or obsolete
  experiment), 1× product-policy rejection (analytics vs
  `analyticsEnabled: false`).
- Stash chain (`0272180`/`51bb6a6`/`77e7a7b`): 1-line test expectation,
  present on main — absorbed.
- 129 unreachable commits + 169 unreachable blobs: classified in the prior
  forensic audit (`reports/UNREACHABLE-COMMIT-FORENSIC-AUDIT.md`) — no
  unique treasure; blobs are historical asset/report residue, untouched.

## Deletion log (this mission, §18 — only proven-absorbed)

- `origin/feat/desktop-timeline-export-plan` @ `74f75e8`: ancestor of main,
  merged as PR #48 — DELETED (remote).
- `origin/fix/windows-timeline-export-e2e` @ `6677d6b`: ancestor of main,
  merged as PR #49 — DELETED (remote).
- Local `origin/pr/*` tracking refs (read-only forensic fetch artifacts):
  removed locally; never pushed.
- `traycer/retouch-v2-temporal`: PRESERVED (foreign worktree).
- Historical `customization/*` / `codex/*` / `backup/*`: already absent;
  nothing to delete.
