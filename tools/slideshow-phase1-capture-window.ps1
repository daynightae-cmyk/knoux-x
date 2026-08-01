param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class KnouxInstalledWindowCapture {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect bounds);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr deviceContext, uint flags);
  public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

$allProcesses = @(Get-CimInstance Win32_Process)
$script:processIds = @([uint32]$ProcessId)
do {
  $added = $false
  foreach ($process in $allProcesses) {
    if (
      $script:processIds -contains [uint32]$process.ParentProcessId -and
      $script:processIds -notcontains [uint32]$process.ProcessId
    ) {
      $script:processIds += [uint32]$process.ProcessId
      $added = $true
    }
  }
} while ($added)

$script:candidates = @()
[KnouxInstalledWindowCapture]::EnumWindows({
  param([IntPtr]$handle, [IntPtr]$state)
  $ownerPid = [uint32]0
  [KnouxInstalledWindowCapture]::GetWindowThreadProcessId($handle, [ref]$ownerPid) | Out-Null
  if ($script:processIds -contains $ownerPid -and [KnouxInstalledWindowCapture]::IsWindowVisible($handle)) {
    $bounds = [KnouxInstalledWindowCapture+Rect]::new()
    if ([KnouxInstalledWindowCapture]::GetWindowRect($handle, [ref]$bounds)) {
      $width = $bounds.Right - $bounds.Left
      $height = $bounds.Bottom - $bounds.Top
      if ($width -ge 640 -and $height -ge 480) {
        $script:candidates += [pscustomobject]@{
          Handle = $handle
          Bounds = $bounds
          Area = $width * $height
        }
      }
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

$window = $script:candidates | Sort-Object Area -Descending | Select-Object -First 1
if (-not $window) { throw "No visible installed application window was found for process $ProcessId." }
$width = $window.Bounds.Right - $window.Bounds.Left
$height = $window.Bounds.Bottom - $window.Bounds.Top
$bitmap = [Drawing.Bitmap]::new($width, $height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
  $deviceContext = $graphics.GetHdc()
  try {
    if (-not [KnouxInstalledWindowCapture]::PrintWindow($window.Handle, $deviceContext, 2)) {
      throw 'PrintWindow failed for the visible installed application window.'
    }
  } finally {
    $graphics.ReleaseHdc($deviceContext)
  }
  $directory = Split-Path -Parent $OutputPath
  if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $bitmap.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}

[pscustomobject]@{
  processId = $ProcessId
  windowHandle = $window.Handle.ToInt64()
  width = $width
  height = $height
  outputPath = $OutputPath
} | ConvertTo-Json -Compress
