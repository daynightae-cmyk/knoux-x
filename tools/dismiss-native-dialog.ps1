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
  $edit = [KnouxDlgWin]::GetDlgItem($dialog.Handle, 1148)
  if ($edit -ne [IntPtr]::Zero) {
    [void][KnouxDlgWin]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $SelectPath)
    Write-Output 'FILENAME_SET method=WM_SETTEXT'
  } else {
    [System.Windows.Forms.SendKeys]::SendWait('%n')
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait($escaped)
    Write-Output 'FILENAME_SET method=SENDKEYS'
  }
  Start-Sleep -Milliseconds 300
  $confirm = [KnouxDlgWin]::GetDlgItem($dialog.Handle, 1)
  if ($confirm -ne [IntPtr]::Zero) {
    [void][KnouxDlgWin]::PostMessage($confirm, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Output 'CONFIRM method=IDOK_CLICK'
  } else {
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Write-Output 'CONFIRM method=SENDKEYS_ENTER'
  }
  $selectDeadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $selectDeadline) {
    if (-not (Find-TargetDialog)) {
      Write-Output "DIALOG_SELECTED path=`"$SelectPath`""
      exit 0
    }
    [void](Confirm-MessageBox)
    Start-Sleep -Milliseconds 400
  }
  Write-Output "DIALOG_SELECT_TIMEOUT path=`"$SelectPath`""
  exit 3
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
