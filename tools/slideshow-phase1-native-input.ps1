param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('Wheel')][string]$Action,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [Parameter(Mandatory = $true)][int]$DeltaY
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class KnouxInstalledNativeInput {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect bounds);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);
  public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

$allProcesses = @(Get-CimInstance Win32_Process)
$script:processIds = @([uint32]$ProcessId)
do {
  $added = $false
  foreach ($process in $allProcesses) {
    if ($script:processIds -contains [uint32]$process.ParentProcessId -and $script:processIds -notcontains [uint32]$process.ProcessId) {
      $script:processIds += [uint32]$process.ProcessId
      $added = $true
    }
  }
} while ($added)
$script:candidates = @()
[KnouxInstalledNativeInput]::EnumWindows({
  param([IntPtr]$candidate, [IntPtr]$state)
  $ownerPid = [uint32]0
  [KnouxInstalledNativeInput]::GetWindowThreadProcessId($candidate, [ref]$ownerPid) | Out-Null
  $candidateBounds = [KnouxInstalledNativeInput+Rect]::new()
  if (
    $script:processIds -contains $ownerPid -and
    [KnouxInstalledNativeInput]::IsWindowVisible($candidate) -and
    [KnouxInstalledNativeInput]::GetWindowRect($candidate, [ref]$candidateBounds)
  ) {
    $width = $candidateBounds.Right - $candidateBounds.Left
    $height = $candidateBounds.Bottom - $candidateBounds.Top
    if ($width -ge 640 -and $height -ge 480) {
      $script:candidates += [pscustomobject]@{ Handle = $candidate; Bounds = $candidateBounds; Area = $width * $height }
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$window = $script:candidates | Sort-Object Area -Descending | Select-Object -First 1
if (-not $window) { throw "Installed process tree $ProcessId has no visible application window." }
$handle = $window.Handle
$bounds = $window.Bounds
[KnouxInstalledNativeInput]::BringWindowToTop($handle) | Out-Null
[KnouxInstalledNativeInput]::SetForegroundWindow($handle) | Out-Null
[Windows.Forms.Cursor]::Position = [Drawing.Point]::new($bounds.Left + $X, $bounds.Top + $Y)
$wheel = if ($DeltaY -gt 0) { [int32]-360 } else { [int32]360 }
$wheelData = [BitConverter]::ToUInt32([BitConverter]::GetBytes($wheel), 0)
[KnouxInstalledNativeInput]::mouse_event(0x0800, 0, 0, $wheelData, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120

[pscustomobject]@{
  processId = $ProcessId
  action = $Action
  x = $X
  y = $Y
  requestedDeltaY = $DeltaY
  nativeWheelDelta = $wheel
} | ConvertTo-Json -Compress
