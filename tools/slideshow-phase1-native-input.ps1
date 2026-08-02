param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('Wheel', 'Click', 'Drag', 'Select', 'Range', 'Fill')][string]$Action,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [Parameter(Mandatory = $true)][int]$ViewportWidth,
  [Parameter(Mandatory = $true)][int]$ViewportHeight,
  [int]$TargetX = 0,
  [int]$TargetY = 0,
  [int]$Steps = 0,
  [string]$TextBase64 = '',
  [int]$DeltaY = 0
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
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect bounds);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect bounds);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, Input[] inputs, int size);
  public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  public struct Point { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Input {
    public uint type;
    public InputUnion value;
  }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MouseInput mouse;
    [FieldOffset(0)] public KeyInput keyboard;
    [FieldOffset(0)] public HardwareInput hardware;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput {
    public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KeyInput {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct HardwareInput {
    public uint message; public ushort parameterLow; public ushort parameterHigh;
  }
  public static void SendChord(ushort modifier, ushort virtualKey) {
    Input[] inputs = new Input[] {
      new Input { type = 1, value = new InputUnion { keyboard = new KeyInput { virtualKey = modifier } } },
      new Input { type = 1, value = new InputUnion { keyboard = new KeyInput { virtualKey = virtualKey } } },
      new Input { type = 1, value = new InputUnion { keyboard = new KeyInput { virtualKey = virtualKey, flags = 2 } } },
      new Input { type = 1, value = new InputUnion { keyboard = new KeyInput { virtualKey = modifier, flags = 2 } } }
    };
    if (SendInput(4, inputs, Marshal.SizeOf(typeof(Input))) != 4)
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void SendUnicodeText(string text) {
    foreach (char character in text) {
      Input[] inputs = new Input[] {
        new Input { type = 1, value = new InputUnion { keyboard = new KeyInput { scanCode = character, flags = 4 } } },
        new Input { type = 1, value = new InputUnion { keyboard = new KeyInput { scanCode = character, flags = 6 } } }
      };
      if (SendInput(2, inputs, Marshal.SizeOf(typeof(Input))) != 2)
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
  }
}
'@

[KnouxInstalledNativeInput]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

function Send-VirtualKey([byte]$VirtualKey) {
  [KnouxInstalledNativeInput]::keybd_event($VirtualKey, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [KnouxInstalledNativeInput]::keybd_event($VirtualKey, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
}

function Click-CurrentPointer {
  [KnouxInstalledNativeInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [KnouxInstalledNativeInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

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
      $clientBounds = [KnouxInstalledNativeInput+Rect]::new()
      [KnouxInstalledNativeInput]::GetClientRect($candidate, [ref]$clientBounds) | Out-Null
      $clientWidth = $clientBounds.Right - $clientBounds.Left
      $clientHeight = $clientBounds.Bottom - $clientBounds.Top
      $error = [Math]::Abs($clientWidth - $ViewportWidth) + [Math]::Abs($clientHeight - $ViewportHeight)
      $script:candidates += [pscustomobject]@{
        Handle = $candidate; Bounds = $candidateBounds; Area = $width * $height
        ClientWidth = $clientWidth; ClientHeight = $clientHeight; ViewportError = $error
      }
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$window = $script:candidates | Sort-Object ViewportError, @{ Expression = 'Area'; Descending = $true } | Select-Object -First 1
if (-not $window) { throw "Installed process tree $ProcessId has no visible application window." }
$handle = $window.Handle
$bounds = $window.Bounds
$targetPid = [uint32]0
$targetThread = [KnouxInstalledNativeInput]::GetWindowThreadProcessId($handle, [ref]$targetPid)
$foreground = [KnouxInstalledNativeInput]::GetForegroundWindow()
$foregroundPid = [uint32]0
$foregroundThread = if ($foreground -ne [IntPtr]::Zero) {
  [KnouxInstalledNativeInput]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
} else { 0 }
$currentThread = [KnouxInstalledNativeInput]::GetCurrentThreadId()
$attachedForeground = $foregroundThread -and [KnouxInstalledNativeInput]::AttachThreadInput($currentThread, $foregroundThread, $true)
$attachedTarget = $targetThread -and $targetThread -ne $foregroundThread -and [KnouxInstalledNativeInput]::AttachThreadInput($currentThread, $targetThread, $true)
$activationClick = $false
try {
  [KnouxInstalledNativeInput]::ShowWindow($handle, 9) | Out-Null
  [KnouxInstalledNativeInput]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 0x0043) | Out-Null
  [KnouxInstalledNativeInput]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0043) | Out-Null
  [KnouxInstalledNativeInput]::BringWindowToTop($handle) | Out-Null
  # A synthetic ALT boundary grants this visible helper the normal foreground
  # activation privilege without clicking or mutating the renderer.
  [KnouxInstalledNativeInput]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [KnouxInstalledNativeInput]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [KnouxInstalledNativeInput]::SetForegroundWindow($handle) | Out-Null
  [KnouxInstalledNativeInput]::SetActiveWindow($handle) | Out-Null
  [KnouxInstalledNativeInput]::SetFocus($handle) | Out-Null
  $foregroundDeadline = [DateTime]::UtcNow.AddSeconds(2)
  do {
    if ([KnouxInstalledNativeInput]::GetForegroundWindow() -eq $handle) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $foregroundDeadline)
  $foregroundAfter = [KnouxInstalledNativeInput]::GetForegroundWindow()
  $foregroundAfterPid = [uint32]0
  [KnouxInstalledNativeInput]::GetWindowThreadProcessId($foregroundAfter, [ref]$foregroundAfterPid) | Out-Null
  if ($foregroundAfter -ne $handle -and $script:processIds -notcontains $foregroundAfterPid) {
    # The controller may not own foreground permission. Activate through a verified
    # blank title-bar point, never through the requested control coordinate.
    [Windows.Forms.Cursor]::Position = [Drawing.Point]::new(
      $bounds.Left + [Math]::Round(($bounds.Right - $bounds.Left) / 2),
      $bounds.Top + 10
    )
    Click-CurrentPointer
    $activationClick = $true
    $activationDeadline = [DateTime]::UtcNow.AddSeconds(2)
    do {
      $foregroundAfter = [KnouxInstalledNativeInput]::GetForegroundWindow()
      $foregroundAfterPid = [uint32]0
      [KnouxInstalledNativeInput]::GetWindowThreadProcessId($foregroundAfter, [ref]$foregroundAfterPid) | Out-Null
      if ($foregroundAfter -eq $handle -or $script:processIds -contains $foregroundAfterPid) { break }
      Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $activationDeadline)
  }
  # Foreground is only verified if the renderer window itself is in foreground.
  # A native dialog from the same process tree does not count for renderer input.
  $foregroundVerified = $foregroundAfter -eq $handle
  Start-Sleep -Milliseconds 120
} finally {
  if ($attachedTarget) { [KnouxInstalledNativeInput]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null }
  if ($attachedForeground) { [KnouxInstalledNativeInput]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null }
}
$clientOrigin = [KnouxInstalledNativeInput+Point]::new()
if (-not [KnouxInstalledNativeInput]::ClientToScreen($handle, [ref]$clientOrigin)) {
  throw 'Unable to resolve installed application client coordinates.'
}
$dpi = [KnouxInstalledNativeInput]::GetDpiForWindow($handle)
if ($dpi -lt 96) { $dpi = 96 }
$scale = $dpi / 96.0
$physicalX = $clientOrigin.X + [Math]::Round($X * $scale)
$physicalY = $clientOrigin.Y + [Math]::Round($Y * $scale)
[Windows.Forms.Cursor]::Position = [Drawing.Point]::new($physicalX, $physicalY)
$wheel = 0
if ($Action -eq 'Wheel') {
  $wheel = if ($DeltaY -gt 0) { [int32]-360 } else { [int32]360 }
  $wheelData = [BitConverter]::ToUInt32([BitConverter]::GetBytes($wheel), 0)
  [KnouxInstalledNativeInput]::mouse_event(0x0800, 0, 0, $wheelData, [UIntPtr]::Zero)
} elseif ($Action -eq 'Click') {
  Click-CurrentPointer
} elseif ($Action -eq 'Drag') {
  [KnouxInstalledNativeInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  for ($step = 1; $step -le 12; $step += 1) {
    $dragX = $physicalX + [Math]::Round((($TargetX - $X) * $scale * $step) / 12)
    $dragY = $physicalY + [Math]::Round((($TargetY - $Y) * $scale * $step) / 12)
    [Windows.Forms.Cursor]::Position = [Drawing.Point]::new($dragX, $dragY)
    Start-Sleep -Milliseconds 30
  }
  [KnouxInstalledNativeInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
} elseif ($Action -eq 'Select') {
  if (-not $foregroundVerified) { throw 'Select refused because the installed process tree is not foreground.' }
  Click-CurrentPointer
  Send-VirtualKey 0x24
  for ($step = 0; $step -lt $Steps; $step += 1) { Send-VirtualKey 0x28 }
  Send-VirtualKey 0x0D
} elseif ($Action -eq 'Range') {
  if (-not $foregroundVerified) { throw 'Range refused because the installed process tree is not foreground.' }
  Click-CurrentPointer
  Send-VirtualKey 0x24
  for ($step = 0; $step -lt $Steps; $step += 1) { Send-VirtualKey 0x27 }
  Send-VirtualKey 0x09
} else {
  if (-not $foregroundVerified) { throw 'Fill refused because the installed process tree is not foreground.' }
  if (-not $TextBase64) { throw 'Fill requires TextBase64.' }
  $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
  Click-CurrentPointer
  # Chromium may acknowledge the physical click before it commits focus to the
  # input element. Let that visible focus transition settle before Ctrl+A so a
  # retry cannot type into the previously focused control.
  Start-Sleep -Milliseconds 180
  [KnouxInstalledNativeInput]::SendChord(0x11, 0x41)
  [KnouxInstalledNativeInput]::SendUnicodeText($text)
  Send-VirtualKey 0x09
}
Start-Sleep -Milliseconds 120

[pscustomobject]@{
  processId = $ProcessId
  action = $Action
  windowHandle = [int64]$handle
  windowBounds = @{ left = $bounds.Left; top = $bounds.Top; right = $bounds.Right; bottom = $bounds.Bottom }
  clientOrigin = @{ x = $clientOrigin.X; y = $clientOrigin.Y }
  dpi = $dpi
  scale = $scale
  viewportWidth = $ViewportWidth
  viewportHeight = $ViewportHeight
  viewportError = $window.ViewportError
  activationClick = $activationClick
  foregroundVerified = $foregroundVerified
  x = $X
  y = $Y
  physicalX = $physicalX
  physicalY = $physicalY
  requestedDeltaY = $DeltaY
  steps = $Steps
  nativeWheelDelta = $wheel
} | ConvertTo-Json -Compress
