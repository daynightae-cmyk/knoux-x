param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('Open', 'Save', 'Folder', 'Cancel')][string]$Mode,
  [string]$PayloadBase64 = '',
  [string]$ScreenshotPath = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
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
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr deviceContext, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, string lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, StringBuilder lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
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
      if ($ownerPid -eq $ProcessId -and $handle -ne $Exclude -and (Get-WindowClass $handle) -eq '#32770' -and [KnouxNativeDialog]::IsWindowVisible($handle)) {
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
      Visible = [KnouxNativeDialog]::IsWindowVisible($handle)
      ParentClass = Get-WindowClass $parent
      ParentId = [KnouxNativeDialog]::GetDlgCtrlID($parent)
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  return $script:dialogControls
}

# The file-name box is the only edit the dialog reads back when it commits.
# Its control id differs between the Open and Save common dialogs, and the
# address band keeps a hidden edit of its own, so the lookup is explicit and
# never falls back to that hidden control.
function Find-FileNameEditor([object[]]$Controls, [int[]]$PreferredIds) {
  $edits = @($Controls) | Where-Object { $_.Class -eq 'Edit' }
  foreach ($id in $PreferredIds) {
    $visible = $edits | Where-Object { $_.Id -eq $id -and $_.Visible } | Select-Object -First 1
    if ($visible) { return $visible }
    $fallback = $edits | Where-Object { $_.Id -eq $id } | Select-Object -First 1
    if ($fallback) { return $fallback }
  }
  return $null
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

# The modern common file dialog is driven entirely through its Win32 window tree.
# UI Automation is deliberately not part of this path: the dialog exposes its
# filename edit and buttons only as plain child windows, and a process-wide UIA
# search can block for a long time on a busy desktop.
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
      $fileName = $controls | Where-Object { $_.Class -eq 'Edit' } | Select-Object -First 1
      if (-not $fileName) {
        throw [Runtime.InteropServices.COMException]::new('The native dialog has no filename control yet.')
      }
      return [pscustomobject]@{
        Dialog = $Dialog
        Controls = $controls
      }
    } catch {
      $lastError = $_.Exception
      # Discard every cached handle/control and reacquire the intended visible dialog.
      $Dialog = [IntPtr]::Zero
      Start-Sleep -Milliseconds 150
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Native dialog/control reacquisition failed within $TimeoutSeconds seconds: $($lastError.Message)"
}

# The modern common file dialog exposes its own buttons only as plain Win32
# child controls, so the confirmation buttons are driven through those handles.
# The message is posted rather than sent: a synchronous BM_CLICK blocks the
# helper inside the dialog's own message loop whenever the dialog raises a
# secondary prompt, which is exactly how a Save/Open can hang instead of fail.
function Click-DialogButton([IntPtr]$Handle) {
  [KnouxNativeDialog]::PostMessage($Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
}

# WM_GETTEXTLENGTH is the only way to read an edit control that belongs to
# another process: GetWindowText returns an empty string for it.
function Get-ControlTextLength([IntPtr]$Handle) {
  return [int][KnouxNativeDialog]::SendMessage($Handle, 0x000E, [IntPtr]::Zero, [IntPtr]::Zero)
}

# WM_GETTEXT (unlike GetWindowText) is marshalled across processes for the
# standard edit controls the common dialog uses, so the exact value the dialog
# will commit can be verified instead of guessed from its length.
function Get-ControlText([IntPtr]$Handle) {
  $length = Get-ControlTextLength $Handle
  if ($length -le 0) { return '' }
  $buffer = [Text.StringBuilder]::new($length + 2)
  [KnouxNativeDialog]::SendMessage($Handle, 0x000D, [IntPtr]($length + 1), $buffer) | Out-Null
  return $buffer.ToString()
}

# The file dialog keeps its own file-name state, so the value has to arrive as
# real key input. A programmatic WM_SETTEXT is visible in the box but the Save
# dialog still resolves its default name.
function Type-Control([IntPtr]$Handle, [string]$Value) {
  [KnouxNativeDialog]::SendMessage($Handle, 0x00B1, [IntPtr]::Zero, [IntPtr](-1)) | Out-Null
  foreach ($character in $Value.ToCharArray()) {
    [KnouxNativeDialog]::SendMessage($Handle, 0x0102, [IntPtr][int][char]$character, [IntPtr]::Zero) | Out-Null
  }
  Start-Sleep -Milliseconds 120
}

function Activate-Dialog([IntPtr]$Handle) {
  [KnouxNativeDialog]::ShowWindow($Handle, 9) | Out-Null
  [KnouxNativeDialog]::SetWindowPos($Handle, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
  [KnouxNativeDialog]::BringWindowToTop($Handle) | Out-Null
  [KnouxNativeDialog]::SetForegroundWindow($Handle) | Out-Null
  Start-Sleep -Milliseconds 320
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

# A save over an existing file raises a second common dialog that must be
# confirmed the way a user confirms it. The confirmation is driven by a posted
# message so the helper stays responsive while that prompt owns the dialog.
function Resolve-SaveConfirmation([IntPtr]$Dialog, [IntPtr]$Button, [int]$TimeoutSeconds = 25) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not [KnouxNativeDialog]::IsWindow($Dialog)) { return $null }
    $prompt = [IntPtr]::Zero
    try { $prompt = Find-Dialog -Exclude $Dialog -TimeoutSeconds 1 } catch { $prompt = [IntPtr]::Zero }
    if ($prompt -ne [IntPtr]::Zero) {
      $promptControls = @(Get-Controls $prompt)
      $confirm = $promptControls | Where-Object {
        $_.Class -eq 'Button' -and ($_.Text -match 'Yes|Replace|Save')
      } | Select-Object -First 1
      # A file dialog being rebuilt or initialized is not an overwrite prompt;
      # only a window that exposes a confirmation button is acted on.
      if ($confirm) {
        Click-DialogButton $confirm.Handle
        Wait-DialogClosed $prompt 'Native overwrite dialog' 10
        continue
      }
    }
    Start-Sleep -Milliseconds 150
  }
  throw 'Native Save dialog remained open after visible confirmation.'
}

