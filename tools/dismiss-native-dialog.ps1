param(
  [string]$TitlePattern = 'Import video',
  [int]$TimeoutSeconds = 60,
  [string]$ProcessName = 'knoux-player-x',
  [string]$SelectPath = ''
)

# ASCII-only on purpose: Windows PowerShell 5.1 parses this file with the ANSI
# code page; non-ASCII bytes can break parsing on non-UTF8 systems.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class KnouxDlgWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hDlg, int nIDDlgItem);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
"@

$WM_CLOSE = 0x0010
$BM_CLICK = 0x00F5

function Get-WindowTitle([IntPtr]$Handle) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][KnouxDlgWin]::GetWindowText($Handle, $sb, 512)
  return $sb.ToString()
}

function Get-WindowClass([IntPtr]$Handle) {
  $sb = New-Object System.Text.StringBuilder 256
  [void][KnouxDlgWin]::GetClassName($Handle, $sb, 256)
  return $sb.ToString()
}

function Get-OwnerProcessName([IntPtr]$Handle) {
  $processId = [uint32]0
  [void][KnouxDlgWin]::GetWindowThreadProcessId($Handle, [ref]$processId)
  if ($processId -eq 0) { return '' }
  try { return (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { return '' }
}

function Find-TargetDialog {
  $script:knouxFoundHandle = [IntPtr]::Zero
  $script:knouxFoundTitle = ''
  $callback = [KnouxDlgWin+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [KnouxDlgWin]::IsWindowVisible($hWnd)) { return $true }
    if ((Get-WindowClass $hWnd) -ne '#32770') { return $true }
    $title = Get-WindowTitle $hWnd
    if ($title -notlike "*$TitlePattern*") { return $true }
    if ((Get-OwnerProcessName $hWnd) -ne $ProcessName) { return $true }
    $script:knouxFoundHandle = $hWnd
    $script:knouxFoundTitle = $title
    return $false
  }
  [void][KnouxDlgWin]::EnumWindows($callback, [IntPtr]::Zero)
  if ($script:knouxFoundHandle -eq [IntPtr]::Zero) { return $null }
  return [pscustomobject]@{ Handle = $script:knouxFoundHandle; Title = $script:knouxFoundTitle }
}

function Find-AnyProcessDialog {
  $script:knouxAnyHandle = [IntPtr]::Zero
  $callback = [KnouxDlgWin+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [KnouxDlgWin]::IsWindowVisible($hWnd)) { return $true }
    if ((Get-WindowClass $hWnd) -ne '#32770') { return $true }
    if ((Get-OwnerProcessName $hWnd) -ne $ProcessName) { return $true }
    $script:knouxAnyHandle = $hWnd
    return $false
  }
  [void][KnouxDlgWin]::EnumWindows($callback, [IntPtr]::Zero)
  if ($script:knouxAnyHandle -eq [IntPtr]::Zero) { return $null }
  return [pscustomobject]@{ Handle = $script:knouxAnyHandle; Title = (Get-WindowTitle $script:knouxAnyHandle) }
}

