param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('Open', 'Save', 'Folder', 'Cancel')][string]$Mode,
  [string]$PayloadBase64 = '',
  [switch]$ConfirmOverwrite,
  [string]$ScreenshotPath = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class KnouxNativeDialog {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr state);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int maximum);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maximum);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect bounds);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr deviceContext, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

function Get-WindowClass([IntPtr]$Handle) {
  $value = [Text.StringBuilder]::new(256)
  [KnouxNativeDialog]::GetClassName($Handle, $value, $value.Capacity) | Out-Null
  return $value.ToString()
}

function Get-WindowTextValue([IntPtr]$Handle) {
  $value = [Text.StringBuilder]::new(2048)
  [KnouxNativeDialog]::GetWindowText($Handle, $value, $value.Capacity) | Out-Null
  return $value.ToString()
}

function Find-Dialog([IntPtr]$Exclude = [IntPtr]::Zero, [int]$TimeoutSeconds = 20) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $script:foundDialog = [IntPtr]::Zero
    [KnouxNativeDialog]::EnumWindows({
      param([IntPtr]$handle, [IntPtr]$state)
      $ownerPid = [uint32]0
      [KnouxNativeDialog]::GetWindowThreadProcessId($handle, [ref]$ownerPid) | Out-Null
      if ($ownerPid -eq $ProcessId -and $handle -ne $Exclude -and (Get-WindowClass $handle) -eq '#32770') {
        $script:foundDialog = $handle
        return $false
      }
      return $true
    }, [IntPtr]::Zero) | Out-Null
    if ($script:foundDialog -ne [IntPtr]::Zero) { return $script:foundDialog }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "No native dialog appeared for process $ProcessId within $TimeoutSeconds seconds."
}

