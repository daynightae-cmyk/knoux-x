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

# The renderer announces the actionable interface once the splash overlay is
# dismissed. The debug and acceptance lanes enable WebView debugging, so the
# console marker reaches logcat. The payload is plain text so logcat quoting
# cannot corrupt it.
write_readiness_marker() {
  local log="$1"
  local out="$2"
  local payload
  payload="$(grep -o 'KNOUX_ANDROID_UI_READY screen=[a-zA-Z]* primaryAction=true' "$log" 2>/dev/null | head -n 1 || true)"
  if [[ -z "$payload" ]]; then
    return 1
  fi
  local screen
  screen="$(printf '%s' "$payload" | sed -n 's/.*screen=\([a-zA-Z]*\).*/\1/p')"
  if [[ -z "$screen" ]]; then
    return 1
  fi
  printf '{"ready":true,"screen":"%s","primaryAction":true}\n' "$screen" > "$out"
  return 0
}

# A rendered splash is not a ready application. The renderer announces the
# actionable interface in its console once the splash overlay is dismissed;
# the debug and acceptance lanes enable WebView debugging so that marker
# reaches logcat and is stored next to the frame as a trusted sidecar.
# The verifier then refuses the frame unless the marker says the application
# is ready and the frame carries real rendered content.
#
# Capacitor forwards the WebView console to logcat only while the installed
# application is debuggable, because android.loggingBehavior defaults to the
# debug-only behaviour. A signed release APK therefore never emits the renderer
# marker, so the marker may only be required on lanes that can carry it.
app_is_debuggable() {
  adb_retry shell dumpsys package "$PACKAGE" 2>/dev/null | grep -q 'DEBUGGABLE'
}

wait_for_home_screen() {
  local destination="$1"
  local attempts="${2:-30}"
  local attempt
  local marker_args=()
  if [[ "$MARKER_SUPPORTED" == true ]]; then
    marker_args+=('--require-marker')
  fi
  for attempt in $(seq 1 "$attempts"); do
    if capture_screen "$destination" && node tools/verify-android-screen.cjs "$destination" "${marker_args[@]}"; then
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

# The cached process can outlive finish(), so task state (topResumedActivity)
# is the authoritative signal for whether KNOUX still owns the foreground.
app_is_foreground() {
  adb_retry shell dumpsys activity activities > "$OUTPUT_DIR/android-activity-live.txt" || return 1
  local resumed
  resumed="$(grep -E 'topResumedActivity=|mResumedActivity=' "$OUTPUT_DIR/android-activity-live.txt" | head -n 1)"
  [[ -n "$resumed" && "$resumed" == *"$PACKAGE/.MainActivity"* ]]
}

wait_for_app_exit() {
  local attempts="${1:-15}"
  local attempt resumed
  for attempt in $(seq 1 "$attempts"); do
    if adb_retry shell dumpsys activity activities > "$OUTPUT_DIR/android-activity-live.txt" 2>/dev/null; then
      resumed="$(grep -E 'topResumedActivity=|mResumedActivity=' "$OUTPUT_DIR/android-activity-live.txt" | head -n 1)"
      if [[ -n "$resumed" && "$resumed" != *"$PACKAGE/.MainActivity"* ]]; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
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

# The emulator can report a completed boot while the launcher is still starting;
# a launcher ANR then paints "Pixel Launcher isn't responding" over the app even
# though KNOUX X itself is healthy. Wait for boot completion and give the
# launcher a bounded head start before installing or launching anything.
wait_for_launcher_ready() {
  local attempts="${1:-60}"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
      sleep 5
      printf 'boot_completed=1 launcher_head_start_seconds=5\n' > "$OUTPUT_DIR/android-launcher-readiness.txt"
      return 0
    fi
    sleep 1
  done
  return 1
}

foreign_anr_packages() {
  adb_retry shell dumpsys window windows 2>/dev/null | tr -d '\r' > "$OUTPUT_DIR/android-window.txt" || return 1
  sed -n 's/.*Application Not Responding: \([^ }]*\).*/\1/p' "$OUTPUT_DIR/android-window.txt" | sort -u
}

# Tap the dialog's own "Wait" button only after proving the ANR dialog is the
# current topmost UI. This never sends a blind BACK into KNOUX X.
tap_anr_wait() {
  local remote_xml="/sdcard/knoux-anr-ui.xml"
  local local_xml="$OUTPUT_DIR/android-anr-ui.xml"
  if ! adb_retry shell uiautomator dump "$remote_xml" >/dev/null 2>&1; then return 1; fi
  if ! adb_retry shell cat "$remote_xml" > "$local_xml" 2>/dev/null; then return 1; fi
  if ! grep -Eqi "Application Not Responding|isn't responding|aerr_wait" "$local_xml"; then return 1; fi
  local point x y
  point="$(node - "$local_xml" <<'NODE'
const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => match[0]);
const wait = nodes.find((node) => (/\btext="Wait"/.test(node) || /resource-id="android:id\/aerr_wait"/.test(node)) && /\bbounds="\[\d+,\d+\]\[\d+,\d+\]"/.test(node));
if (!wait) process.exit(1);
const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(wait);
console.log(`${Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)} ${Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)}`);
NODE
)" || return 1
  read -r x y <<< "$point"
  adb_retry shell input tap "$x" "$y"
}

