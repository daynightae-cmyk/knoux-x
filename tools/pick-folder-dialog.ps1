param(
  [Parameter(Mandatory = $true)][string]$FolderPath,
  [string]$TitlePattern = 'Add a folder to KNOUX',
  [string]$ShotPath = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try { Add-Type -AssemblyName Microsoft.VisualBasic } catch {}

Add-Type -Namespace KnouxNative -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, System.Text.StringBuilder lParam);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

$WM_SETTEXT = 0x000C
$BM_CLICK = 0x00F5

function Get-WindowTitle {
  param([IntPtr]$Handle)
  $buffer = New-Object System.Text.StringBuilder 512
  [void][KnouxNative.Win32]::GetWindowText($Handle, $buffer, 512)
  return $buffer.ToString()
}

function Get-WindowClass {
  param([IntPtr]$Handle)
  $buffer = New-Object System.Text.StringBuilder 256
  [void][KnouxNative.Win32]::GetClassName($Handle, $buffer, 256)
  return $buffer.ToString()
}

function Find-DialogHandle {
  $script:dialogHandle = [IntPtr]::Zero
  $callback = [KnouxNative.Win32+EnumWindowsProc] {
    param([IntPtr]$handle, [IntPtr]$state)
    $titleBuffer = New-Object System.Text.StringBuilder 512
    [void][KnouxNative.Win32]::GetWindowText($handle, $titleBuffer, 512)
    if ($titleBuffer.ToString() -like "*$TitlePattern*") {
      $script:dialogHandle = $handle
      return $false
    }
    return $true
  }
  [void][KnouxNative.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  return $script:dialogHandle
}

function Get-DialogChildren {
  param([IntPtr]$Handle)
  $script:children = New-Object System.Collections.Generic.List[object]
  $callback = [KnouxNative.Win32+EnumWindowsProc] {
    param([IntPtr]$handle, [IntPtr]$state)
    $rect = New-Object KnouxNative.Win32+RECT
    [void][KnouxNative.Win32]::GetWindowRect($handle, [ref]$rect)
    $script:children.Add([pscustomobject]@{
      Handle = $handle
      Class = Get-WindowClass -Handle $handle
      Text = (Get-WindowTitle -Handle $handle)
      Visible = [KnouxNative.Win32]::IsWindowVisible($handle)
      Left = $rect.Left
      Top = $rect.Top
      Right = $rect.Right
      Bottom = $rect.Bottom
    })
    return $true
  }
  [void][KnouxNative.Win32]::EnumChildWindows($Handle, $callback, [IntPtr]::Zero)
  return $script:children
}

function Save-DialogScreenshot {
  param([IntPtr]$Handle, [string]$Path)
  if (-not $Path) { return }
  try {
    $rect = New-Object KnouxNative.Win32+RECT
    [void][KnouxNative.Win32]::GetWindowRect($Handle, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) { return }
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
  } catch {}
}

function Save-ScreenScreenshot {
  param([string]$Path)
  if (-not $Path) { return }
  try {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
  } catch {}
}

$deadline = (Get-Date).AddSeconds(45)
$handle = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
  $handle = Find-DialogHandle
  if ($handle -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 400
}

if ($handle -eq [IntPtr]::Zero) {
  Save-ScreenScreenshot -Path $ShotPath
  Write-Output 'DIALOG_NOT_FOUND'
  exit 1
}

$dialogRect = New-Object KnouxNative.Win32+RECT
[void][KnouxNative.Win32]::GetWindowRect($handle, [ref]$dialogRect)
$dialogMidY = [int](($dialogRect.Top + $dialogRect.Bottom) / 2)
Write-Output ("DIALOG_FOUND handle=$handle title=[$(Get-WindowTitle -Handle $handle)] rect=$($dialogRect.Left),$($dialogRect.Top),$($dialogRect.Right),$($dialogRect.Bottom)")

[void][KnouxNative.Win32]::ShowWindow($handle, 9)
[void][KnouxNative.Win32]::BringWindowToTop($handle)
[void][KnouxNative.Win32]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 500

$children = Get-DialogChildren -Handle $handle
foreach ($child in $children) {
  if ($child.Class -match 'Edit|Button|ComboBox|ComboBoxEx') {
    Write-Output "CHILD cls=$($child.Class) visible=$($child.Visible) rect=$($child.Left),$($child.Top),$($child.Right),$($child.Bottom) text=[$($child.Text)]"
  }
}

$nameEdit = $children |
  Where-Object { $_.Class -eq 'Edit' -and $_.Visible -and ($_.Right - $_.Left) -gt 120 -and $_.Top -ge $dialogMidY } |
  Select-Object -Last 1
if (-not $nameEdit) {
  $nameEdit = $children | Where-Object { $_.Class -eq 'Edit' -and $_.Visible -and ($_.Right - $_.Left) -gt 120 } | Select-Object -Last 1
}

if ($nameEdit) {
  [void][KnouxNative.Win32]::SendMessage($nameEdit.Handle, $WM_SETTEXT, [IntPtr]::Zero, $FolderPath)
  Start-Sleep -Milliseconds 350
  $readBuffer = New-Object System.Text.StringBuilder 1024
  [void][KnouxNative.Win32]::SendMessage($nameEdit.Handle, 0x000D, [IntPtr]1024, $readBuffer)
  $readBack = $readBuffer.ToString()
  if ($readBack -eq $FolderPath) {
    Write-Output "NAME_EDIT_VERIFIED"
  } elseif ([string]::IsNullOrEmpty($readBack)) {
    Write-Output 'NAME_EDIT_UNREADABLE_PROCEEDING'
  } else {
    Write-Output "NAME_EDIT_MISMATCH [$readBack]"
    $nameEdit = $null
  }
} else {
  Write-Output 'NAME_EDIT_NOT_FOUND'
}

$selectButton = $children |
  Where-Object { $_.Class -eq 'Button' -and $_.Text -match '(?i)select|choose|open|ok' } |
  Select-Object -First 1

if ($selectButton -and $nameEdit) {
  Write-Output "CLICKING_BUTTON text=[$($selectButton.Text)]"
  [void][KnouxNative.Win32]::SendMessage($selectButton.Handle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 1400
  if ((Find-DialogHandle) -eq [IntPtr]::Zero) {
    Write-Output 'CLOSED_AFTER_BUTTON_CLICK'
    exit 0
  }
}

if ($nameEdit) {
  $clickX = [int](($nameEdit.Left + $nameEdit.Right) / 2)
  $clickY = [int](($nameEdit.Top + $nameEdit.Bottom) / 2)
  [void][KnouxNative.Win32]::SetCursorPos($clickX, $clickY)
  Start-Sleep -Milliseconds 250
  [KnouxNative.Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [KnouxNative.Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 300
  Set-Clipboard -Value $FolderPath
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 350
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 1200
  if ((Find-DialogHandle) -eq [IntPtr]::Zero) {
    Write-Output 'CLOSED_AFTER_EDIT_KEYBOARD'
    exit 0
  }
}

$stillOpen = Find-DialogHandle
if ($stillOpen -ne [IntPtr]::Zero) {
  Save-DialogScreenshot -Handle $stillOpen -Path $ShotPath
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  Start-Sleep -Milliseconds 500
  Write-Output 'DIALOG_STILL_OPEN'
  exit 2
}

Write-Output 'CLOSED_UNKNOWN_PATH'
exit 0
