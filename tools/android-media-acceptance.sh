#!/usr/bin/env bash
set -euo pipefail

APK="${1:-android-ci-output/KNOUX-X-Android-debug.apk}"
PACKAGE="${2:-dev.knoux.playerx}"
OUTPUT_DIR="${3:-android-ci-output}"
ACTIVITY="${PACKAGE}/.MainActivity"

mkdir -p "$OUTPUT_DIR"

adb wait-for-device
adb install -r "$APK"

# Stage a synthetic media fixture on the device (pushed via adb, not user media).
adb shell mkdir -p /sdcard/Download/knoux-test 2>/dev/null || true
if [ -f "$OUTPUT_DIR/test-video.mp4" ]; then
  adb push "$OUTPUT_DIR/test-video.mp4" /sdcard/Download/knoux-test/test-video.mp4
fi

adb shell am force-stop "$PACKAGE" || true
adb shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$ACTIVITY" | tee "$OUTPUT_DIR/media-launch-start.txt"

# Wait for render
sleep 8
adb shell dumpsys activity activities > "$OUTPUT_DIR/media-activity.txt" 2>&1 || true
adb shell uiautomator dump /sdcard/knoux-ui.xml >/dev/null 2>&1 || true
adb shell cat /sdcard/knoux-ui.xml > "$OUTPUT_DIR/media-ui-hierarchy.xml" 2>/dev/null || true
adb exec-out screencap -p > "$OUTPUT_DIR/media-home.png" 2>/dev/null || true

# Crash check
adb logcat -d > "$OUTPUT_DIR/media-logcat.txt" 2>&1 || true
FATAL_PATTERN='FATAL EXCEPTION|ANR in|has died'
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/media-logcat.txt"; then
  echo "FATAL detected during media acceptance"
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/media-logcat.txt" || true
  echo "FAIL" > "$OUTPUT_DIR/media-verdict.txt"
  exit 1
fi

echo "PASS (launch + no crash; media playback requires manual/instrumentation verification)" > "$OUTPUT_DIR/media-verdict.txt"
echo "Media acceptance (launch stage) PASS"
