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

wait_for_rendered_screen() {
  local destination="$1"
  local attempts="${2:-30}"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if capture_screen "$destination" && node tools/verify-android-screen.cjs "$destination"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

adb wait-for-device
adb_retry install -r "$APK"
adb_retry logcat -c
adb_retry shell am force-stop "$PACKAGE" || true

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

# JavaScript readiness is necessary but not sufficient: only accept a frame
# after the central WebView plane contains real rendered KNOUX pixels.
UI_READY=false
for attempt in $(seq 1 45); do
  if adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" && \
     grep -q 'KNOUX_ANDROID_UI_READY' "$OUTPUT_DIR/android-launch-log.txt"; then
    if wait_for_rendered_screen "$OUTPUT_DIR/android-launch.png" 1; then
      UI_READY=true
      break
    fi
  fi
  sleep 2
done

if [[ "$UI_READY" != true ]]; then
  capture_screen "$OUTPUT_DIR/android-launch.png" || true
  echo 'Android did not render a real KNOUX interface within 90 seconds.' >&2
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

# Exercise the requested phone sizes. A resize can briefly expose the window
# background while WebView relayouts, so wait independently at every size until
# real KNOUX pixels are present; never capture a transient blank frame as proof.
adb_retry shell wm density 160
for SIZE in 360x800 390x844 412x915; do
  adb_retry shell wm size "$SIZE"
  if ! wait_for_rendered_screen "$OUTPUT_DIR/android-phone-$SIZE.png" 30; then
    echo "Android did not render KNOUX at viewport $SIZE within 30 seconds." >&2
    exit 1
  fi
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
