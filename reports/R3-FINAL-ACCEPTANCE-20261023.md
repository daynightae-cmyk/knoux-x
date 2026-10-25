# KNOUX X R3 Final Acceptance Report

- Date: 2026-10-23
- Repository: https://github.com/daynightae-cmyk/knoux-x
- Baseline: `e29c81857994fc9768d622410be3e483fd027ecb` (main)
- Acceptance branch: `fix/r3-acceptance-20261023`
- Worktree: `K:\Knoux Projects\knoux-x\Worktrees\knoux-x-r3-acceptance-20261023`
- Host: Windows x64, 4 logical CPUs, Electron 32.3.3, Node v24.21.0
- Host load during acceptance: sustained 100% CPU (agent infrastructure: traycer-host, opencode, Traycer, Chrome)

## Verdict

**NOT ACCEPTED. The release candidate is blocked.**

| Area | Verdict | Evidence |
| --- | --- | --- |
| Windows package and Squirrel installer | PASS (unsigned) | `out/`, `out/make/squirrel.windows/x64/`; hashes below |
| Installed Windows app launch | PASS | Installed from Setup.exe; build info `e29c818`, version 2.1.0 |
| File dialog `properties` defect | PASS (fixed) | `electron/ipc/file-dialog-policy.ts`, 5/5 dialog tests |
| Retouch Studio packaged workflow | PASS | `reports/windows-packaged-retouch-e2e.json` |
| Settings persistence self-test | PASS | `reports/r3-acceptance-20261023/packaged-settings-persistence-final.json` |
| Video Studio entry | PASS | `reports/windows-video-studio-entry.json` |
| Player preferences | PASS on 03:41 build; flaky on final build | 14-step PASS log; final-build seek miss and hang |
| Timeline export | **FAIL (P1)** | App rejects truncated/empty encoder output under load |
| Image lifecycle (source checkout) | PASS | `knoux-image-lifecycle-oTcmqm` |
| Image lifecycle (installed, native dialogs) | PARTIAL | Functional steps passed; clean harness pass not achieved |
| Creative functional E2E | SMOKE ONLY | Launch smoke, not full UI workflow |
| Audio Lab encoder | PASS | `reports/r3-acceptance-20261023/audio-lab-encoder-final.log`; MP3 16,918 bytes, WAV 176,560 bytes, ID3 verified |
| Full Jest | PASS | 171 suites / 1483 tests |
| Typecheck / lint | PASS | exit 0 both |
| Android emulator acceptance | PASS (scoped) | CI artifact; 21/21 emulator cases, phone NOT_RUN |
| Android physical device | NOT RUN | No device or SDK on this host |
| APK signing | BLOCKED | Test-signed, `productionSigned: false` |
| Windows signing | BLOCKED | Authenticode `NotSigned` |
| AI provider live verification | BLOCKED | No provider credentials |
| Local retouch model assets | PASS | Sizes and SHA-256 match registry |
| Camera recording | BLOCKED | No camera on this host |

## Build And Artifacts

Final commands:

- `npm ci --ignore-scripts` (1281 packages) followed by `npm exec electron-rebuild -- -f --only better-sqlite3,sharp` and `node node_modules/electron-winstaller/script/select-7z-arch.js`
- `npm run package -- --arch=x64` -> exit 0
- `npm run make -- --arch=x64` -> exit 0
- `npm run typecheck` -> exit 0
- `npm run lint -- --max-warnings=0` -> exit 0
- `npx jest --runInBand` -> exit 0, 171 suites, 1483 tests, 255.45 s

Final artifacts:

| Artifact | Size | SHA-256 | Signature |
| --- | ---: | --- | --- |
| `out/Knoux X-win32-x64/knoux-player-x.exe` | 186,361,344 | `5a7b20a1c341f59e80465d1b5ffcce16bae8982939189d60368a57dfb74c30d6` | NotSigned |
| `out/Knoux X-win32-x64/resources/app.asar` | 85,499,859 | `92ab811cfcbbdb9e8d6edfbdfcebd7f0da8f65f3f3fc2b206ef2c400385e04c8` | n/a |
| `out/make/squirrel.windows/x64/Knoux X-2.1.0 Setup.exe` | 285,807,616 | `992f63eb5197fab0d64eb20906f8e4a705391fdb6f21b959faa4a7fa9826d0b6` | NotSigned |
| `out/make/squirrel.windows/x64/KNOUX_Player_X-2.1.0-full.nupkg` | 285,069,143 | `793a5749aad16ef29e44b987821bd34e877c7d9986901a24913c9814760fa968` | n/a |
| `RELEASES` SHA-1 | n/a | `D06363B9FFB55BBC3F2120178E1406A23F2BE34B` | n/a |
| Installed exe (`%LOCALAPPDATA%\KNOUX_Player_X\app-2.1.0`) | 186,361,344 | `5a7b20a1c341f59e80465d1b5ffcce16bae8982939189d60368a57dfb74c30d6` | NotSigned |