$parsedPayload = if ($PayloadBase64) {
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64)) | ConvertFrom-Json
} else { @() }
$payload = @($parsedPayload)

$dialogState = Get-DialogState -TimeoutSeconds 20
$dialog = $dialogState.Dialog
$title = Get-WindowTextValue $dialog
$controls = @($dialogState.Controls)
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
  Click-DialogButton $button.Handle
  Wait-DialogClosed $dialog 'Native Cancel dialog' 10
} elseif ($Mode -eq 'Folder') {
  $folderPath = [string]$payload[0]
  $folderEditor = $controls | Where-Object { $_.Class -eq 'Edit' -and $_.Id -eq 1152 } | Select-Object -First 1
  if (-not $folderEditor) { throw 'Native folder path control was not found.' }
  [KnouxNativeDialog]::SendMessage($folderEditor.Handle, 0x000C, [IntPtr]::Zero, $folderPath) | Out-Null
  Capture-Window $dialog $ScreenshotPath
  $button = $controls | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq 1 } | Select-Object -First 1
  if (-not $button) { throw 'Native Select Folder button was not found.' }
  Click-DialogButton $button.Handle
  Wait-DialogClosed $dialog 'Native folder dialog' 10
} else {
  if ($Mode -eq 'Save') {
    # A Windows file dialog accepts an absolute path in the file-name box and
    # resolves the destination folder itself. Driving the address band was not
    # reliable: its edit control stays hidden until the band enters edit mode,
    # so the typed folder was discarded and the dialog kept its previous
    # location, leaving the renderer waiting for a path that never arrived.
    $saveTarget = [IO.Path]::GetFullPath([string]$payload[0])
    $saveDirectory = [IO.Path]::GetDirectoryName($saveTarget)
    if (-not [IO.Directory]::Exists($saveDirectory)) {
      throw "Requested Save directory does not exist: $saveDirectory"
    }
    $record.requestedDirectory = $saveDirectory
    $record.requestedFilename = [IO.Path]::GetFileName($saveTarget)
    $text = $saveTarget
    $preferredIds = @(1001, 1148, 1152)
  } else {
    $text = if ($payload.Count -gt 1) {
      ($payload | ForEach-Object { '"' + [string]$_ + '"' }) -join ' '
    } else { [string]$payload[0] }
    $preferredIds = @(1148, 1001, 1152)
  }
  $editor = Find-FileNameEditor $controls $preferredIds
  if (-not $editor) { throw "Native $Mode filename control was not found." }
  if ($Mode -eq 'Save') {
    # The common dialog applies its default file name asynchronously, so it can
    # land after the first keystrokes and prefix them ('portrait.knouximageC:\...').
    # Type until the box holds exactly the requested destination; the value is
    # read back through WM_GETTEXT, which is marshalled across processes.
    $observed = ''
    for ($attempt = 1; $attempt -le 4; $attempt++) {
      Type-Control $editor.Handle $text
      Start-Sleep -Milliseconds 350
      $observed = Get-ControlText $editor.Handle
      if ($observed -eq $text) { break }
    }
    if ($observed -ne $text) {
      throw "Native Save filename control did not hold the requested path after $attempt attempts: observed '$observed'."
    }
    $record.enteredPath = $text
  } else {
    [KnouxNativeDialog]::SendMessage($editor.Handle, 0x000C, [IntPtr]::Zero, $text) | Out-Null
  }
  Capture-Window $dialog $ScreenshotPath
  $button = $controls | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq 1 } | Select-Object -First 1
  if (-not $button) { throw "Native $Mode confirmation button was not found." }
  if ($Mode -eq 'Open') {
    Click-DialogButton $button.Handle
    Wait-DialogClosed $dialog 'Native Open dialog' 10
  } else {
    # The confirmation is posted, not sent: a save that raises an overwrite
    # prompt would otherwise block this helper inside the dialog's own loop.
    Click-DialogButton $button.Handle
    $record.overwrite = Resolve-SaveConfirmation $dialog $button.Handle
  }
}

Start-Sleep -Milliseconds 350
$record | ConvertTo-Json -Depth 8 -Compress
