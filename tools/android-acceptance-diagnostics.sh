#!/usr/bin/env bash
# Keep evidence on the host before an emulator or renderer disappears.
# The wrapped command's exit status is authoritative; diagnostics never pass it.
set -euo pipefail
OUTPUT_DIR="${1:?output directory required}"
shift
if [[ "$#" -eq 0 ]]; then echo 'An acceptance command is required.' >&2; exit 2; fi
mkdir -p "$OUTPUT_DIR/diagnostics"
DIAGNOSTICS="$OUTPUT_DIR/diagnostics"
adb logcat -b all -v threadtime > "$DIAGNOSTICS/logcat-live.txt" 2>&1 &
LOGCAT_PID=$!
adb track-devices > "$DIAGNOSTICS/adb-transports.txt" 2>&1 &
TRANSPORT_PID=$!
(
  while true; do
    date -u '+%Y-%m-%dT%H:%M:%SZ'
    free -m
    # Host-wide free memory does not reveal a runner cgroup OOM limit.
    for metric in memory.current memory.max memory.events; do
      if [[ -r "/sys/fs/cgroup/$metric" ]]; then
        printf 'cgroup %s: ' "$metric"
        cat "/sys/fs/cgroup/$metric"
      fi
    done
    ps -eo pid,comm,rss,pcpu | awk 'NR == 1 || /qemu|emulator|adb|node/'
    sleep 2
  done
) > "$DIAGNOSTICS/host-health.txt" 2>&1 &
HEALTH_PID=$!

finish() {
  local status=$?
  trap - EXIT
  set +e
  printf 'acceptance_exit_code=%s\n' "$status" > "$DIAGNOSTICS/command-status.txt"
  timeout 8s sudo -n dmesg --ctime > "$DIAGNOSTICS/host-kernel.txt" 2>&1
  timeout 8s sudo -n journalctl -k --no-pager -n 250 > "$DIAGNOSTICS/host-kernel-journal.txt" 2>&1
  timeout 8s adb devices -l > "$DIAGNOSTICS/devices-at-exit.txt" 2>&1
  timeout 8s adb shell dumpsys activity exit-info dev.knoux.playerx > "$DIAGNOSTICS/app-exit-info.txt" 2>&1
  timeout 8s adb shell dumpsys meminfo dev.knoux.playerx > "$DIAGNOSTICS/app-memory.txt" 2>&1
  timeout 8s adb shell dumpsys webviewupdate > "$DIAGNOSTICS/webview-provider.txt" 2>&1
  timeout 8s adb shell dumpsys activity activities > "$DIAGNOSTICS/activities.txt" 2>&1
  timeout 8s adb exec-out uiautomator dump /dev/tty > "$DIAGNOSTICS/ui-at-exit.xml" 2>&1
  timeout 8s adb logcat -d -b crash > "$DIAGNOSTICS/crash-buffer.txt" 2>&1
  kill "$LOGCAT_PID" "$TRANSPORT_PID" "$HEALTH_PID" 2>/dev/null
  wait "$LOGCAT_PID" "$TRANSPORT_PID" "$HEALTH_PID" 2>/dev/null
  exit "$status"
}
trap finish EXIT
"$@"