Install/uninstall: `Setup.exe --silent` exit 0; registry entry created (`Knoux X`, 2.1.0); `Update.exe --uninstall -s` exit 0; registry entry removed; leftover `.dead` directory and test shortcuts removed after evidence capture.

## Timeline Export Defect (P1, Open)

The packaged desktop timeline export uses a realtime `MediaRecorder` + `MediaStreamTrackGenerator` pipeline at 1920x1080. Under sustained 100% CPU the VP8 encoder either emits nothing or drops the leading seconds while starting.

Observed runs:

| Time | Build | Result |
| --- | --- | --- |
| 03:42 | before finalize fix | App rejected truncated output |
| 03:48 | before finalize fix | App rejected truncated output |
| 03:53 | before finalize fix | PASS with 3.352 s measured video, 82 packets |
| 04:09 | after finalize fix | App passed coverage (3.472 s, 28 packets), but first PTS 2.139 s and early frame black; old harness falsely passed |
| 04:12 | strict harness | App rejected empty encoder output |
| 04:13 | strict harness + High priority | App rejected truncated output |

Fix applied: `src/features/export/manualFrameCapture.ts` now stops the recorder while the generator track is still live, drains the encoder tail, then closes the writer. This moved the last packet from 3.352 s to 3.472 s in the first post-fix run. It does not address encoder starvation.

Harness hardening: `tools/run-packaged-timeline-export-cdp-e2e.cjs` now requires the early exported frame to be bright, non-black, and materially similar to the source. The previous assertion only required it to differ from the source, so a black frame passed.

Evidence: `reports/r3-acceptance-20261023/timeline-export-findings.json` and `timeline-export-*.log`.

## Other Findings

### Intermittent `.parse` page error (open)

During the first installed image lifecycle run (`knoux-image-lifecycle-lRED1Q`), the renderer raised `Cannot read properties of undefined (reading 'parse')` after image import. No stack was captured because the harness logged only `error.message`. The harness now records `pageErrors` with stacks; the next three installed runs had zero page errors. Root cause not identified.

### Installed image lifecycle is not cleanly certified

- Run `knoux-image-lifecycle-cLprgj`: import, retouch, project save, PNG/JPEG/WebP export all passed; the app did not exit within 20 s, so `success` is false and restart/reopen was not verified.
- Run `knoux-image-lifecycle-TVJlTm`: import, retouch, project save, and PNG export passed; the native dialog helper failed to capture bounds on the next save.
- Source-checkout run `knoux-image-lifecycle-oTcmqm`: full success, including restart/reopen exact and original-unchanged.
- The installed app was launched with actual native Win32 dialogs, not patched preloads.

### Player preferences final-build flake

The 03:41 packaged run passed all 14 steps. On the final build, one run failed a UI seek (`18.889 s` observed for a `15 s` target, tolerance 2 s) and a retry hung after the partial-update step. The player preference code was not changed by this acceptance branch. This is recorded as an environment/harness flake, not a proven product regression.

### Creative E2E is a smoke test

`reports/windows-packaged-functional-e2e/evidence.json` shows `exitStatus: 0` and a note that full UI interaction is not automated. It must not be counted as full creative workflow acceptance.

### Rapid-save observation

The rapid-save path that returns a save path without a dialog is a test-only acceptance seam (`--retouch-phase3b-acceptance-config=`). It is not reachable in normal product use.

## Security And Vault

- Java vault core on Windows: 40 passed, 0 failed, 5 skipped (POSIX-only rename cases). Linux CI: 40 passed, 0 skipped.
- Android emulator cases verified: encrypted media lifecycle, identifier membership gate, tamper/plaintext containment, corrupt-index recovery, delete integrity, PIN rotation/large media, plaintext cache survives kill.
- Evidence copied to `reports/r3-acceptance-20261023/android/`.
- APK: `C2219BF443B3194F4230CAC53906E5A907AF79CE07A8DAFCBBA73DA679A44F36`, 45,321,178 bytes, v2/v3 signed, test key, `productionSigned: false`.
- `webContentsDebuggingEnabled` is enabled only for debug/acceptance builds via `tools/configure-android-webview-debugging.cjs`; a contract test requires production builds not to expose it.
- File dialog authorization and cancellation tests pass; dialog `properties` are now allowlisted per dialog kind.

## Android Acceptance

