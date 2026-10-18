# KNOUX X — Production Closure Ledger

Mission window: 2026-10-17 → 2026-10-18.
Branch: `feat/knoux-x-production-closure-20261017` — PR #54 (open, mergeable).

Rules in force: no fake services, no placeholder functionality reported as real, no fabricated
success, no destructive git, every status backed by reproducible evidence. Status vocabulary:
`IMPLEMENTED_AND_RUNTIME_VERIFIED` / `IMPLEMENTED_NOT_VERIFIED` / `PARTIAL` / `BLOCKED_*`.

## Head progression

| SHA | Intent |
| --- | --- |
| `5085bab` | mission branch head at handoff (player memory, resume, Android media gates) |
| `bb3e747` | fix(export): capture timeline frames through a MediaStreamTrackGenerator sink |
| `bd5416f` | fix(desktop): keep timeline export rendering when the window is occluded |
| `a13ca8c` | test(packaged): harden timeline export and entry gates, refresh evidence |
| `0f1cbd2` | test(perf): record packaged startup probe before and after the export fixes |

## Root causes found and fixed (Windows timeline export)

1. **Canvas capture starvation.** The export sampled a timeline canvas via
   `canvas.captureStream()`; the compositor stopped producing frames when the window was
   occluded/minimized, so the muxer window ended mid-timeline. Fixed by rewriting
   `src/features/export/manualFrameCapture.ts` around a `MediaStreamTrackGenerator` sink with
   explicit microsecond `VideoFrame.timestamp`, a pacer-driven draw loop, a final frame at the
   timeline duration, and an 800 ms encoder tail-drain (`RENDER_ENCODER_TAIL_DRAIN_MS`) before
   `recorder.stop()`. Fallback order: MSG → manual `captureStream(0)` + `requestFrame` → auto.
2. **Encoder throughput invisibility (4-core machines).** CDP probe instrumentation proved
   `writer.write()` resolves regardless of encoder backlog (pull ≠ encode); the software VP8
   encoder silently discards its internal backlog at stop under full CPU load. Added bounded
   adaptive backoff (AIMD: `dynamicLimit = max(1, round(6/backoffFactor))`, ×1.5 up to 8,
   recovery after 8 calm writes), pacer-gated canvas drawing (no fill/draw when not capturing),
   and throttled React progress updates (250 ms). Accepted design: idle/light load completes
   full 30 fps; under CPU saturation the export is rejected honestly with a retry message
   instead of shipping a truncated file.
3. **No content-proof on output.** Added `src/features/export/timelineOutputCoverage.ts`
   (0.35 s tolerance against a 3.5 s timeline) plus real packet-extent measurement
   (`electron/creative/probe-packet-extent.ts` via `ffmpeg-service.ts`) since mux
   `format=duration` is `N/A` for the recorded webm.
4. **Occlusion keep-alive.** `electron/main.ts` disables `CalculateNativeWinOcclusion` and
   backgrounding; `electron/window.ts` sets `backgroundThrottling: false`.

## Verified evidence (all on current head)

| Gate | Status | Evidence |
| --- | --- | --- |
| Packaged timeline export E2E (local acceptance tool) | PASS ×2 | extent 3.213 s / 91 video packets / 1.25 MB; extent 3.369 s / 74 packets / 808 KB; pixel proof; `reports/packaged-timeline-export-e2e/evidence.json` |
| CI — KNOUX Windows Timeline Export E2E | PASS | run 39094261153 (head `a13ca8c`) |
| CI — Windows Packaged Creative + Recording E2E | PASS | run 39094261183 |
| CI — KNOUX Full Rebuild Windows (validate-package) | PASS | run 39094261186 |
| CI — KNOUX Player Viewport Windows | PASS | run 39094261147; local 10/10 scenarios |
| CI — Android APK (Capacitor) / Android Release Acceptance | PASS | runs 39094261135 / 39094261131 (emulator) |
| Packaged IPC smoke | PASS | `reports/native-completion/sprint-01/*.json` |
| Video studio entry open/close | PASS | `reports/windows-video-studio-entry.json`; native dialog driven by `run-vs-entry-with-dialog-close.ps1` (prior pass had human selection — caveat recorded) |
| Unit suite | 140 suites / 1244 tests PASS | jest, incl. new `manual-frame-capture` (8 tests) and `timeline-export-coverage` |
| tsc / eslint | clean | zero-warning source gates in CI |
| Perf probe (startup, same machine/probe) | no regression | uiReady p50 4097 ms (`5085bab`) → 3143 ms (`a13ca8c`), p95 5976 → 3975; `reports/performance/` |

## Known limitations / blocked

- `verify:video-gate` — `BLOCKED_CREDENTIALS`: `HF_TOKEN` absent; not faked.
- Android physical device — `PHYSICAL_DEVICE_NOT_TESTED` (no local adb/emulator); CI emulator
  acceptance is green.
- Heavy-CPU export collapse on 4-core machines — accepted, honest retry error; no in-band
  encoder-backlog signal exists to observe.
- `_temp/` probe outputs and generated media (`timeline-export.webm`, `timeline-source.mp4`)
  intentionally not committed; fixture regenerated per run by `createFixture()`.

## Open workstreams at ledger time

- Three scoped audit agents (dead/placeholder services, creative-engine reality, Android
  runtime guards) — running; findings to fold into the final report.
- Visual QA beyond packaged player viewport CI (mobile RTL sizes) — CI emulator only.
- Final Arabic report (sections A–H).
