#!/usr/bin/env bash
set -euo pipefail

APK="${1:-android-ci-output/KNOUX-X-Android-debug.apk}"
PACKAGE="${2:-dev.knoux.playerx}"
OUTPUT_DIR="${3:-android-ci-output}"
ACTIVITY="${PACKAGE}/.MainActivity"

if [[ ! -s "$APK" ]]; then
  echo "KNOUX Android APK is missing or empty: $APK" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

adb_retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if adb "$@"; then
      return 0
    fi
    echo "ADB command retry $attempt/5: adb $*" >&2
    adb wait-for-device >/dev/null 2>&1 || true
    sleep 1
  done
  return 1
}

capture_screen() {
  local destination="$1"
  local temp="${destination}.tmp"
  rm -f "$temp"
  if adb_retry exec-out screencap -p > "$temp" && [[ -s "$temp" ]]; then
    mv "$temp" "$destination"
    return 0
  fi
  rm -f "$temp"
  return 1
}

read_pid() {
  local value=''
  local attempt
  for attempt in 1 2 3; do
    value="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
    adb wait-for-device >/dev/null 2>&1 || true
    sleep 1
  done
  return 1
}

adb wait-for-device
adb_retry install -r "$APK"
adb_retry logcat -c
adb_retry shell am force-stop "$PACKAGE" || true

# Launch the exact manifest activity instead of relying on monkey. The hosted
# API 35 image can accept a monkey event without resolving/starting the target
# package while the launcher is still finishing first-boot package updates.
adb_retry shell am start -W \
  -a android.intent.action.MAIN \
  -c android.intent.category.LAUNCHER \
  -n "$ACTIVITY" | tee "$OUTPUT_DIR/android-launch-start.txt"

if grep -Eqi '(^|[[:space:]])Error:' "$OUTPUT_DIR/android-launch-start.txt"; then
  echo 'Android activity manager rejected the KNOUX launch.' >&2
  exit 1
fi

PID=''
for attempt in $(seq 1 30); do
  PID="$(read_pid || true)"
  if [[ -n "$PID" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$PID" ]]; then
  echo 'KNOUX Android process did not start.' >&2
  adb logcat -d -t 1600 > "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

# Wait for React to commit two animation frames and independently require real
# painted pixels. A static #090B10 launch surface is never accepted as success.
UI_READY=false
for attempt in $(seq 1 45); do
  if adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt"; then
    if grep -q 'KNOUX_ANDROID_UI_READY' "$OUTPUT_DIR/android-launch-log.txt"; then
      if capture_screen "$OUTPUT_DIR/android-launch.png" && node tools/verify-android-screen.cjs "$OUTPUT_DIR/android-launch.png"; then
        UI_READY=true
        break
      fi
    fi
  fi
  sleep 2
done

if [[ "$UI_READY" != true ]]; then
  capture_screen "$OUTPUT_DIR/android-launch.png" || true
  echo 'Android did not render a nonblank KNOUX interface within 90 seconds.' >&2
  exit 1
fi

PID="$(read_pid || true)"
if [[ -z "$PID" ]]; then
  echo 'KNOUX Android process exited during startup.' >&2
  adb logcat -d -t 2000 > "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

adb_retry shell dumpsys activity activities > "$OUTPUT_DIR/android-activity.txt"
adb_retry logcat -d -t 2400 > "$OUTPUT_DIR/android-launch-log.txt"

if ! grep -q "$PACKAGE" "$OUTPUT_DIR/android-activity.txt"; then
  echo 'KNOUX Android package is not present in the active activity dump.' >&2
  exit 1
fi

FATAL_PATTERN='FATAL EXCEPTION|Unable to start activity|ANR in dev\.knoux\.playerx|Process: dev\.knoux\.playerx.*(has died|FATAL)|chromium.*(Uncaught|ReferenceError|TypeError)|Capacitor/Console.*Uncaught|RUNTIME_BRIDGE_OWNERSHIP_CONFLICT|DESKTOP_BRIDGE_INCOMPLETE|selectedWorkspace'
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt"; then
  echo 'Fatal KNOUX startup error detected in Android logcat.' >&2
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

# Exercise the requested physical phone viewport sizes. Each size must retain a
# living process and a nonblank rendered KNOUX frame.
adb_retry shell wm density 160
for SIZE in 360x800 390x844 412x915; do
  adb_retry shell wm size "$SIZE"
  sleep 2
  capture_screen "$OUTPUT_DIR/android-phone-$SIZE.png"
  node tools/verify-android-screen.cjs "$OUTPUT_DIR/android-phone-$SIZE.png"
  test -n "$(read_pid || true)"
done

adb_retry shell wm size reset
adb_retry shell wm density reset
sleep 1

adb_retry logcat -d -t 2800 > "$OUTPUT_DIR/android-launch-log.txt"
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt"; then
  echo 'Fatal KNOUX error detected after viewport exercises.' >&2
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

adb_retry shell input keyevent KEYCODE_HOME || true
sleep 1
capture_screen "$OUTPUT_DIR/android-launcher.png" || true

printf '%s\n' "$PID" > "$OUTPUT_DIR/android-launch.pid"
printf '%s\n' 'PASS' > "$OUTPUT_DIR/android-launch.verdict"
echo "KNOUX Android launch smoke passed with PID $PID"
