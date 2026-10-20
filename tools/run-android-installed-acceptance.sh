#!/usr/bin/env bash
# One command for emulator-runner, which executes each script line separately.
set -euo pipefail
OUTPUT_DIR="${1:?output directory required}"
APK="${2:?APK path required}"
bash tools/android-emulator-smoke.sh "$APK" dev.knoux.playerx "$OUTPUT_DIR"
adb push "$OUTPUT_DIR/KNOUX-QA.mp4" /sdcard/Download/KNOUX-QA.mp4
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/KNOUX-QA.mp4
KNOUX_ANDROID_EVIDENCE_DIR="$OUTPUT_DIR" node tools/android-real-workflows.cjs
