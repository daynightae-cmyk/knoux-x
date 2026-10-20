# Windows evidence — integration branch

Branch `feat/knoux-x-integration-20261019`. Product code on every run below is identical (the
branch adds only Android CSS/i18n fixes, evidence, and tooling); the packaged binary measured
locally has the same SHA-256 in all three performance series.

## 1. Packaged binary measured

| Item | Value |
| --- | --- |
| Executable | `out/Knox X-win32-x64/knoux-player-x.exe` |
| Size | 186,361,344 bytes |
| SHA-256 | `e16d5b6b81366ee563596dc3ddb09a7aa64395df552656945bae9cd042bb1da0` |
| Build | `npm run package` (electron-builder, x64) on the integration branch |

## 2. Performance probe — series 4 is the authoritative measurement

File: `perf/series-4-clean-tree-d8e6d85.json` (11,857 bytes, SHA-256
`8ed9383be6550ae046cdbe6a40f16aaa7c229f5f9e371875829478aef4ae40b2`), produced at head
`d8e6d85` with `trackedTreeClean=true`, 5/5 successful runs, no relaunches.

| Run | CDP endpoint up | DOMContentLoaded | UI ready | Renderer heap | Working set (settled) |
| --- | --- | --- | --- | --- | --- |
| 1 | 7,668 ms | 13,523 ms | 14,647 ms | 10 MB | 379 MB |
| 2 | 4,532 ms | 6,694 ms | 6,901 ms | 10 MB | 384 MB |
| 3 | 3,581 ms | 4,547 ms | 5,261 ms | 10 MB | 379 MB |
| 4 | 3,118 ms | 3,553 ms | 4,205 ms | 10 MB | 424 MB |
| 5 | 7,585 ms | 14,150 ms | 14,663 ms | 10 MB | 384 MB |

Aggregates (recomputed independently from the per-run samples and matched against the file):
UI-ready p50 **6,901 ms**, p95 **14,663 ms**, min 4,205 ms, max 14,663 ms; renderer JS heap p50
10,000,000 B; process working set p50 402,640,896 B (384 MB).

Method (`tools/knoux-performance-probe.cjs`): spawn the packaged EXE with
`--remote-debugging-port`, wait for the DevTools endpoint (60 s budget), attach over CDP, wait
for `#root > *` to become visible and `#initial-loading` to disappear, sample renderer
`performance.memory`, then sample the process working set 3 s and 8 s after UI-ready. Wall time
is measured from process spawn to UI-ready.

Machine: Intel Core i5-4570 @ 3.20 GHz, 4 cores, 11.9 GB RAM, Windows, Node v24.21.0. This is one
consumer machine, N=5 — an indicative measurement, not a lab benchmark.

## 3. Why the earlier series contain failed runs (diagnosis, not excuses)

`perf/series-1-pre-hardening-124a023.json` (3/5 ok) and `perf/series-2-pre-hardening-8d9624e.json`
(4/5 ok) are kept for transparency. Every failure in them has one root cause, taken from the
application's own startup trace:

```
[knoux-startup] event=single-instance-lock acquired=false argv=[... "--remote-debugging-port=9333"]
[knoux-startup] event=exit code=0
```

The probe launched the next instance while the previous one had not yet released the
single-instance lock, so the new process exited immediately (code 0) and the DevTools endpoint
never came up (`PACKAGED_CDP_ENDPOINT_TIMEOUT`). A second, distinct symptom appeared once: the
endpoint was up and the browser WebSocket connected, but Playwright's `connectOverCDP` handshake
did not finish inside its 10 s budget.

That is the probe's launch sequencing, not an application crash: the app followed standard
single-instance semantics and exited cleanly. The probe now (commits `c2e2bad`, `d8e6d85`)

* kills the app tree and waits for zero surviving processes before every launch,
* watches the child's exit event and treats an early exit as a launch-phase failure,
* retries the launch once after a full process-tree termination, recording every attempt in
  `run.launches` and `run.relaunchReason`,
* writes its evidence with `fsync` + atomic rename + byte-identical read-back verification.

## 4. Windows CI lanes run against the integration head (all at `124a023`)

| Run | Workflow | Result | What it actually proves |
| --- | --- | --- | --- |
| 39311685316 | KNOUX Windows Packaged Creative + Recording Real E2E | success, 4m11s | Job 1: `npm ci`, typecheck, lint `--max-warnings=0`, `npm run package`, then `tools/run-packaged-creative-e2e.cjs` → packaged EXE launched, `exitStatus: 0`, `hasFatalError: false` (`ci-39311685316/windows-packaged-creative-evidence.json`) |
| 39319456257 | KNOUX Windows Timeline Export E2E | success, 4m1s | `npm ci`, electron-rebuild (better-sqlite3, sharp), typecheck, lint, package, then **two** packaged CDP E2Es: multitrack timeline export and player preferences/resume (`ci-39319456257-timeline-export/`) |
| 39319496539 | KNOUX Player Viewport Windows | success, 7m24s | doctor, typecheck, lint, `npm test --runInBand`, package, installer (`npm run make`), then `npm run test:player-viewport` → `Player viewport packaged-app smoke PASS: 10 measured scenarios` (`ci-39319496539-viewport/run-summary.txt`) |

