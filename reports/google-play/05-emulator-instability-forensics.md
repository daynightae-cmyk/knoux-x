# 05 — Emulator instability and flake forensics

Investigated 2026-10-28. Every claim below carries its run, job and SHA so the
raw attempt can be pulled again rather than taken on trust.

## Why this report exists

Four Android/Windows lane failures were observed in this work. Three were
infrastructure. **One was a genuine defect of mine, and it looked exactly like the
other three.** That is the whole reason a "red Android lane is usually a flake"
heuristic is dangerous, and it is the reason this file exists.

## Case log

### 1 — `validate-package`, PR #88 — harness, masked diagnosis

| | |
|---|---|
| Run / job | `40467750119` / `122067168622` |
| SHA | `03cb8db` (PR #88 head) |
| Reported | `electronApplication.evaluate: Resulting promise was garbage collected` at `tools/verify-image-studio-project-lifecycle.cjs:46` |
| Actual cause (from the run's own `runtimeLog`) | `ERR_FAILED (-2) loading 'file:///…/.vite/renderer/main_window/index.html'` then `[knoux-startup] pid=6952 event=exit code=1` |
| Re-run of the identical commit | **pass** (`122129531761`) |
| Classification | Harness/environment. The app could not load its renderer entry; `.vite/` is gitignored and produced as a side effect of the preceding `forge package`. |
| Defect fixed | Playwright's GC message hid the real startup error. A pre-flight check now names the missing or empty renderer entry. |

### 2 — both Android lanes, PR #92 — emulator GPU

| | |
|---|---|
| Runs | `40562698235`, `40562699034` |
| SHA | `8c4079e` |
| Reported | `[h264] no frame!` → `ERROR \| Failed to find ColorBuffer: 1693` → `Failed to bind to texture: invalid color buffer` → `The process '/usr/bin/sh' failed with exit code 1` |
| Re-run | **both lanes pass** |
| Classification | Emulator graphics infrastructure (ANGLE over Mesa llvmpipe). Not KNOUX code. The branch changed one test file and nothing runtime. |

### 3 — release lane, `main` — foreign launcher ANR storm

| | |
|---|---|
| Run / job | `40581172707` / `122460626805` |
| SHA | `6b41296` (merge of #94) |
| Reported | 5 × `Foreign system ANR detected for com.google.android.apps.nexuslauncher`, each followed by `Foreign ANR dismissed; resuming KNOUX X to restore foreground.`, then exit 1 |
| Re-run | **pass** |
| Classification | Infrastructure. The ANR belongs to **`com.google.android.apps.nexuslauncher`, not `dev.knoux.playerx`** — no KNOUX process appears in the ANR lines. |
| Residual finding | #90's mitigation fires correctly and recovers five times, but the step still fails after a storm. The bound exists; the recovery budget is what ran out. |

### 4 — both Android lanes, PR #95 — **NOT a flake**

| | |
|---|---|
| Run / job | `40682339151` / `122795927733` |
| SHA | `f013675` |
| Reported | `ESLint gate` → `✖ 7 problems (0 errors, 7 warnings)` under `--max-warnings=0` |
| Cause | The test file I added carried six `no-explicit-any` and one `import/order` warning |
| Classification | **Genuine repository failure, caused by me.** |

This is the important one. Both Android lanes were red on a branch whose workflow
change could not affect them, which is the exact signature of cases 2 and 3.
Acting on the pattern would have produced a re-run, a green result, and a real
lint defect left in place. The re-run hypothesis was **wrong** and was only
displaced by reading the log.

### 5 — `windows-packaged-creative`, PR #95 — third-party binary download

| | |
|---|---|
| Run / job | `122799105570` |
| SHA | `093f999` |
| Failing step | `Install locked dependencies` (`npm ci`) — the first step of the job |
| Reported | `node-pre-gyp ERR! not ok` while `Downloading libtensorflow` for `@tensorflow/tfjs-node` |
| Classification | Infrastructure. The branch changed one workflow YAML and one unit test; it cannot affect a native dependency download. |
| Gate status | **Not a required context.** All three required checks passed, so the PR was mergeable; the state read `UNSTABLE`, not `BLOCKED`. |

Recorded because it is the first case where the flake was in a **dependency
provisioning** step rather than the emulator, and because it shows the value of
`UNSTABLE` versus `BLOCKED`: a non-required red check is information, not a veto.

## Decision rule

A re-run is admissible evidence of flakiness **only after** the failing step is
read and classified. The order is:

1. Identify the **failing step**, not just the job. A lane can fail at a lint gate,
   a build gate, or an emulator gate; only the last two are candidates for flake.
2. Identify the **step**. A failure in `npm ci` is provisioning; a failure in
   `Install and launch … on Android emulator` is runtime; a failure in `ESLint gate`
   is code.
3. Identify the **process** in any ANR. `com.google.android.apps.nexuslauncher` is
   infrastructure; `dev.knoux.playerx` is an application defect and must never be
   retried away.
3. Distinguish **required** from **optional** contexts. A red optional check makes a
   PR `UNSTABLE`, not unmergeable, and should not stall a green required set.
4. Check whether the branch could have caused it. A docs- or test-only diff cannot
   break an emulator, but it can absolutely break ESLint.
5. Re-run **once**. A pass on the identical SHA proves intermittency, not health.
6. Record the run and job IDs either way.

## What is still not eliminated

- **Intermittency is characterised, not fixed.** Four of five cases were
  infrastructure and passed on retry, or were provably unrelated to the diff. Nothing here proves the emulator GPU path or the launcher ANR storm has
  been solved; it proves they are non-deterministic.
- **The recovery budget in `tools/android-emulator-smoke.sh` is untested against a
  longer ANR storm.** Six dismissals may fail where five succeeded.
- **No physical device has been used at all**, so none of this tells us how the app
  behaves on real hardware with real graphics.
- The `.vite/` renderer dependency in case 1 is a latent ordering coupling: the
  acceptance harness still assumes an earlier build step produced that directory.
- `@tensorflow/tfjs-node` fetches a native binary from the network during
  `npm ci` with no retry or cache, so **any** Windows job can fail for a reason
  unrelated to its change. This is the most likely source of future false reds.

## Consequence for the release gate

Release acceptance is **not yet reliable enough to be the sole gate on a Play
upload**. It is currently a mixture of real verification and infrastructure noise,
and the two are only separable by a human reading the failing step. Until the ANR
budget and GPU backend are hardened, a green release lane is necessary but not
sufficient evidence.