- CI run `39876025329` succeeded at `e29c818`.
- 21 of 21 scoped emulator cases verified, `verdict: PASS_SCOPED_CASES_ONLY`, `phone: NOT_RUN`.
- Touch policy: trusted adb input tap, `syntheticEventsUsed: false`.
- Measurements: library to first discovered media 28,833 ms; chooser to decoded frame 31,535 ms (includes native chooser/permission interaction).
- No physical device, Android SDK, emulator, or USB device on this host, so hardware keystore/StrongBox and physical acceptance remain unverified.

## AI And Models

- `node tools/verify-ai-providers.cjs`: all three providers skipped because `HUGGINGFACE_API_KEY`, `FAL_KEY`, and `KNOUX_SESSION_TOKEN` are absent. Live model generation is unverified.
- Local retouch models: `face_landmarker.task` 3,758,596 bytes, SHA-256 `64184e22...0bc9ff`; `pose_landmarker_full.task` 9,398,198 bytes, SHA-256 `4eaa5eb7...cec4ad`; both match `electron/retouch/local-model-registry.ts` and are Apache-2.0.
- Image Studio catalog aliases (Qwen-Image-2512, FLUX.1-schnell, SDXL) resolve to `stabilityai/stable-diffusion-3-medium-diffusers` and are marked with `aliasedTo`. Alias capability entries still advertise image-to-image/inpainting while the HF adapter refuses reference images. This is a documented catalog-truthfulness finding, not fixed in R3.

## Hardware

- No camera (`Get-PnpDevice -Class Camera` empty). Windows camera recording/finalize-to-editor handoff is not hardware-verified.
- Microphone and speaker endpoints exist; no physical audio capture acceptance was run.
- No Android device.

## Release Gate

The release gate is **not met**. Blocking items:

1. Timeline export fails under CPU saturation and can drop leading or trailing content; fix and repeat acceptance under controlled load.
2. Windows installer and executable are unsigned.
3. Android APK is test-signed; production signing is absent.
4. No physical Android device acceptance (hardware keystore/StrongBox).
5. Installed image lifecycle has functional evidence but no clean harness pass, and the intermittent `.parse` error is unexplained.
6. AI provider verification is blocked without credentials.
7. Camera recording is unverified.

## Changed Files (Uncommitted)

Code, tests, and harness:

- `electron/ipc/file-dialog-policy.ts`
- `electron/ipc/setup.ts`
- `src/features/export/manualFrameCapture.ts`
- `tests/unit/file-dialog-and-authorization.test.ts`
- `tests/unit/manual-frame-capture.test.ts`
- `tests/unit/slideshow-execution-planner.test.ts`
- `tools/run-packaged-timeline-export-cdp-e2e.cjs`
- `tools/verify-image-studio-project-lifecycle.cjs`
- `tools/installed-image-lifecycle-driver.cjs`

Generated evidence (not committed): `reports/r3-acceptance-20261023/`, updated `reports/` JSON/PNG artifacts, `_temp_*.log`.

No commit or pull request was created. The branch is awaiting explicit authorization.

## R4 Prompt

```
R4: Make desktop timeline export deterministic and release-grade.

Context: KNOUX X 2.1.0 at e29c818 fails desktop 1080p timeline export when the host is CPU-saturated. The realtime MediaRecorder + MediaStreamTrackGenerator pipeline can emit an empty file or drop the first 2.1 s / last 0.15 s. The current coverage check validates only the end, and the old harness accepted a black early frame.

Tasks:
1. Replace the realtime MediaRecorder export path with a deterministic offline encoder (WebCodecs + a muxer, or canvas frames piped to the bundled ffmpeg). Keep the existing retouch/overlay compositing.
2. Add product-level validation for both ends of the export: first video PTS near zero and last packet covering the authored duration within a documented tolerance.
3. Keep the strict harness assertions for bright/non-black early frames and source-similarity; preserve the output artifact on failure.
4. Reproduce and fix the intermittent renderer page error "Cannot read properties of undefined (reading 'parse')" from the installed image lifecycle; capture a stack with source maps and add a regression test.
5. Verify 10 consecutive 1080p timeline exports at 100% background CPU load with full source+title pixel proof and ffprobe packet coverage.
6. Obtain production Authenticode signing for the Windows installer/exe and production signing for the Android APK.
7. Run physical Android device acceptance for hardware keystore/StrongBox, and re-run the installed Windows image lifecycle to a clean success including restart/reopen.
8. Re-run typecheck, lint, full Jest, packaged retouch, settings persistence, video entry, player preferences, audio encoder, and the Android acceptance suite.

Do not ship 2.1.0 until timeline export passes under load, both artifact sets are production-signed, and physical device acceptance is recorded.
```