Timeline-export evidence (`ci-39319456257-timeline-export/timeline-export-evidence.json`,
verdict `PASS`): 3-track / 2-item multitrack project built on the real packaged app, exported
`timeline-export.webm` = 579,937 bytes, vp8 + opus, 1920×1080, `measuredDuration` 3.45 s over 73
packets; pixel proof compares the source and exported frames (mean absolute channel difference
2.96, 2.18% materially different pixels) and shows the exported tail frame is dark after the
source ends (`nonBlackPixelRatio` 0.0144 vs 1.0 early). The exported media, the project file, the
run log and the PNG proofs are committed next to the JSON.

The player-viewport artifact (`knoux-player-viewport-124a023…`, 576,271,627 bytes, zip SHA-256
`91770c915cbcf6ef630b3a84b5cc4723ae4ddbd4090ba0f044feae233121fe56`) is intentionally **not**
committed: it bundles the Windows installer. The verbatim CI log lines are committed instead.

### Windows acceptance that is NOT covered

The second job of run 39311685316 ("Real Recording Acceptance") is an echo-only step; the
`recording-real-e2e-evidence-STALE-2026-09-10.json` file it uploads is a **committed file dated
2026-09-10** whose own verdict is `NOT_TESTED` — `DISPLAY_CAPTURER_REQUIRES_INTERACTIVE_DESKTOP_SESSION`,
`microphoneAvailable: UNAVAILABLE_ON_HEADLESS_RUNNER`. Windows interactive recording acceptance
is therefore **not** covered by CI and is reported as an open gap, not as a pass.

## 5. Local file-integrity incident on the K: volume (recorded, contained)

**What happened.** Four files written on the K: volume inside a ~14-minute window (local
00:17–00:31, 20 Oct) were read back as all-NUL while still carrying their exact expected byte
length: `device-pass/README.md`, `device-pass/real-workflows-run-39315915167.json`, two copied CI
evidence JSONs, and one probe evidence JSON.

**Repair.** Every affected file was rebuilt **only from original verified sources** — the README
from the committed `8d9624e` blob, the retry JSON from the CI artifact extract, the Windows copies
from the CI artifact extracts — using atomic temp-file + `fsync` + rename + byte-identical
read-back verification, then re-verified as git blobs. The superseded commit `34e65fe` (which
contained the two zeroed blobs) was replaced by `d082d54`; the zeroed probe JSON was deleted and
superseded by series 4. No test outcome was retyped or invented anywhere.

**Verified current state.** 1,084 files / 138 MB scanned in the worktree (text + PNG + JPG + MP4
structure checks): **0 findings**. 2,902 git blobs scanned across the whole object database:
**0 corrupted reachable blobs**. The only two all-NUL objects left anywhere are the unreachable
residue of the superseded commit; they are not reachable from any ref and cannot be pushed.

**Cause — hypotheses, with the evidence for each.**

* *Storage-path event (best supported, not proven).* The Windows System log records iaStorE
  event 4155 — "I/O on TPBF2303010030103560 has failed" — at local 22:30:24 on 19 Oct, and then
  iaStorE "Powering up" with NTFS volume health re-checks on K:, C: and D: at local 00:32:02–00:32:12
  on 20 Oct, i.e. 45 s after the last corrupted write, on the SATA SSD that hosts K:. A controlled
  experiment after the incident (12 files × {plain, fsync, atomic} writes up to 8 MB, re-read at
  T+0/T+20/T+60 and round-tripped through `git hash-object`) produced **0** corruptions, which fits
  a transient storage-path event rather than a defect in the write APIs.
* *Not excluded:* an agent/sandbox write-interception layer (`codex-windows-sandbox-service.exe`
  was running on this machine) and endpoint-security placeholder behaviour (Defender's operational
  log has no events for the window and no detection touches K:; SMART counters could not be read
  without an elevated prompt).

**Durable mitigations in this branch:** probe evidence writes are fsync'd, atomically renamed and
read-back verified; the probe pre-cleans and detects single-instance early exits;
`tools/verify-evidence-integrity.cjs` rejects all-NUL text evidence, malformed JSON and invalid
image structure before a commit or push.

**Remaining risk.** The volume was ~90% full (≈4.8 GB free) during the incident window and the
storage stack had already logged one I/O failure on that device. Reclaim space and read the
disk's SMART counters from an elevated prompt before relying on this volume for further long
evidence sessions. A verified bundle of the branch history is kept off the K: volume at
`C:\Users\day night\AppData\Local\Temp\opencode\knoux-x-integration-20261020.bundle`
(150,051,926 bytes, SHA-256 `9f00ac87997c4bd0dacaf02900f235fb454a940a75965b0e0da12879c00e997a`).
