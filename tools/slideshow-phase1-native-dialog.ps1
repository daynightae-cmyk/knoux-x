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
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint source, uint target, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr deviceContext, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
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

function Get-AutomationControls([IntPtr]$Dialog, [int]$TimeoutSeconds = 10) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastError = $null
  do {
    try {
      if (-not [KnouxNativeDialog]::IsWindow($Dialog)) {
        throw [Runtime.InteropServices.COMException]::new('The native dialog handle is no longer valid.')
      }
      # Recreate the UIA root on every attempt. Cached AutomationElement instances become
      # disconnected while Explorer refreshes a Save/Open dialog and can transiently throw
      # RPC_E_CALL_REJECTED or UIA_E_ELEMENTNOTAVAILABLE from FindAll.
      $root = [Windows.Automation.AutomationElement]::FromHandle($Dialog)
      if (-not $root) { throw [Runtime.InteropServices.COMException]::new('UI Automation did not expose the dialog root.') }
      $items = @()
      # Explorer's common dialogs expose several controls only through the process UIA
      # tree. Reacquire that tree after validating the intended #32770 root, matching the
      # independently proven Save helper while retaining bounded COM/root retries.
      $processCondition = [Windows.Automation.PropertyCondition]::new(
        [Windows.Automation.AutomationElement]::ProcessIdProperty,
        $ProcessId
      )
      $processCollection = [Windows.Automation.AutomationElement]::RootElement.FindAll(
        [Windows.Automation.TreeScope]::Descendants,
        $processCondition
      )
      for ($index = 0; $index -lt $processCollection.Count; $index += 1) {
        $items += $processCollection.Item($index)
      }
      return $items
    } catch {
      $lastError = $_.Exception
      Start-Sleep -Milliseconds 125
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "UI Automation controls did not stabilize within $TimeoutSeconds seconds: $($lastError.Message)"
}

function Get-DialogState(
  [IntPtr]$Dialog = [IntPtr]::Zero,
  [IntPtr]$Exclude = [IntPtr]::Zero,
  [int]$TimeoutSeconds = 8
) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastError = $null
  do {
    try {
      if ($Dialog -eq [IntPtr]::Zero -or -not [KnouxNativeDialog]::IsWindow($Dialog)) {
        $Dialog = Find-Dialog -Exclude $Exclude -TimeoutSeconds 1
      }
      Activate-Dialog $Dialog
      $controls = @(Get-Controls $Dialog)
      $automationControls = @(Get-AutomationControls $Dialog -TimeoutSeconds 5)
      if ($controls.Count -eq 0 -or $automationControls.Count -eq 0) {
        throw [Runtime.InteropServices.COMException]::new('The native dialog control tree is empty.')
      }
      return [pscustomobject]@{
        Dialog = $Dialog
        Controls = $controls
        AutomationControls = $automationControls
      }
    } catch {
      $lastError = $_.Exception
      # Discard every cached handle/control/root and reacquire the intended visible dialog.
      $Dialog = [IntPtr]::Zero
      Start-Sleep -Milliseconds 150
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Native dialog/root/control reacquisition failed within $TimeoutSeconds seconds: $($lastError.Message)"
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
  $root = $Handle
  while ([KnouxNativeDialog]::GetParent($root) -ne [IntPtr]::Zero) { $root = [KnouxNativeDialog]::GetParent($root) }
  $ownerPid = [uint32]0
  $targetThread = [KnouxNativeDialog]::GetWindowThreadProcessId($root, [ref]$ownerPid)
  $currentThread = [KnouxNativeDialog]::GetCurrentThreadId()
  $attached = [KnouxNativeDialog]::AttachThreadInput($currentThread, $targetThread, $true)
  try {
    [KnouxNativeDialog]::SetForegroundWindow($root) | Out-Null
    [KnouxNativeDialog]::SetFocus($Handle) | Out-Null
    $x = [Math]::Round(($bounds.Left + $bounds.Right) / 2)
    $y = [Math]::Round(($bounds.Top + $bounds.Bottom) / 2)
    [System.Windows.Forms.Cursor]::Position = [Drawing.Point]::new($x, $y)
    [KnouxNativeDialog]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [KnouxNativeDialog]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  } finally {
    if ($attached) { [KnouxNativeDialog]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null }
  }
  Start-Sleep -Milliseconds 180
}

function Wait-DialogClosed([IntPtr]$Dialog, [string]$Label, [int]$TimeoutSeconds = 5) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([KnouxNativeDialog]::IsWindow($Dialog) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 100
  }
  if ([KnouxNativeDialog]::IsWindow($Dialog)) {
    throw "$Label remained open after visible confirmation."
  }
}

function Confirm-DialogDismissed([IntPtr]$Dialog, [object[]]$AutomationControls) {
  $deadline = [DateTime]::UtcNow.AddSeconds(2)
  while ([KnouxNativeDialog]::IsWindow($Dialog) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 100
  }
  if ([KnouxNativeDialog]::IsWindow($Dialog)) {
    Invoke-AutomationButton $AutomationControls '1' 'Save' | Out-Null
  }
  Wait-DialogClosed $Dialog 'Native Save dialog' 3
}

function Click-DialogAddress([IntPtr]$Handle) {
  $bounds = [KnouxNativeDialog+Rect]::new()
  if (-not [KnouxNativeDialog]::GetWindowRect($Handle, [ref]$bounds)) {
    throw 'Unable to resolve native dialog bounds for address navigation.'
  }
  $x = $bounds.Left + [Math]::Round(($bounds.Right - $bounds.Left) * 0.52)
  $y = $bounds.Top + 48
  [System.Windows.Forms.Cursor]::Position = [Drawing.Point]::new($x, $y)
  [KnouxNativeDialog]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [KnouxNativeDialog]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
}

function Send-DialogKey([IntPtr]$Handle, [int]$VirtualKey) {
  if (-not [KnouxNativeDialog]::PostMessage($Handle, 0x0100, [IntPtr]$VirtualKey, [IntPtr]::Zero)) {
    throw "Unable to post key-down $VirtualKey to the native dialog."
  }
  if (-not [KnouxNativeDialog]::PostMessage($Handle, 0x0101, [IntPtr]$VirtualKey, [IntPtr]::Zero)) {
    throw "Unable to post key-up $VirtualKey to the native dialog."
  }
}

function Send-VisibleDialogKey([IntPtr]$Handle, [int]$VirtualKey) {
  Activate-Dialog $Handle
  [KnouxNativeDialog]::keybd_event([byte]$VirtualKey, 0, 0, [UIntPtr]::Zero)
  [KnouxNativeDialog]::keybd_event([byte]$VirtualKey, 0, 0x0002, [UIntPtr]::Zero)
}

function Get-AutomationValueControl([object[]]$Elements, [string]$AutomationId) {
  foreach ($candidate in $Elements) {
    if ($candidate.Current.AutomationId -ne $AutomationId) { continue }
    $pattern = $null
    if ($candidate.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      return [pscustomobject]@{ Element = $candidate; Pattern = $pattern }
    }
  }
  return $null
}

function Navigate-DialogAddress([IntPtr]$Handle, [string]$Directory) {
  $canonicalDirectory = [IO.Path]::GetFullPath($Directory).TrimEnd([IO.Path]::DirectorySeparatorChar)
  Activate-Dialog $Handle

  # Windows common dialogs keep the address editor inside an Address Band root whose
  # UIA/native IDs vary by host. Ctrl+L is the stable visible command for that editor.
  [System.Windows.Forms.SendKeys]::SendWait('^l')
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.Clipboard]::SetText($canonicalDirectory)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 900

  $state = Get-DialogState -Dialog $Handle -TimeoutSeconds 5
  $filenameEditor = @($state.Controls) | Where-Object {
    $_.Class -eq 'Edit' -and $_.Id -eq 1001
  } | Select-Object -First 1
  if (-not $filenameEditor) { throw 'Native Save filename control was not restored after address navigation.' }

  Start-Sleep -Milliseconds 180
}

