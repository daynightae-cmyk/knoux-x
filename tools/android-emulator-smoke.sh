#!/usr/bin/env bash
set -euo pipefail

APK="${1:-android-ci-output/KNOUX-X-Android-debug.apk}"
PACKAGE="${2:-dev.knoux.playerx}"
OUTPUT_DIR="${3:-android-ci-output}"

if [[ ! -s "$APK" ]]; then
  echo "KNOUX Android APK is missing or empty: $APK" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

adb install -r "$APK"
adb logcat -c
adb shell am force-stop "$PACKAGE" || true
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1

PID=''
for attempt in $(seq 1 25); do
  PID="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$PID" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$PID" ]]; then
  echo 'KNOUX Android process did not start.' >&2
  adb logcat -d -t 1200 > "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

# Wait for the React runtime marker and then require pixels that are materially
# different from the KNOUX launch background. This catches a WebView that has
# executed JavaScript behind a splash/window background but has not painted UI.
UI_READY=false
for attempt in $(seq 1 45); do
  adb logcat -d > "$OUTPUT_DIR/android-launch-log.txt"
  if grep -q 'KNOUX_ANDROID_UI_READY' "$OUTPUT_DIR/android-launch-log.txt"; then
    adb exec-out screencap -p > "$OUTPUT_DIR/android-launch.png"
    if node tools/verify-android-screen.cjs "$OUTPUT_DIR/android-launch.png"; then
      UI_READY=true
      break
    fi
  fi
  sleep 2
done

if [[ "$UI_READY" != true ]]; then
  adb exec-out screencap -p > "$OUTPUT_DIR/android-launch.png" || true
  echo 'Android did not render a nonblank KNOUX interface within 90 seconds.' >&2
  exit 1
fi

PID="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
if [[ -z "$PID" ]]; then
  echo 'KNOUX Android process exited during startup.' >&2
  adb logcat -d -t 1600 > "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

adb shell dumpsys activity activities > "$OUTPUT_DIR/android-activity.txt"
adb logcat -d -t 2000 > "$OUTPUT_DIR/android-launch-log.txt"

if ! grep -q "$PACKAGE" "$OUTPUT_DIR/android-activity.txt"; then
  echo 'KNOUX Android package is not present in the active activity dump.' >&2
  exit 1
fi

FATAL_PATTERN='FATAL EXCEPTION|Unable to start activity|Process: dev\.knoux\.playerx.*(has died|FATAL)|chromium.*(Uncaught|ReferenceError|TypeError)|Capacitor/Console.*Uncaught|RUNTIME_BRIDGE_OWNERSHIP_CONFLICT|DESKTOP_BRIDGE_INCOMPLETE|selectedWorkspace'
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt"; then
  echo 'Fatal KNOUX startup error detected in Android logcat.' >&2
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

# Exercise the three requested phone viewports directly. Avoid UI Automator in
# this smoke gate: on hosted emulators it can stall long enough for ADB/emulator
# teardown and previously turned a healthy APK launch into an infrastructure
# failure. Screenshot + process + fatal-log checks provide deterministic proof.
adb shell wm density 160
for SIZE in 360x800 390x844 412x915; do
  adb shell wm size "$SIZE"
  sleep 2
  adb exec-out screencap -p > "$OUTPUT_DIR/android-phone-$SIZE.png"
  node tools/verify-android-screen.cjs "$OUTPUT_DIR/android-phone-$SIZE.png"
  test -n "$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r')"
done

adb shell wm size reset
adb shell wm density reset
sleep 1

adb logcat -d -t 2400 > "$OUTPUT_DIR/android-launch-log.txt"
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt"; then
  echo 'Fatal KNOUX error detected after viewport exercises.' >&2
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

adb shell input keyevent KEYCODE_HOME
sleep 1
adb exec-out screencap -p > "$OUTPUT_DIR/android-launcher.png" || true

printf '%s\n' "$PID" > "$OUTPUT_DIR/android-launch.pid"
printf '%s\n' 'PASS' > "$OUTPUT_DIR/android-launch.verdict"
echo "KNOUX Android launch smoke passed with PID $PID"
