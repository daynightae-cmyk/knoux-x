# Native save-dialog options

Baseline: `e29c81857994fc9768d622410be3e483fd027ecb` (`origin/main` fetched on 2026-10-23).
Branch: `fix/save-dialog-properties-20261023`.

## Reality, risk and unique work

The cloud checkout was clean, with one worktree and no stash. Previous work and
branches remain intact. PR #79 was already merged by subsequent work; its changes
were reused. The owner's Windows device, K: drive, active agents, local R3 worktree
and `reports/R3-FINAL-ACCEPTANCE-20261023.md` are inaccessible in this session.
Remote Desktop Commander tools are absent; an unauthenticated MCP initialize
returned HTTP 401. No claim of local-work recovery is made.

## Confirmed defect and repair

Image Studio requests `createDirectory` and `showOverwriteConfirmation` when saving
projects and exports. The production `FILE_SAVE` handler discarded `properties`
while reconstructing the Electron options. It now passes an explicitly validated
save-options object, retaining those properties. Only Electron 32's five supported
save properties are accepted. Malformed values and open-dialog-only flags fail
before showing a native dialog. Unrelated native options remain excluded.

The existing trusted window owner, file authorization, cancellation result and
write implementation are retained. No IPC contract, persistence format, UI,
platform engine, signing configuration or media fixture changed.

Exact files:

- `electron/ipc/file-dialog-policy.ts`: validated, typed native save options.
- `electron/ipc/setup.ts`: deliver those options to the existing native dialog.
- `tests/unit/file-save-dialog-options.test.ts`: invoke the actual registered
  production handler; verify option delivery, rejection, defaults and cancellation
  without modifying or authorizing the existing destination. Electron dialogs are
  mocked in these tests; native OS interaction is a separate acceptance gate.
- This report.

## Validation

| Gate | Observed result |
| --- | --- |
| New regression suite before repair | 13 failed, 1 passed, exit 1: properties were discarded and invalid properties accepted |
| New suite + file authorization + Image Studio commands after repair | 3 suites, 33 tests passed, exit 0 |
| `npm run typecheck` | Passed, exit 0 |
| `npm run lint -- --max-warnings=0` | Passed, exit 0 |
| `npm test -- --runInBand --watch=false` | 172 suites, 1496 tests passed, 74.378 s, exit 0 |
| Native Vault core | Initially skipped by Jest because host `javac` was absent; separately rerun with the real OpenJDK 21 compiler: 40 passed, 0 failed, exit 0 |
| esbuild bundle of `electron/ipc/setup.ts`, Node platform, external packages | Passed, exit 0; not a packaged application test |
| Standalone Vite build | Passed, 15.39 s; not a Windows/Android package or installed test |
| `git diff --check` | Passed |
| Candidate Windows installed/native dialog acceptance | NOT_TESTED locally; requires the candidate Windows CI run or the authenticated Windows environment |

Raw local logs: `/tmp/knoux-save-dialog-before.log`,
`/tmp/knoux-save-dialog-after.log`, `/tmp/knoux-recovery-typecheck.log`,
`/tmp/knoux-recovery-lint.log`, `/tmp/knoux-recovery-tests.log`,
`/tmp/knoux-recovery-vault-java.log`, `/tmp/knoux-recovery-ipc-build.log`.

## Gaps and next action

This is a narrow source repair, not completion of the full recovery directive.
Review candidate CI and native acceptance before merging. Baseline post-merge
Windows/Android evidence and test installers have been recovered separately under
`/workspace/knoux-delivery-20261023/e29c818/`; they correspond to the baseline and
do not contain this repair. No public release, production signing or manual
deployment was performed. Existing repository preview integrations may run on PR
pushes. Product CPU-load timeline export, intermittent installed `.parse` error,
full device acceptance, model-license review and unique Windows work recovery
remain open. Release status: **BLOCKED**.