function Paste-Control([IntPtr]$Handle, [string]$Value) {
  $bounds = [KnouxNativeDialog+Rect]::new()
  if (-not [KnouxNativeDialog]::GetWindowRect($Handle, [ref]$bounds)) { throw 'Unable to resolve native edit bounds.' }
  $root = $Handle
  while ([KnouxNativeDialog]::GetParent($root) -ne [IntPtr]::Zero) { $root = [KnouxNativeDialog]::GetParent($root) }
  $ownerPid = [uint32]0
  $targetThread = [KnouxNativeDialog]::GetWindowThreadProcessId($root, [ref]$ownerPid)
  $currentThread = [KnouxNativeDialog]::GetCurrentThreadId()
  $attached = [KnouxNativeDialog]::AttachThreadInput($currentThread, $targetThread, $true)
  try {
    [KnouxNativeDialog]::SetForegroundWindow($root) | Out-Null
    [KnouxNativeDialog]::SetFocus($Handle) | Out-Null
    [System.Windows.Forms.Cursor]::Position = [Drawing.Point]::new([Math]::Round(($bounds.Left + $bounds.Right) / 2), [Math]::Round(($bounds.Top + $bounds.Bottom) / 2))
    [KnouxNativeDialog]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [KnouxNativeDialog]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    [System.Windows.Forms.Clipboard]::SetText($Value)
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    Start-Sleep -Milliseconds 80
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 120
  } finally {
    if ($attached) { [KnouxNativeDialog]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null }
  }
}

