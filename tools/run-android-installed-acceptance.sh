#!/usr/bin/env bash
# One command for emulator-runner, which executes each script line separately.
set -euo pipefail
OUTPUT_DIR="${1:?output directory required}"
APK="${2:?APK path required}"
bash tools/android-emulator-smoke.sh "$APK" dev.knoux.playerx "$OUTPUT_DIR"
adb push "$OUTPUT_DIR/KNOUX-QA.mp4" /sdcard/Download/KNOUX-QA.mp4
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/KNOUX-QA.mp4
adb push "$OUTPUT_DIR/KNOUX-QA.png" /sdcard/Download/KNOUX-QA.png
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/KNOUX-QA.png
adb shell mkdir -p /sdcard/Movies/KNOUX-Discovery /sdcard/DCIM/KNOUX-Discovery
adb push "$OUTPUT_DIR/KNOUX-QA.mp4" /sdcard/Movies/KNOUX-Discovery/KNOUX-Discovery-A.mp4
adb push "$OUTPUT_DIR/KNOUX-QA.mp4" /sdcard/DCIM/KNOUX-Discovery/KNOUX-Discovery-B.mp4
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Movies/KNOUX-Discovery/KNOUX-Discovery-A.mp4
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/DCIM/KNOUX-Discovery/KNOUX-Discovery-B.mp4
KNOUX_ANDROID_EVIDENCE_DIR="$OUTPUT_DIR" node tools/android-real-workflows.cjs
