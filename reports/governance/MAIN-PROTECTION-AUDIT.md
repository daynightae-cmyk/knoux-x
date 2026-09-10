# Main Protection Audit — Knoux X

- Date: 2026-09-10. Baseline SHA: `3188c2d8b48feab433eaf23d5026c7d4907a7cb6`.
- BEFORE state: `MAIN-PROTECTION-BEFORE.json` (captured live from the API).
- AFTER state: `MAIN-PROTECTION-AFTER.json` (identical — no change required).

## Observed timeline

- Main was unprotected (HTTP 404) at audit start.
- Protection was enabled with strict checks + 1 approval + admin enforcement.
- Direct pushes to main (12 timeline-export commits) landed despite it.
- Protection was later observed in a modified state: approval requirement
  gone, contexts replaced with names matching no existing workflow job,
  admin enforcement off. Actor: UNKNOWN / NOT EXPOSED BY AVAILABLE API
  (no audit-log access on this account; no workflow in the repo touches
  protection settings — verified by source search).
- Required contexts were corrected to real job names; approval gating was
  not restorable without deadlocking all merges (see below).

## Current (target) state

- `strict: true` (branch must be up to date).
- Required contexts (exact job names, all run on PRs):
  - `validate-package`
  - `Validate, launch-test, and build installable debug APK`
  - `Build, sign, install, and launch release APK`
- `allow_force_pushes: false`, `allow_deletions: false`.
- Merge methods: merge/squash/rebase allowed. No linear-history,
  signature, conversation-resolution, or code-owner requirements.

## Why no approval requirement

Repository collaboration permits exactly one human account
(`daynightae-cmyk`, sole collaborator, no teams). GitHub rejects
self-approval (proven: `cannot approve your own pull request`), and a
required-approval rule with zero eligible reviewers deadlocks EVERY merge
— including legitimate owner and automation merges. Per mission policy
this limitation is documented instead of silently protecting nothing:
PR review still happens socially (PRs #48/#49 were reviewed in
conversation), and all merges require the three green gates above.
Revisit the moment a second reviewer account exists.