# Accepts an overwrite/confirmation message box owned by the packaged app.
function Confirm-MessageBox {
  $box = Find-AnyProcessDialog
  if (-not $box) { return $false }
  $yes = [KnouxDlgWin]::GetDlgItem($box.Handle, 6)
  if ($yes -ne [IntPtr]::Zero) {
    [void][KnouxDlgWin]::PostMessage($yes, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Output "CONFIRM_MESSAGEBOX title=`"$($box.Title)`" method=YES"
    return $true
  }
  $ok = [KnouxDlgWin]::GetDlgItem($box.Handle, 1)
  if ($ok -ne [IntPtr]::Zero) {
    [void][KnouxDlgWin]::PostMessage($ok, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Output "CONFIRM_MESSAGEBOX title=`"$($box.Title)`" method=OK"
    return $true
  }
  [void][KnouxDlgWin]::SetForegroundWindow($box.Handle)
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('y')
  Write-Output "CONFIRM_MESSAGEBOX title=`"$($box.Title)`" method=KEY_Y"
  return $true
}

function Get-CancelButton([IntPtr]$DialogHandle) {
  $script:knouxButtonHandle = [IntPtr]::Zero
  $callback = [KnouxDlgWin+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if ((Get-WindowClass $hWnd) -ne 'Button') { return $true }
    $text = Get-WindowTitle $hWnd
    if ($text -match '(?i)cancel') {
      $script:knouxButtonHandle = $hWnd
      return $false
    }
    return $true
  }
  [void][KnouxDlgWin]::EnumChildWindows($DialogHandle, $callback, [IntPtr]::Zero)
  return $script:knouxButtonHandle
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$dialog = $null
while ((Get-Date) -lt $deadline) {
  $dialog = Find-TargetDialog
  if ($dialog) { break }
  Start-Sleep -Milliseconds 500
}

if (-not $dialog) {
  Write-Output "DIALOG_NOT_FOUND_IN_TIME pattern=`"$TitlePattern`" waitedSeconds=$TimeoutSeconds"
  exit 1
}

Write-Output "DIALOG_FOUND title=`"$($dialog.Title)`""

if ($SelectPath -ne '') {
  # Real user-path selection: fill the native File name field and confirm.
  $escaped = ''
  foreach ($ch in $SelectPath.ToCharArray()) {
    if ('+^%~(){}[]'.Contains($ch)) { $escaped += ('{' + $ch + '}') } else { $escaped += $ch }
  }
  [void][KnouxDlgWin]::SetForegroundWindow($dialog.Handle)
  Start-Sleep -Milliseconds 300

  function Set-FileNameField([IntPtr]$Handle, [string]$Value, [string]$Escaped) {
    $edit = [KnouxDlgWin]::GetDlgItem($Handle, 1148)
    if ($edit -ne [IntPtr]::Zero) {
      [void][KnouxDlgWin]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $Value)
      $readback = Get-WindowTitle $edit
      if ($readback -eq $Value) { return 'WM_SETTEXT' }
    }
    [System.Windows.Forms.SendKeys]::SendWait('%n')
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait($Escaped)
    return 'SENDKEYS'
  }

  $method = Set-FileNameField $dialog.Handle $SelectPath $escaped
  Write-Output "FILENAME_SET method=$method"
  Start-Sleep -Milliseconds 300

  # A single IDOK click is not enough: the classic dialog can still be applying
  # its own filter/validation, and a dialog left open here blocks the app's
  # window (script evaluation on the page stalls behind the modal). Confirm,
  # verify closure, retry, and cancel deliberately if Windows refuses.
  $confirmMethod = ''
  for ($round = 0; $round -lt 4; $round++) {
    $confirm = [KnouxDlgWin]::GetDlgItem($dialog.Handle, 1)
    if ($confirm -ne [IntPtr]::Zero) {
      [void][KnouxDlgWin]::PostMessage($confirm, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
      $confirmMethod = 'IDOK_CLICK'
    } else {
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      $confirmMethod = 'SENDKEYS_ENTER'
    }
    $closed = $true
    for ($tick = 0; $tick -lt 5; $tick++) {
      Start-Sleep -Milliseconds 400
      if (Find-TargetDialog) { $closed = $false; continue }
      # "Confirm Save As" is a separate dialog owned by the same process: answer
      # it, then keep watching, otherwise the target dialog never closes.
      if (Find-AnyProcessDialog) {
        [void](Confirm-MessageBox)
        $closed = $false
        continue
      }
      break
    }
    if ($closed) {
      Write-Output "CONFIRM method=$confirmMethod rounds=$($round + 1)"
      Write-Output "DIALOG_SELECTED path=`"$SelectPath`""
      exit 0
    }
    # Still open: Windows may have bounced a validation balloon. Re-fill and retry.
    $again = Set-FileNameField $dialog.Handle $SelectPath $escaped
    Write-Output "RETRY_FILL round=$($round + 1) method=$again"
  }

  # Give up honestly and dismiss, so no modal is left blocking the application.
  [void][KnouxDlgWin]::PostMessage($dialog.Handle, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 600
  Write-Output "DIALOG_REFUSED_AND_DISMISSED path=`"$SelectPath`" (the OS dialog rejected this selection; nothing was left open)"
  exit 4
}

$method = ''
for ($attempt = 0; $attempt -lt 6; $attempt++) {
  if ($attempt -eq 0) {
    [void][KnouxDlgWin]::PostMessage($dialog.Handle, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
    $method = 'WM_CLOSE'
  } elseif ($attempt -eq 1) {
    $button = Get-CancelButton $dialog.Handle
    if ($button -ne [IntPtr]::Zero) {
      [void][KnouxDlgWin]::PostMessage($button, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
      $method = 'CANCEL_BUTTON'
    }
  } elseif ($attempt -eq 2) {
    [void][KnouxDlgWin]::SetForegroundWindow($dialog.Handle)
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    $method = 'ESC'
  }
  Start-Sleep -Milliseconds 600
  $still = Find-TargetDialog
  if (-not $still) {
    Write-Output "DIALOG_DISMISSED title=`"$($dialog.Title)`" method=$method attempts=$($attempt + 1)"
    exit 0
  }
}

Write-Output "DIALOG_FOUND_NOT_CLOSED title=`"$($dialog.Title)`""
exit 2
