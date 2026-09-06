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

sleep 10
PID="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
if [[ -z "$PID" ]]; then
  echo 'KNOUX Android process exited during startup.' >&2
  adb logcat -d -t 1600 > "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

adb shell dumpsys activity activities > "$OUTPUT_DIR/android-activity.txt"
adb logcat -d -t 2000 > "$OUTPUT_DIR/android-launch-log.txt"
adb exec-out screencap -p > "$OUTPUT_DIR/android-launch.png" || true
adb shell uiautomator dump /sdcard/knoux-ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/knoux-ui.xml "$OUTPUT_DIR/android-ui.xml" >/dev/null 2>&1 || true

if ! grep -q "$PACKAGE" "$OUTPUT_DIR/android-activity.txt"; then
  echo 'KNOUX Android package is not present in the active activity dump.' >&2
  exit 1
fi

if [[ -s "$OUTPUT_DIR/android-ui.xml" ]] && ! grep -q "$PACKAGE" "$OUTPUT_DIR/android-ui.xml"; then
  echo 'KNOUX Android package is not present in the UI automation dump.' >&2
  exit 1
fi

FATAL_PATTERN='FATAL EXCEPTION|Unable to start activity|Process: dev\.knoux\.playerx.*(has died|FATAL)|chromium.*(Uncaught|ReferenceError|TypeError)|RUNTIME_BRIDGE_OWNERSHIP_CONFLICT|DESKTOP_BRIDGE_INCOMPLETE'
if grep -Eqi "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt"; then
  echo 'Fatal KNOUX startup error detected in Android logcat.' >&2
  grep -Ein "$FATAL_PATTERN" "$OUTPUT_DIR/android-launch-log.txt" || true
  exit 1
fi

# Capture actual Android screens at the requested phone sizes. UI Automator
# dismisses onboarding using the accessible control, never hidden app state.
adb shell wm density 160
for SIZE in 360x800 390x844 412x915; do
  adb shell wm size "$SIZE"
  sleep 2
  adb shell uiautomator dump /sdcard/knoux-ui.xml >/dev/null
  adb pull /sdcard/knoux-ui.xml "$OUTPUT_DIR/android-ui-$SIZE.xml" >/dev/null
  python3 - "$OUTPUT_DIR/android-ui-$SIZE.xml" <<'PY'
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for node in root.iter('node'):
    label = node.get('text', '') + ' ' + node.get('content-desc', '')
    if ('Skip tour' in label or 'تخطي الجولة' in label) and node.get('clickable') == 'true':
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
        subprocess.run(['adb', 'shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2)], check=True)
        break
PY
  sleep 2
  adb exec-out screencap -p > "$OUTPUT_DIR/android-phone-$SIZE.png"
  adb shell uiautomator dump /sdcard/knoux-ui.xml >/dev/null
  adb pull /sdcard/knoux-ui.xml "$OUTPUT_DIR/android-ui-$SIZE.xml" >/dev/null
  test -n "$(adb shell pidof "$PACKAGE" | tr -d '\r')"
done

adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell input swipe 206 820 206 250 500
sleep 2
adb exec-out screencap -p > "$OUTPUT_DIR/android-launcher.png"
adb shell uiautomator dump /sdcard/knoux-launcher.xml >/dev/null
adb pull /sdcard/knoux-launcher.xml "$OUTPUT_DIR/android-launcher.xml" >/dev/null
adb shell wm size reset
adb shell wm density reset

printf '%s\n' "$PID" > "$OUTPUT_DIR/android-launch.pid"
printf '%s\n' 'PASS' > "$OUTPUT_DIR/android-launch.verdict"
echo "KNOUX Android launch smoke passed with PID $PID"
