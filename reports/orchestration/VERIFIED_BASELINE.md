# KNOUX X — VERIFIED BASELINE / TASK 000 PARTIAL

Captured: 2026-11-02, Asia/Dubai. Dated evidence; recheck before further changes.

## Source truth
- Canonical origin: https://github.com/daynightae-cmyk/knoux-x.git
- GitHub protected main SHA: 63783e376e78c5c5a6bcb182aa229a645a08ca5d
- Isolated writer: audit/knoux-x-task000-20261102 at K:\Knoux Projects\knoux-x\Worktrees\knoux-x-forensics-20261102, created from the exact main SHA.
- Seven actual worktrees after creating the isolated checkout. Exact JSON: git-worktree-inventory-20261102.json.
- Qoder, Codex and Traycer processes were present. Exact active agent/file ownership remains UNKNOWN. No shared file leases assumed.

## Current main CI — not fully green
| Workflow | Run | Conclusion |
|---|---|---|
| Android Release Acceptance | 40781415919 | SUCCESS |
| Android APK | 40781415901 | SUCCESS |
| Windows Timeline Export E2E | 40781415936 | SUCCESS |
| Windows Full Rebuild | 40781415930 | FAILURE |

Windows failure step: Verify built Image Studio save, reopen, and real image exports.
Job: 123143753440. Evidence artifact: 12856714397.
Evidence was downloaded into a temporary directory outside the repository: K:\tmp\knoux-x-image-lifecycle-63783e-20261102.

Actual process evidence:
- Renderer entry existed, size 12,455 bytes.
- Electron stderr: Failed to start Knoux X Error: ERR_FAILED (-2) loading file:///D:\a\knoux-x\knoux-x\.vite\renderer\main_window\index.html
- Electron process exited with code 1.
- Playwright raised: Resulting promise was garbage collected.
- The last message is SECONDARY to Electron startup failure. Exact reason for the file load failure is UNKNOWN, not established as an emulator ANR, TensorFlow failure or Playwright bug.
- Do not weaken the real Image Studio lifecycle acceptance to bypass this failure.

## Current open PRs
#86 README/identity: OPEN, BEHIND.
#89 About/corporate identity: OPEN, BEHIND.
#97 Windows FFmpeg archive executable: OPEN, BEHIND.
#101 owner-local signing secret upload: OPEN, BEHIND.
#102 real creative suite: OPEN, BLOCKED.

## Production boundary
- Permanent signing key exists from earlier user-approved creation. Private material was not opened or copied in this audit.
- GitHub Environment android-production has protected_branches=true and a required-reviewers rule for daynightae-cmyk, prevent_self_review=false.
- Names present: KNOUX_ANDROID_KEY_ALIAS and KNOUX_ANDROID_CERT_SHA256.
- Three missing: KNOUX_ANDROID_KEYSTORE_BASE64, KNOUX_ANDROID_KEYSTORE_PASSWORD, KNOUX_ANDROID_KEY_PASSWORD.
- A previous AAB is signed with a CI identity only. Production-signed AAB, real Android device proof and Play Console listing remain UNVERIFIED.

## Scope and tests of this delivery
- Node on local Windows: v24.21.0.
- node --test tests/forensics/audit-knoux-worktrees.test.cjs: PASS 2/2, exit 0.
- node tools/audit-knoux-worktrees.cjs --repo (the isolated audit checkout): PASS, exit 0, 7 worktrees.
- No application runtime test was executed by this audit, and no release created.
- K drive free space at initial read: 4,758,536,192 bytes; physical folder sizes not yet measured.
- No cleanup, reset, rebase, file deletion or modifications to any existing worktree.

## Outstanding TASK 000 checks
Ignored/backup asset uniqueness, detailed disk allocation, approved UI screenshot mapping, agent-owned file leases, semantic-equivalence review of old branches and full task index to production remain PARTIAL.
