# Phase-2 Acceptance — Knoux X

Date: 2026-09-10. Baseline SHA: `3188c2d8b48feab433eaf23d5026c7d4907a7cb6`.

## Classification results

- Remote branches enumerated: main + 2 merged PR branches (both ancestors,
  since deleted remotely) + 49 historical PR heads fetched read-only.
- Absorbed: 37 PR heads + 2 patch-id commits + ~34 content-absorbed commits.
- Historical-only / obsolete: all 12 diverged PR heads (per-file diffs;
  details in `SOURCE-RECOVERY-MATRIX.md`), 48 non-source commits, dropped
  stash (1 line, live on main), splash experiment (supersedes branding).
- Rejected: Vercel Analytics (conflicts with `analyticsEnabled: false`;
  needs an explicit owner product decision, never a silent merge).
- RECOVER / ADAPT candidates: **none**. Integration PRs opened: **zero**
  (no dump PR — policy compliant).

## Governance

- BEFORE/AFTER saved in `reports/governance/` (no settings change required:
  strict + 3 real job contexts + no force/deletion already effective).
- Approval requirement documented as structurally impossible (single
  account; self-approval rejected by API) rather than silently dropped.
- Bypass actors enumerated (`BYPASS-ACTOR-AUDIT.md`); no app removed, no
  bypass added. Protection-bypass forensics deferred to a dedicated
  mission per scope rules.

## Hygiene

- Deleted remote merged branches `feat/desktop-timeline-export-plan`,
  `fix/windows-timeline-export-e2e` (both proven ancestors of main).
- Removed local `origin/pr/*` forensic fetch refs.
- Deleted local Chromium profile garbage (`DevToolsActivePort`,
  `*.sqlite3-wal/shm`) and stale local E2E output dir.
- Strengthened `.gitignore` (verified with `git check-ignore`): reports
  profiles, GPU/Dawn caches, SQLite journals, DevTools ports.
- Preserved: foreign status file/artifacts dir, cited `_temp` provenance
  sources, unreferenced fixture (documented).

## Regression locks

No product source touched by this mission (reports + branch deletions +
`.gitignore` only). Timeline-export and retouch packaged gates stand on
the baseline SHA; retouch proof explicitly not re-run without cause.

## Baseline CI reused (§3/§15/§24)

Exact-SHA post-merge cycle on `3188c2d` (no code changes since, so no
invalidation): Android APK SUCCESS (34420452630), Android Release
Acceptance SUCCESS (34420452618), Windows Full Rebuild SUCCESS
(34420452722), Timeline Export E2E SUCCESS (34420452645). Local full
Jest at mission time: 131/131 suites green on the working tree.

## Verdict

Phase 2 succeeds: every historical branch classified, nothing useful
lost, main authoritative and untouched functionally, no fake restored,
protection sane and documented, obsolete merged branches pruned, main
clean, CI green on the exact final SHA subject to the final push below.