ensure_app_foreground() {
  adb_retry shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$ACTIVITY" >> "$OUTPUT_DIR/android-launch-start.txt" || return 1
  local attempt
  for attempt in $(seq 1 30); do
    if foreground_activity_ready; then return 0; fi
    sleep 1
  done
  return 1
}

# Returns 0 when no foreign ANR exists, 2 when one was dismissed, 1 when a
# dialog could not be cleared safely or belongs to KNOUX X itself.
dismiss_foreign_anr() {
  local packages
  packages="$(foreign_anr_packages)" || return 1
  if [[ -z "$packages" ]]; then return 0; fi
  printf '%s\n' "$packages" >> "$OUTPUT_DIR/android-foreign-anr.txt"
  local pkg
  while IFS= read -r pkg; do
    [[ -z "$pkg" ]] && continue
    if [[ "$pkg" == "$PACKAGE" ]]; then
      echo "KNOUX X itself is not responding; refusing to dismiss the app's own ANR." >&2
      return 1
    fi
    echo "Foreign system ANR detected for $pkg; attempting bounded dismissal." >&2
    if ! tap_anr_wait; then
      adb_retry shell input keyevent KEYCODE_BACK || true
    fi
    sleep 2
    if foreign_anr_packages | grep -Fxq "$pkg"; then
      case "$pkg" in
        com.google.android.apps.nexuslauncher|com.android.launcher3)
          echo "ANR persisted; force-stopping the hung launcher $pkg (never KNOUX X)." >&2
          adb_retry shell am force-stop "$pkg" || return 1
          ;;
        *)
          echo "Foreign ANR for $pkg did not clear with Wait/BACK; failing closed." >&2
          return 1
          ;;
      esac
      sleep 2
      if foreign_anr_packages | grep -Fxq "$pkg"; then
        echo "ANR dialog for $pkg is still present after bounded recovery; failing closed." >&2
        return 1
      fi
    fi
  done <<< "$packages"
  return 2
}

handle_foreign_anr() {
  local status=0
  dismiss_foreign_anr || status=$?
  case "$status" in
    0) return 0 ;;
    2)
      echo 'Foreign ANR dismissed; resuming KNOUX X to restore foreground.' >&2
      ensure_app_foreground || return 1
      return 0
      ;;
    *) return 1 ;;
  esac
}

adb wait-for-device
if ! wait_for_launcher_ready; then
  echo 'Android did not report boot completion within 60 seconds.' >&2
  adb_retry shell getprop sys.boot_completed > "$OUTPUT_DIR/android-boot-completed.txt" || true
  exit 1
fi
preinstall_anr_status=0
dismiss_foreign_anr || preinstall_anr_status=$?
if [[ "$preinstall_anr_status" -ne 0 && "$preinstall_anr_status" -ne 2 ]]; then
  adb_retry shell dumpsys window windows > "$OUTPUT_DIR/android-window.txt" || true
  adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" || true
  echo 'A foreign system ANR dialog blocked the device before KNOUX X was installed.' >&2
  exit 1
fi
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

# The renderer announces the actionable interface once the splash overlay is
# dismissed. The debug lane builds the APK with WebView debugging enabled, so
# that console marker reaches logcat and is stored next to the frame as a
# trusted sidecar. Acceptance requires the real MainActivity to be foreground,
# the Android starting/splash window to be gone, the renderer marker in logcat,
# and a frame with real rendered content. A rendered splash can satisfy none of
# those at once, so the launch is never reported as ready from the splash.
UI_READY=false
MARKER_READY=false
READINESS_SOURCE=''
SPLASH_FRAME_CAPTURED=false
MARKER_SUPPORTED=false
if app_is_debuggable; then
  MARKER_SUPPORTED=true
