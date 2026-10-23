# Native save-dialog options and installed-acceptance recovery

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

## Candidate CI failure and bounded fixture repair

On candidate `bda450ea61e412685cd3bb42846003c02001cc7a`, Windows Full Rebuild
`39939253768`, timeline/creative/recording and Android Debug passed. Windows
installed image acceptance passed on GitHub's test merge `391683f`; its tree was
verified equal to bda450e. Android Release `39939253709` failed one of 21 cases.

The retained `real-workflows.json` records a recovered WebView closure inside
`mediastore-discovery-playback-refresh-revoke`, followed by failure to discover
the B fixture. Its screenshot shows the new addition already present and B absent:
the previous attempt had deleted B, but `withSession` reran the whole callback
without restoring its preconditions. This does not establish the cause of the
initial WebView closure and does not justify calling the failed run green.

Additional exact files:

- `tools/android-media-discovery-fixtures.cjs`: verify the device QA source against
  its host SHA-256; restore only the missing B fixture with an exclusive copy;
  reject different existing bytes; allocate a fresh addition per attempt.
- `tools/android-real-workflows.cjs`: establish those preconditions on each attempt,
  prove the addition is absent before creating it, and retain its identity in
  evidence. Discovery, deletion, permission, restart and pixel/input assertions
  remain intact. No app feature, emulator permission policy or workflow gate changed.
- `tests/unit/android-media-discovery-fixtures.test.ts`: five regressions for clean
  setup, retry after deletion, preserving previous additions, different bytes and
  refusing stale addition identities.

After this extension, full local Jest with `KNOUX_REQUIRE_NATIVE_JAVA=1` passed
**173 suites / 1501 tests**, 67.639 s, with no native-Java skip. Typecheck, full
ESLint, both helper syntax checks and diff whitespace checks passed. The newly
pushed head must receive its own installed CI evidence. Previous failed artifacts
and all unique work remain preserved; no assertions were relaxed or tests disabled.

## Preinstall ANR return-code repair

On 5684230, Windows Full Rebuild and Android Release passed, including all 21
release emulator cases. Debug attempts 1 and 2 stopped before app installation.
Inspection found a second verifier defect: `dismiss_foreign_anr` deliberately
returns 2 after successfully clearing a foreign ANR, but the initial
`if ! dismiss_foreign_anr` treated that successful recovery as fatal. The retained
window dump has no remaining Application Not Responding entry. This corrects the
initial interpretation of the failure as an unresolved emulator dialog.

- `tools/android-emulator-smoke.sh` now accepts exactly the documented clean (0)
  and recovered (2) statuses before installation. Other statuses remain fatal.
  The app's own ANR is still rejected by the existing handler.
- `tests/unit/android-preinstall-anr-status.test.ts` executes the actual production
  shell entry under strict Bash with isolated device calls: 0 and 2 reach install;
  1 and unknown 3 do not. Before the fix: 1 failed / 3 passed. After it: the three
  related suites pass all 51 cases. Git Bash is selected explicitly on Windows.

Final local gates: TypeScript, full ESLint, shell syntax and whitespace checks pass;
**174 suites / 1505 tests**, 68.287 s, pass with required native Java enabled. No
test was skipped, assertion weakened or workflow requirement changed. Old CI logs,
both failed Debug artifacts and the passing prior Release artifact are preserved.
The final pushed head still requires its own CI results, including Windows Bash
regressions and installed Android acceptance.

Windows run `39946120792` on bbe6fb0 exposed a portability error in the newly
authored regression: Windows checkout CRLF prevented its exact LF entry markers
from matching, so the suite failed at collection (173 other suites / 1501 tests
passed). The test now normalizes CRLF to LF before extracting/executing the actual
shell entry. No production behavior or expected result changes. All four targeted
cases and targeted ESLint pass locally. The in-progress Android acceptance runs
are allowed to finish before pushing this test-only correction, preserving their
runtime evidence instead of canceling them for a line-ending change.