function Get-Controls([IntPtr]$Dialog) {
  $script:dialogControls = @()
  [KnouxNativeDialog]::EnumChildWindows($Dialog, {
    param([IntPtr]$handle, [IntPtr]$state)
    $parent = [KnouxNativeDialog]::GetParent($handle)
    $script:dialogControls += [pscustomobject]@{
      Handle = $handle
      Class = Get-WindowClass $handle
      Id = [KnouxNativeDialog]::GetDlgCtrlID($handle)
      Text = Get-WindowTextValue $handle
      ParentClass = Get-WindowClass $parent
      ParentId = [KnouxNativeDialog]::GetDlgCtrlID($parent)
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  return $script:dialogControls
}

function Capture-Window([IntPtr]$Handle, [string]$OutputPath) {
  if (-not $OutputPath) { return }
  $directory = Split-Path -Parent $OutputPath
  if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $bounds = [KnouxNativeDialog+Rect]::new()
  if (-not [KnouxNativeDialog]::GetWindowRect($Handle, [ref]$bounds)) { throw 'Unable to capture native dialog bounds.' }
  $bitmap = [Drawing.Bitmap]::new($bounds.Right - $bounds.Left, $bounds.Bottom - $bounds.Top)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $deviceContext = $graphics.GetHdc()
    try { [KnouxNativeDialog]::PrintWindow($Handle, $deviceContext, 2) | Out-Null }
    finally { $graphics.ReleaseHdc($deviceContext) }
    $bitmap.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Get-AutomationControls([IntPtr]$Dialog) {
  $condition = [Windows.Automation.PropertyCondition]::new(
    [Windows.Automation.AutomationElement]::ProcessIdProperty,
    $ProcessId
  )
  $collection = [Windows.Automation.AutomationElement]::RootElement.FindAll(
    [Windows.Automation.TreeScope]::Descendants,
    $condition
  )
  $items = @()
  for ($index = 0; $index -lt $collection.Count; $index += 1) {
    $items += $collection.Item($index)
  }
  return $items
}

function Set-AutomationValue([object[]]$Elements, [string]$AutomationId, [string]$Value, [switch]$Commit) {
  $element = $null
  $pattern = $null
  foreach ($candidate in $Elements) {
    if ($candidate.Current.AutomationId -ne $AutomationId) { continue }
    $candidatePattern = $null
    if ($candidate.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$candidatePattern)) {
      $element = $candidate
      $pattern = $candidatePattern
      break
    }
  }
  if (-not $element -or -not $pattern) { throw "Native edit control $AutomationId was not found through UI Automation." }
  $pattern.SetValue($Value)
  if ($Commit) {
    $element.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('{END} {BACKSPACE}')
    Start-Sleep -Milliseconds 120
  }
}

function Invoke-AutomationButton([object[]]$Elements, [string]$AutomationId, [string]$NamePattern = '', [switch]$Asynchronous) {
  $element = $Elements | Where-Object {
    ($_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -or $_.Current.ClassName -eq 'Button') -and
    (($_.Current.AutomationId -eq $AutomationId) -or ($NamePattern -and $_.Current.Name -match $NamePattern))
  } | Select-Object -First 1
  if (-not $element) { throw "Native button $AutomationId/$NamePattern was not found through UI Automation." }
  if ($Asynchronous) {
    $handle = [IntPtr]$element.Current.NativeWindowHandle
    if ($handle -eq [IntPtr]::Zero) { throw "Native button $AutomationId/$NamePattern has no window handle." }
    [KnouxNativeDialog]::PostMessage($handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    return $element.Current.Name
  }
  try {
    $pattern = $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
  } catch {
    $handle = [IntPtr]$element.Current.NativeWindowHandle
    if ($handle -eq [IntPtr]::Zero) { throw }
    [KnouxNativeDialog]::SendMessage($handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  }
  return $element.Current.Name
}

function Activate-Dialog([IntPtr]$Handle) {
  [KnouxNativeDialog]::ShowWindow($Handle, 9) | Out-Null
  [KnouxNativeDialog]::SetWindowPos($Handle, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
  [KnouxNativeDialog]::BringWindowToTop($Handle) | Out-Null
  [KnouxNativeDialog]::SetForegroundWindow($Handle) | Out-Null
  Start-Sleep -Milliseconds 320
}

function Click-Control([IntPtr]$Handle) {
  $bounds = [KnouxNativeDialog+Rect]::new()
  if (-not [KnouxNativeDialog]::GetWindowRect($Handle, [ref]$bounds)) {
    throw "Unable to resolve native control bounds for $Handle."
  }
  $x = [Math]::Round(($bounds.Left + $bounds.Right) / 2)
  $y = [Math]::Round(($bounds.Top + $bounds.Bottom) / 2)
  [System.Windows.Forms.Cursor]::Position = [Drawing.Point]::new($x, $y)
  [KnouxNativeDialog]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [KnouxNativeDialog]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
}

function Paste-Control([IntPtr]$Handle, [string]$Value) {
  Click-Control $Handle
  [System.Windows.Forms.Clipboard]::SetText($Value)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 80
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 120
}

Add-Type -AssemblyName System.Windows.Forms
$payload = if ($PayloadBase64) {
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64)) | ConvertFrom-Json
} else { @() }

$dialog = Find-Dialog
$null = Activate-Dialog $dialog
$title = Get-WindowTextValue $dialog
$controls = @(Get-Controls $dialog)
$automationControls = @(Get-AutomationControls $dialog)
Capture-Window $dialog $ScreenshotPath

$record = [ordered]@{
  at = [DateTime]::UtcNow.ToString('o')
  processId = $ProcessId
  mode = $Mode
  title = $title
  dialogHandle = $dialog.ToInt64()
  controls = @($controls | Where-Object { $_.Class -in @('Edit', 'Button') } | ForEach-Object {
    [ordered]@{ class = $_.Class; id = $_.Id; text = $_.Text; parentClass = $_.ParentClass; parentId = $_.ParentId }
  })
  screenshotPath = $ScreenshotPath
  requestedPaths = @($payload)
  overwrite = $null
}

if ($Mode -eq 'Cancel') {
  $button = $controls | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq 2 } | Select-Object -First 1
  if (-not $button) { throw 'Native Cancel button was not found.' }
  Invoke-AutomationButton $automationControls '2' 'Cancel' | Out-Null
} elseif ($Mode -eq 'Folder') {
  $folderPath = [string]$payload[0]
  $folderEditor = $controls | Where-Object { $_.Class -eq 'Edit' -and $_.Id -eq 1152 } | Select-Object -First 1
  if (-not $folderEditor) { throw 'Native folder path control was not found.' }
  Set-AutomationValue $automationControls '1152' $folderPath
  Capture-Window $dialog $ScreenshotPath
  $button = $controls | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq 1 } | Select-Object -First 1
  if (-not $button) { throw 'Native Select Folder button was not found.' }
  Invoke-AutomationButton $automationControls '1' 'Select Folder' | Out-Null
} else {
  $controlId = if ($Mode -eq 'Save') { 1001 } else { 1148 }
  $editor = $controls | Where-Object { $_.Class -eq 'Edit' -and $_.Id -eq $controlId } | Select-Object -First 1
  if (-not $editor) { throw "Native $Mode filename control $controlId was not found." }
  $text = if ($Mode -eq 'Open' -and $payload.Count -gt 1) {
    ($payload | ForEach-Object { '"' + [string]$_ + '"' }) -join ' '
  } else { [string]$payload[0] }
  if ($Mode -eq 'Open' -or $Mode -eq 'Save') {
    [KnouxNativeDialog]::SendMessage($editor.Handle, 0x000C, [IntPtr]::Zero, $text) | Out-Null
  }
  Capture-Window $dialog $ScreenshotPath
  $button = $controls | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq 1 } | Select-Object -First 1
  if (-not $button) { throw "Native $Mode confirmation button was not found." }
  if ($Mode -eq 'Open') {
    [KnouxNativeDialog]::SendMessage($button.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  } else {
    Invoke-AutomationButton $automationControls '1' 'Save' -Asynchronous:$ConfirmOverwrite | Out-Null
  }
}

if ($ConfirmOverwrite) {
  $overwriteDialog = Find-Dialog -Exclude $dialog
  $null = Activate-Dialog $overwriteDialog
  $overwriteControls = @(Get-Controls $overwriteDialog)
  $overwriteTitle = Get-WindowTextValue $overwriteDialog
  $yes = $overwriteControls | Where-Object {
    $_.Class -eq 'Button' -and ($_.Text -match 'Yes|Replace|Save')
  } | Select-Object -First 1
  if (-not $yes) { throw "Overwrite confirmation button was not found in '$overwriteTitle'." }
  $record.overwrite = [ordered]@{
    title = $overwriteTitle
    buttons = @($overwriteControls | Where-Object { $_.Class -eq 'Button' } | ForEach-Object { $_.Text })
    chosen = $yes.Text
  }
  [KnouxNativeDialog]::PostMessage($yes.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
}

Start-Sleep -Milliseconds 350
$record | ConvertTo-Json -Depth 8 -Compress
