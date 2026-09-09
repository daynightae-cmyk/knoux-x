# RETOUCH REAL VIDEO PIXEL PROOF

Verdict: **PASS** (frame + encode + reopen levels).

## Fixture

- Path: `tests/fixtures/retouch-real/army-exercise.mp4`
- SHA256: `35416523A9019421906862C1AF44BB14B96F1F1DDE99CF7D9FB19FF59C41055D`
- Tech: mp4, h264 640x360 yuv420p, 15fps, 3.0s, 45 frames, aac audio present
- Provenance: real-human exercise footage (local fixture). A prior session note
  claims US-Army public-domain via Wikimedia; that claim is NOT independently
  re-verified here. SHA256 above is the identity. Test-only fixture.

## Production path (no fakes)

REAL VIDEO FRAME -> BodyAnalysis (MediaPipe pose-landmarker-full, packaged
Electron proof harness `_temp/real-proof/run.cjs`) -> VideoBodyTracker ->
temporal body keyframes -> VideoRetouchFrameResolver -> VideoRetouchBodyGeometry
-> resolved BodyReshapeControls (waist -65, torsoWidth -35, strength 100) ->
bodyReshapeStrokes -> createBodyFreezeMask (real segmentation) ->
liquifyMeshWarp.

## Frame proof (`reports/retouch-real/frame-proof.json`)

- 45/45 frames: body detected, 33 landmarks, confidence 0.69-0.92
- Track `body-track-1` stable across all keyframes
- Strokes: 4 per frame (nonzero control)
- pixelDelta range: 293716-546208 channel differences (all > 0)
- zero-strength delta: 0 on all frames
- before/disabled delta: 0 on all frames
- background (freeze-masked) delta: 0 on all frames
- freeze coverage: 0.85-0.96 (never full-frame freeze)
- output dimensions unchanged (640x360)

## Encode proof

- Command: `ffmpeg -framerate 15 -i reports/retouch-real/processed/%03d.png
  -i tests/fixtures/retouch-real/army-exercise.mp4 -map 0:v -map 1:a
  -c:v libx264 -pix_fmt yuv420p -crf 18 -c:a aac -shortest
  reports/retouch-real-video-output.mp4`
- Output: `reports/retouch-real-video-output.mp4`
  SHA256 `0648D5FC406A1A173912CDDDA8CB5B72CAA615DDDD3F26FB8B4489D8123B8093`
- Output FFprobe: h264 640x360 15fps 3.0s + aac audio (see
  `reports/retouch-real-output-ffprobe.json`; input in
  `reports/retouch-real-input-ffprobe.json`)
- Audio: preserved (aac in -> aac out), duration equivalent (3.0s vs 2.986s
  stream rounding; container 3.0s)

## Baked-effect proof (reopen)

- `reports/retouch-real/reopened-000.png` = frame 0 decoded from the ENCODED
  output, compared against `reports/retouch-real/frames/000.png` (source frame)
- bakedDelta = **662304** channel differences (> 0)
- The effect survives encode/decode/reopen: it is baked into the video pixels,
  not just `appliedLayerIds`.

## What this does NOT claim

- Windows packaged EXE E2E remains a separate gate (see below).
- Remote CI green at the final SHA is verified separately.
