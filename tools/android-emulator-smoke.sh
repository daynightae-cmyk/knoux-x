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

png_dimensions() {
  node -e '
const fs = require("fs");
const buffer = fs.readFileSync(process.argv[1]);
if (buffer.length < 24 || buffer.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") process.exit(1);
console.log(buffer.readUInt32BE(16) + "x" + buffer.readUInt32BE(20));
' "$1"
}

read_wm_size() {
  adb_retry shell wm size 2>/dev/null | tr -d '\r' | tee "$OUTPUT_DIR/android-wm-size.txt" || return 1
}

read_wm_density() {
  adb_retry shell wm density 2>/dev/null | tr -d '\r' | tee "$OUTPUT_DIR/android-wm-density.txt" || return 1
}

wait_for_display_override() {
  local width="$1"
  local height="$2"
  local density="$3"
  local attempts="${4:-30}"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if read_wm_size | grep -Fq "Override size: ${width}x${height}" && \
       read_wm_density | grep -Fq "Override density: ${density}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_density_override() {
  local density="$1"
  local attempts="${2:-30}"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if read_wm_density | grep -Fq "Override density: ${density}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_display_reset() {
  local attempts="${1:-30}"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if ! read_wm_size | grep -Fq "Override size:" && \
       ! read_wm_density | grep -Fq "Override density:"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# A settled frame means: the captured PNG has exactly the requested physical
# dimensions, contains real rendered pixels, and is byte-identical to a frame
# captured at least one second later. Anything else (stale framebuffer, partial
# relayout, wrong density) fails the run instead of being stored as evidence.
wait_for_settled_frame() {
  local destination="$1"
  local width="$2"
  local height="$3"
  local attempts="${4:-30}"
  local attempt
  local settle="${destination}.settle.png"
  rm -f "$settle"
  for attempt in $(seq 1 "$attempts"); do
    if capture_screen "$destination" && node tools/verify-android-screen.cjs "$destination" && \
       [[ "$(png_dimensions "$destination" 2>/dev/null)" == "${width}x${height}" ]]; then
      if [[ -s "$settle" ]] && cmp -s "$settle" "$destination"; then
        rm -f "$settle"
        return 0
      fi
      cp "$destination" "$settle"
      sleep 1
      continue
    fi
    rm -f "$settle"
    sleep 1
  done
  rm -f "$settle"
  return 1
}

foreground_activity_ready() {
  adb_retry shell dumpsys activity activities > "$OUTPUT_DIR/android-activity-live.txt" || return 1
  grep -Fq "$PACKAGE/.MainActivity" "$OUTPUT_DIR/android-activity-live.txt"
}

native_splash_gone() {
  adb_retry shell dumpsys window windows > "$OUTPUT_DIR/android-window.txt" || return 1
  ! grep -Fq "Splash Screen $PACKAGE" "$OUTPUT_DIR/android-window.txt"
}

assert_no_recovery_screen() {
  local hierarchy="$OUTPUT_DIR/android-ui-hierarchy.xml"
  if adb_retry shell uiautomator dump /sdcard/knoux-ui.xml >/dev/null 2>&1; then
    adb_retry shell cat /sdcard/knoux-ui.xml > "$hierarchy" 2>/dev/null || true
    if [[ -s "$hierarchy" ]] && grep -Eqi 'KNOUX RECOVERY MODE|The interface encountered an unexpected error|Reload Knoux X' "$hierarchy"; then
      echo 'KNOUX recovery UI was rendered instead of the product interface.' >&2
      return 1
    fi
  fi
  return 0
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

# Release WebViews may suppress JavaScript console.info output even when React
# has rendered successfully. Treat the JS marker as optional corroboration, not
# as the only readiness signal. Acceptance requires the real MainActivity to be
# foreground, the Android starting/splash window to be gone, and two consecutive
# screenshots to contain nonblank rendered application pixels.
UI_READY=false
MARKER_READY=false
READINESS_SOURCE=''
for attempt in $(seq 1 45); do
  if adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" && \
     grep -q 'KNOUX_ANDROID_UI_READY' "$OUTPUT_DIR/android-launch-log.txt"; then
    MARKER_READY=true
  fi

  if foreground_activity_ready && native_splash_gone && \
     wait_for_rendered_screen "$OUTPUT_DIR/android-launch.png" 1; then
    sleep 1
    if foreground_activity_ready && native_splash_gone && \
       wait_for_rendered_screen "$OUTPUT_DIR/android-launch.png" 1; then
      UI_READY=true
      if [[ "$MARKER_READY" == true ]]; then
        READINESS_SOURCE='javascript-marker+foreground+visual'
      else
        READINESS_SOURCE='foreground+visual'
      fi
      break
    fi
  fi
  sleep 2
done

printf '%s\n' "${READINESS_SOURCE:-not-ready}" > "$OUTPUT_DIR/android-ui-readiness.txt"

if [[ "$UI_READY" != true ]]; then
  capture_screen "$OUTPUT_DIR/android-launch.png" || true
  adb_retry shell dumpsys activity activities > "$OUTPUT_DIR/android-activity-live.txt" || true
  adb_retry shell dumpsys window windows > "$OUTPUT_DIR/android-window.txt" || true
  adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" || true
  echo 'Android did not render a real KNOUX interface within 90 seconds.' >&2
  exit 1
fi

if ! assert_no_recovery_screen; then
  adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" || true
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

FATAL_PATTERN='FATAL EXCEPTION|Unable to start activity|ANR in dev\.knoux\.playerx|Process: dev\.knoux\.playerx.*(has died|FATAL)|chromium.*(Uncaught|ReferenceError|TypeError)|Capacitor/Console.*Uncaught|KNOUX_RENDER_BOUNDARY_ERROR|KNOUX renderer failure|RUNTIME_BRIDGE_OWNERSHIP_CONFLICT|DESKTOP_BRIDGE_INCOMPLETE|selectedWorkspace'
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt"; then
  echo 'Fatal KNOUX startup error detected in Android logcat.' >&2
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

# Exercise the requested phone sizes. Every screenshot must prove three things:
# the size AND density overrides are applied (read back from wm), the captured
# PNG has exactly the requested physical dimensions, and the frame is settled
# (two byte-identical captures at least one second apart). A lagging capture is
# a failed run, never stored evidence with a misleading filename.
rm -f "$OUTPUT_DIR/android-viewport-report.txt"
adb_retry shell wm density 160
if ! wait_for_density_override 160; then
  echo 'Android display density override did not apply before viewport exercises.' >&2
  exit 1
fi
for SIZE in 360x800 390x844 412x915; do
  WIDTH="${SIZE%x*}"
  HEIGHT="${SIZE#*x}"
  adb_retry shell wm size "$SIZE"
  if ! wait_for_display_override "$WIDTH" "$HEIGHT" 160; then
    echo "Android did not apply viewport override $SIZE at density 160 within 30 seconds." >&2
    exit 1
  fi
  if ! foreground_activity_ready || ! native_splash_gone; then
    echo "KNOUX interface left the foreground while resizing to $SIZE." >&2
    exit 1
  fi
  if ! wait_for_settled_frame "$OUTPUT_DIR/android-phone-$SIZE.png" "$WIDTH" "$HEIGHT" 30; then
    echo "Android did not produce a settled ${WIDTH}x${HEIGHT} KNOUX frame within 30 seconds." >&2
    exit 1
  fi
  printf 'requested=%s applied=%s density=160 png=%s settled=yes\n' \
    "$SIZE" "$(grep -F 'Override size:' "$OUTPUT_DIR/android-wm-size.txt" | tr -d '\r')" \
    "$(png_dimensions "$OUTPUT_DIR/android-phone-$SIZE.png")" >> "$OUTPUT_DIR/android-viewport-report.txt"
  test -n "$(read_pid || true)"
done

adb_retry shell wm size reset
adb_retry shell wm density reset
if ! wait_for_display_reset; then
  echo 'Android display overrides did not reset after viewport exercises.' >&2
  exit 1
fi

if ! assert_no_recovery_screen; then
  adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

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
echo "KNOUX Android launch smoke passed with PID $PID via $READINESS_SOURCE"
