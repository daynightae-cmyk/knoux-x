# WINDOWS PACKAGED RETOUCH E2E — Knoux X

- verdict: **PASS**
- packagedExe: K:\Knoux Projects\knoux-x\Worktrees\knoux-x-r3-acceptance-20261023\out\Knoux X-win32-x64\knoux-player-x.exe
- packageVersion: 2.1.0
- testedHead: e29c81857994fc9768d622410be3e483fd027ecb
- testedBranch: fix/r3-acceptance-20261023
- sourceVideo: K:\Knoux Projects\knoux-x\Worktrees\knoux-x-r3-acceptance-20261023\tests\fixtures\retouch-real\army-exercise.mp4
- sourceSha256: 35416523A9019421906862C1AF44BB14B96F1F1DDE99CF7D9FB19FF59C41055D
- rendererReady: true
- mediaOpened: true (file:///K:/Knoux%20Projects/knoux-x/Worktrees/knoux-x-r3-acceptance-20261023/tests/fixtures/retouch-real/army-exercise.mp4)
- videoStudioReady: true (providers: 5)
- retouchReady: true
- bodyDetectionCount: 1
- bodyTrackId: body-track-1
- strokeCount: 4
- confidenceMin: 0.6957201361656189
- freezeCoverage: 0.8533940972222223 - 0.9628255208333333
- previewPixelDelta: 439127
- exportCompleted: true
- exportPath: K:\Knoux Projects\knoux-x\Worktrees\knoux-x-r3-acceptance-20261023\reports\retouch-packaged-e2e-output.mp4
- outputExists: true
- outputVideoCodec: h264
- outputAudioCodec: aac
- outputResolution: 640x360
- outputDuration: 3.000000
- reopened: true
- reopenedBakedPixelDelta (t=0): 568896
- reopenedBakedPixelDelta (t=1.5s): 3138893
- relaunchSuccess: true
- argvOpenWithSuccess: true
- orphan knoux-player-x processes after close: 5

## Production path exercised

- Real packaged EXE launch, vanilla renderer boot, build identity (packaged=true).
- Fixture authorized via authorizeMediaPaths; media opened via production creative:path-to-media-url IPC.
- Video Studio production IPC (list-providers/provider-status) on the real renderer.
- Verified packaged pose model via production image-studio:get-pose-model IPC (resources/assets/models/pose_landmarker_full.task).
- Real Chromium decode of tests/fixtures/retouch-real/army-exercise.mp4 (Video Studio preview path).
- Body Retouch enabled with deterministic control waist:-65/torsoWidth:-35 strength:100 via production createVideoRetouchState/addVideoRetouchLayer.
- Preview pixels via production VideoFrameProcessor (same class VideoRetouchPreviewOverlay renders with); zero/disabled/before controls verified at 0 delta; background freeze verified at 0 delta.
- Export multiplexed with production FFmpegService (packaged ffmpeg.exe), final artifact produced by the REAL product ExportService.export high-quality preset (probe-validated, partial+rename).
- Reopen verified independently with packaged ffprobe.exe/ffmpeg.exe (raw rgb24 baked delta at t=0 and t=1.5s).
- Relaunch without flags: renderer healthy; second-instance file argv forwarded as APP_OPEN_MEDIA (Open With path intact).

- runtime evidence: K:\Knoux Projects\knoux-x\Worktrees\knoux-x-r3-acceptance-20261023\reports\windows-packaged-retouch-e2e-runtime.json
- run log: K:\Knoux Projects\knoux-x\Worktrees\knoux-x-r3-acceptance-20261023\reports\windows-packaged-retouch-e2e-run.log (local-only, gitignored)
- completed: 2026-10-23T04:38:13.486Z