fi
printf '%s\n' "$MARKER_SUPPORTED" > "$OUTPUT_DIR/android-console-marker-supported.txt"
for attempt in $(seq 1 60); do
  if (( attempt % 3 == 0 )); then
    if ! handle_foreign_anr; then
      adb_retry shell dumpsys window windows > "$OUTPUT_DIR/android-window.txt" || true
      adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" || true
      echo 'A foreign system ANR dialog blocked KNOUX X during launch readiness.' >&2
      exit 1
    fi
  fi
  if adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" && \
     grep -q 'KNOUX_ANDROID_UI_READY' "$OUTPUT_DIR/android-launch-log.txt"; then
    if write_readiness_marker "$OUTPUT_DIR/android-launch-log.txt" "$OUTPUT_DIR/android-launch.png.ready.json"; then
      MARKER_READY=true
    fi
  fi

  # Keep the launch animation as its own evidence frame while the renderer has
  # not announced the actionable interface yet. The final frame below is the
  # actionable application.
  if [[ "$SPLASH_FRAME_CAPTURED" != true && "$MARKER_READY" != true ]] && \
     capture_screen "$OUTPUT_DIR/android-splash-frame.png"; then
    SPLASH_FRAME_CAPTURED=true
  fi

  if foreground_activity_ready && native_splash_gone && \
     wait_for_home_screen "$OUTPUT_DIR/android-launch.png" 10; then
    sleep 1
    if foreground_activity_ready && native_splash_gone && \
       wait_for_home_screen "$OUTPUT_DIR/android-launch.png" 5; then
      UI_READY=true
      if [[ "$MARKER_READY" == true ]]; then
        READINESS_SOURCE='javascript-marker+foreground+visual+ready-ui'
      else
        READINESS_SOURCE='foreground+visual+ready-ui'
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

if ! handle_foreign_anr; then
  adb_retry shell dumpsys window windows > "$OUTPUT_DIR/android-window.txt" || true
  adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" || true
  echo 'A foreign system ANR dialog blocked KNOUX X after launch readiness.' >&2
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
# logcat was cleared immediately before launch. Retain process-start records so
# standalone UiAutomation crashes can be attributed even without Process: lines.
adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt"

if ! grep -q "$PACKAGE" "$OUTPUT_DIR/android-activity.txt"; then
  echo 'KNOUX Android package is not present in the active activity dump.' >&2
  exit 1
fi

FATAL_PATTERN='FATAL EXCEPTION|Unable to start activity|ANR in dev\.knoux\.playerx|Process: dev\.knoux\.playerx.*(has died|FATAL)|chromium.*(Uncaught|ReferenceError|TypeError)|Capacitor/Console.*Uncaught|KNOUX_RENDER_BOUNDARY_ERROR|KNOUX renderer failure|RUNTIME_BRIDGE_OWNERSHIP_CONFLICT|DESKTOP_BRIDGE_INCOMPLETE|selectedWorkspace'
classify_startup_log() {
  node - "$OUTPUT_DIR" "$PACKAGE" "$PID" <<'JS'
const fs = require('node:fs');
const { classifyStartupLog } = require('./tools/android-native-core.cjs');
const [output, packageName, pid] = process.argv.slice(2);
const result = classifyStartupLog(fs.readFileSync(`${output}/android-launch-log.txt`, 'utf8'), packageName, pid);
fs.writeFileSync(`${output}/android-app-startup-log.txt`, result.appLog);
fs.writeFileSync(`${output}/android-foreign-crashes.json`, JSON.stringify(result.foreignCrashes, null, 2));
JS
}
classify_startup_log
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/android-app-startup-log.txt"; then
  echo 'Fatal KNOUX startup error detected in Android logcat.' >&2
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/android-app-startup-log.txt" || true
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
  if ! handle_foreign_anr; then
    adb_retry shell dumpsys window windows > "$OUTPUT_DIR/android-window.txt" || true
    echo "A foreign system ANR dialog blocked the viewport exercise at $SIZE." >&2
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

if ! handle_foreign_anr; then
  adb_retry shell dumpsys window windows > "$OUTPUT_DIR/android-window.txt" || true
  echo 'A foreign system ANR dialog blocked KNOUX X after the viewport exercises.' >&2
  exit 1
fi

if ! assert_no_recovery_screen; then
  adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