function Type-Control([IntPtr]$Handle, [string]$Value) {
  [KnouxNativeDialog]::SendMessage($Handle, 0x00B1, [IntPtr]::Zero, [IntPtr](-1)) | Out-Null
  foreach ($character in $Value.ToCharArray()) {
    [KnouxNativeDialog]::SendMessage($Handle, 0x0102, [IntPtr][int][char]$character, [IntPtr]::Zero) | Out-Null
  }
  Start-Sleep -Milliseconds 120
}

Add-Type -AssemblyName System.Windows.Forms
$payload = if ($PayloadBase64) {
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64)) | ConvertFrom-Json
} else { @() }

$dialogState = Get-DialogState -TimeoutSeconds 20
$dialog = $dialogState.Dialog
$title = Get-WindowTextValue $dialog
$controls = @($dialogState.Controls)
$automationControls = @($dialogState.AutomationControls)
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
  [KnouxNativeDialog]::SendMessage($folderEditor.Handle, 0x000C, [IntPtr]::Zero, $folderPath) | Out-Null
  Capture-Window $dialog $ScreenshotPath
  $button = $controls | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq 1 } | Select-Object -First 1
  if (-not $button) { throw 'Native Select Folder button was not found.' }
  Invoke-AutomationButton $automationControls '1' 'Select Folder' | Out-Null
} else {
  $saveDirectory = $null
  $saveFilename = $null
  if ($Mode -eq 'Save') {
    $saveTarget = [IO.Path]::GetFullPath([string]$payload[0])
    $saveDirectory = [IO.Path]::GetDirectoryName($saveTarget)
    $saveFilename = [IO.Path]::GetFileName($saveTarget)
    if (-not [IO.Directory]::Exists($saveDirectory)) {
      throw "Requested Save directory does not exist: $saveDirectory"
    }
    Navigate-DialogAddress $dialog $saveDirectory
    Start-Sleep -Milliseconds 1200
    $dialogState = Get-DialogState -TimeoutSeconds 8
    $dialog = $dialogState.Dialog
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
      $dialogState = Get-DialogState -Dialog $dialog -TimeoutSeconds 2
      $dialog = $dialogState.Dialog
      $controls = @($dialogState.Controls)
      $automationControls = @($dialogState.AutomationControls)
      $saveEditorReady = $controls | Where-Object { $_.Class -eq 'Edit' -and $_.Id -eq 1001 } | Select-Object -First 1
      if ($saveEditorReady) { break }
      Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    $record.navigatedDirectory = $saveDirectory
    $record.enteredFilename = $saveFilename
  }
  $controlId = if ($Mode -eq 'Save') { 1001 } else { 1148 }
  $editor = $controls | Where-Object { $_.Class -eq 'Edit' -and $_.Id -eq $controlId } | Select-Object -First 1
  if (-not $editor) { throw "Native $Mode filename control $controlId was not found." }
  $text = if ($Mode -eq 'Open' -and $payload.Count -gt 1) {
    ($payload | ForEach-Object { '"' + [string]$_ + '"' }) -join ' '
  } elseif ($Mode -eq 'Save') { $saveFilename } else { [string]$payload[0] }
  if ($Mode -eq 'Save') {
    Type-Control $editor.Handle $text
  } elseif ($Mode -eq 'Open') {
    [KnouxNativeDialog]::SendMessage($editor.Handle, 0x000C, [IntPtr]::Zero, $text) | Out-Null
  }
  Capture-Window $dialog $ScreenshotPath
  $button = $controls | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq 1 } | Select-Object -First 1
  if (-not $button) { throw "Native $Mode confirmation button was not found." }
  if ($Mode -eq 'Open') {
    [KnouxNativeDialog]::SendMessage($button.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  } else {
    if ($ConfirmOverwrite) {
      Invoke-AutomationButton $automationControls '1' 'Save' -Asynchronous | Out-Null
    } else {
      Click-Control $button.Handle
      Confirm-DialogDismissed $dialog $automationControls
    }
  }
}

if ($ConfirmOverwrite) {
  $overwriteState = Get-DialogState -Exclude $dialog -TimeoutSeconds 20
  $overwriteDialog = $overwriteState.Dialog
  $overwriteControls = @($overwriteState.Controls)
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
  Wait-DialogClosed $overwriteDialog 'Native overwrite dialog'
  Wait-DialogClosed $dialog 'Native Save dialog'
} elseif ($Mode -ne 'Save') {
  Wait-DialogClosed $dialog "Native $Mode dialog"
}

Start-Sleep -Milliseconds 350
$record | ConvertTo-Json -Depth 8 -Compress
