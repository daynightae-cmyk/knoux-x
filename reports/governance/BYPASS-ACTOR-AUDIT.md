# Bypass-Actor Audit — Knoux X

Date: 2026-09-10. Baseline: `3188c2d`.

| ACTOR | TYPE | ID | CURRENT BYPASS | JUSTIFICATION | RISK | DECISION | EVIDENCE |
|---|---|---|---|---|---|---|---|
| daynightae-cmyk | user/admin, sole collaborator | 293348050 (commit id; user id not exposed) | Direct push + merge without checks while admin enforcement is off (observed: 12 direct main pushes) | Sole human owner; legitimate release/automation flow; no second reviewer exists | Silent main mutation bypassing gates (OBSERVED) | KEEP, DOCUMENTED — restrict only when collaboration permits a second approver | `gh api .../collaborators` (single login); push history on main; protection `enforce_admins: false` |
| GITHUB_TOKEN in legacy workflows (`codex-phase-b-retouch-contract`, `generate-lockfile`, `integrate-clip-runtime`, `knoux-live-release`, `knoux-official-brand-sync`, `phase-01-closeout-pr`, others with `contents: write`) | ephemeral app token | N/A | Can push branches per workflow scripts; scripts target `codex/*` branches only, never main | Automation needs branch writes | A workflow bug could push an unexpected ref; none targets main today | KEEP, DOCUMENTED — shrink to least privilege per workflow in a future hygiene pass | `.github/workflows/*.yml` `permissions:` + `git push` lines |
| Session automation token (this audit) | user-authorized token with admin | NOT EXPOSED BY AVAILABLE API | Used once for owner-ordered PR #49 merge after green gates; protection contexts corrected to real job names | Explicit owner instruction, fully logged | Temporary settings writes during the merge window | No standing bypass kept; no token stored in repo | Conversation record; PR #49 merge commit `9b91d6d` |

Rulesets: none at repo level; organization rulesets not visible to this
token (HTTP 404 — personal account). Teams: none. Installations: not
listable with this token (HTTP 404).

No mysterious bypass actor remains undocumented. No CI/release app was
removed. No broad bypass was added by this mission.