adb_retry logcat -d > "$OUTPUT_DIR/android-launch-log.txt"
classify_startup_log
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/android-app-startup-log.txt"; then
  echo 'Fatal KNOUX error detected after viewport exercises.' >&2
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/android-app-startup-log.txt" || true
  exit 1
fi

# ── Hardware back-button policy (ANDROID_BACK_BUTTON_UNWIRED closure) ───────
# The KNOUX JS back handler owns the hardware back button once the Capacitor
# App plugin emits `backButton`. Root-view policy: the first press arms exit
# and shows an in-app notice WITHOUT leaving the foreground; a quick second
# press inside the confirmation window exits. Both halves are exercised.
#
# Dismissing a foreign ANR dialog may itself send BACK and arm the 2s exit
# window, so settle past the window before arming manually. Android can keep
# the cached process alive after finish(), so foreground/task state (not
# pidof) is the acceptance signal.
sleep 3
if ! app_is_foreground; then
  echo 'KNOUX is not in the foreground before the hardware back exercise.' >&2
  adb_retry logcat -d -t 1600 > "$OUTPUT_DIR/android-back-log.txt" || true
  exit 1
fi

adb_retry logcat -c || true
adb_retry shell input keyevent KEYCODE_BACK
sleep 0.6

if ! app_is_foreground; then
  echo 'KNOUX left the foreground on the first hardware back press; the exit confirmation gate is not active.' >&2
  adb_retry logcat -d -t 1600 > "$OUTPUT_DIR/android-back-log.txt" || true
  exit 1
fi

if [[ -z "$(read_pid || true)" ]]; then
  echo 'KNOUX exited on the first hardware back press; the back policy is not active.' >&2
  adb_retry logcat -d -t 1600 > "$OUTPUT_DIR/android-back-log.txt" || true
  exit 1
fi

# Safe to take a slow screenshot only after the first press is verified.
capture_screen "$OUTPUT_DIR/android-back-first-press.png" || true
adb_retry logcat -d -t 1600 > "$OUTPUT_DIR/android-back-log.txt" || true
if grep -q 'KNOUX_ANDROID_BACK_DECISION exit-armed' "$OUTPUT_DIR/android-back-log.txt"; then
  printf '%s\n' 'intercepted' > "$OUTPUT_DIR/android-back-verdict.txt"
else
  # Release WebViews may suppress the console marker; the foreground
  # assertions above remain the acceptance signal when it is absent.
  printf '%s\n' 'survived-without-marker' > "$OUTPUT_DIR/android-back-verdict.txt"
fi

# The screenshot and log dump may span several seconds; re-verify that a
# pending window transition did not take KNOUX down after the single press.
if ! app_is_foreground; then
  echo 'KNOUX left the foreground after the single hardware back press.' >&2
  adb_retry logcat -d -t 1600 > "$OUTPUT_DIR/android-back-log.txt" || true
  exit 1
fi

# A press after the window has expired must only re-arm, never exit.
sleep 3
adb_retry shell input keyevent KEYCODE_BACK
sleep 0.6
if ! app_is_foreground; then
  echo 'KNOUX exited on a delayed second hardware back press; the confirmation window is not enforced.' >&2
  adb_retry logcat -d -t 1600 > "$OUTPUT_DIR/android-back-log.txt" || true
  exit 1
fi

# Let that arm expire, then two presses inside the 2s window must exit. The
# pair runs on-device so adb latency cannot stretch the 400ms gap.
sleep 3
adb_retry shell 'input keyevent KEYCODE_BACK; sleep 0.4; input keyevent KEYCODE_BACK'

if ! wait_for_app_exit 15; then
  echo 'KNOUX did not apply the root exit policy on a double hardware back press.' >&2
  adb_retry logcat -d -t 1600 > "$OUTPUT_DIR/android-back-log.txt" || true
  exit 1
fi

printf '%s\n' 'PASS' > "$OUTPUT_DIR/android-back-policy.verdict"
echo 'KNOUX Android hardware back policy verified (intercept, then double-press exit).'

adb_retry shell input keyevent KEYCODE_HOME || true
sleep 1
capture_screen "$OUTPUT_DIR/android-launcher.png" || true

printf '%s\n' "$PID" > "$OUTPUT_DIR/android-launch.pid"
printf '%s\n' 'PASS' > "$OUTPUT_DIR/android-launch.verdict"
echo "KNOUX Android launch smoke passed with PID $PID via $READINESS_SOURCE"
