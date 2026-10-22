import fs from 'node:fs';
import path from 'node:path';

describe('installed slideshow verifier recovery boundaries', () => {
  test('reacquires the visible native dialog and its Win32 controls with a bounded retry', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../tools/slideshow-phase1-native-dialog.ps1'),
      'utf8'
    );
    expect(source).toContain('function Get-DialogState');
    // The modern common dialog exposes its controls as plain child windows, and
    // a process-wide UIA search can block on a busy desktop, so the helper is
    // deliberately Win32-only.
    expect(source).not.toContain('System.Windows.Automation');
    expect(source).not.toContain('Add-Type -AssemblyName UIAutomationClient');
    expect(source).not.toContain('AutomationElement');
    expect(source).toContain('[KnouxNativeDialog]::EnumChildWindows($Dialog');
    expect(source).toContain("[KnouxNativeDialog]::IsWindowVisible($handle)");
    expect(source).toContain('$payload = @($parsedPayload)');
    expect(source).not.toContain('Type-Control $filenameEditor.Handle $Directory');
    expect(source).toContain('$Dialog = [IntPtr]::Zero');
    expect(source).toContain('[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)');
    expect(source).toContain('$dialogState = Get-DialogState -TimeoutSeconds 20');
    expect(source).toContain('[KnouxNativeDialog]::SendMessage($folderEditor.Handle, 0x000C');
  });

  test('drives the file-name box of the native dialog with the requested path', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../tools/slideshow-phase1-native-dialog.ps1'),
      'utf8'
    );
    // The Save dialog resolves its own file-name state, so the absolute target
    // is typed as real key input and never through the address band.
    expect(source).toContain('function Find-FileNameEditor');
    expect(source).toContain("$_.Class -eq 'Edit'");
    expect(source).toContain('$preferredIds = @(1001, 1148, 1152)');
    expect(source).toContain('$preferredIds = @(1148, 1001, 1152)');
    expect(source).toContain('Type-Control $editor.Handle $text');
    expect(source).toContain('function Get-ControlTextLength');
    // The dialog applies its default name asynchronously after it opens, so a
    // single pass can leave the typed path appended to that default. The value
    // the dialog will commit is read back through WM_GETTEXT (marshalled
    // across processes) and retyped until it matches exactly.
    expect(source).toContain('function Get-ControlText');
    expect(source).toContain('0x000D');
    expect(source).toContain('for ($attempt = 1; $attempt -le 4; $attempt++)');
    expect(source).toContain('$observed = Get-ControlText $editor.Handle');
    expect(source).toContain('if ($observed -eq $text) { break }');
    expect(source).toContain('Native Save filename control did not hold the requested path');
    expect(source).toContain('$record.enteredPath = $text');
    // The address band keeps a hidden edit, so the helper must not drive it.
    expect(source).not.toContain('Navigate-DialogAddress');
    expect(source).not.toContain('Native dialog directory mismatch after 3 attempts');
    expect(source).not.toContain('Click-DialogAddressGo');
  });

  test('confirms the native dialog through its own Win32 buttons', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../tools/slideshow-phase1-native-dialog.ps1'),
      'utf8'
    );
    expect(source).toContain('function Click-DialogButton');
    expect(source).toContain('function Resolve-SaveConfirmation');
    expect(source).toContain("Wait-DialogClosed $prompt 'Native overwrite dialog' 10");
    // A visible file dialog that is still rebuilding itself is not an overwrite
    // prompt: only a window exposing a confirmation button is acted on.
    expect(source).toContain('if ($confirm) {');
    expect(source).not.toContain('Overwrite confirmation button was not found');
    expect(source).toContain("Wait-DialogClosed $dialog 'Native Open dialog' 10");
    expect(source).toContain("Wait-DialogClosed $dialog 'Native Cancel dialog' 10");
    expect(source).toContain("Wait-DialogClosed $dialog 'Native folder dialog' 10");
    // UI Automation does not expose the modern dialog buttons, so they are
    // driven through their window handles.
    expect(source).not.toContain('Invoke-AutomationButton');
    expect(source).not.toContain('-ConfirmOverwrite');
  });

  test('reconnects only to the same live installed process and normalizes uncertain input', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../tools/run-slideshow-phase1-installed-verification.cjs'),
      'utf8'
    );
    expect(source).toContain('async function connectRenderer');
    expect(source).toContain('if (!appIsAlive())');
    expect(source).toContain('attempt < 8');
    expect(source).toContain("timeout: 45_000");
    expect(source).toContain("type: 'mouseReleased'");
    expect(source).toContain("type: 'keyUp'");
    expect(source).toContain('recoverCdpInput(`${id}:uncertain-click`');
    expect(source).toContain('pointer-click:idempotent-retry');
    expect(source).toContain('idempotentRetry &&');
    expect(source).toContain("recoverCdpInput('idempotent-dom-read')");
    expect(source).toContain('return driver.rawRead(expression)');
    expect(source).toContain('nativePointerDrag(start, end, id, source.viewportWidth, source.viewport)');
    expect(source).toContain('recoverCdpInput(`screenshot:${name}`)');
    expect(source).toContain('useNativeScreenshotCapture = true');
    expect(source).toContain('captureInstalledWindow(outputPath, viewport)');
    expect(source).toContain('nativeMouseWheel(deltaY, state.viewportWidth, state.viewport)');
    expect(source).toContain("recoverCdpInput('idempotent-scroll'");
    expect(source).toContain('nativeFill(');
    expect(source).toContain('Visible text fill did not reach the requested value');
    expect(source).toContain('await activeDriver.controlState(expression)');
    expect(source).toContain('attempt < 3');
    expect(source).toContain('native-input:fill-reacquire');
    expect(source).toContain("`${id}:fill-retry-${attempt}`");
    expect(source).toContain('native-input:select-reacquire');
    expect(source).toContain("`${id}:select-retry-${attempt}`");
    expect(source).toContain('native-input:range-reacquire');
    expect(source).toContain("`${id}:range-retry-${attempt}`");
    expect(source).toContain('observed ${after?.value');
    const captureSource = fs.readFileSync(
      path.resolve(__dirname, '../../tools/slideshow-phase1-capture-window.ps1'),
      'utf8'
    );
    expect(captureSource).toContain('[KnouxInstalledWindowCapture]::PrintWindow');
    expect(captureSource).toContain('Sort-Object ViewportError');
    expect(captureSource).toContain('$script:processIds -contains $ownerPid');
    expect(captureSource).toContain('[DateTime]::UtcNow.AddSeconds(12)');
    expect(captureSource).toContain('[KnouxInstalledWindowCapture]::ShowWindow');
    expect(captureSource).toContain('[KnouxInstalledWindowCapture]::SetForegroundWindow');
    expect(captureSource).toContain('Where-Object Visible');
    expect(captureSource).toContain('acquisitionAttempts = $attempts');
    const inputSource = fs.readFileSync(
      path.resolve(__dirname, '../../tools/slideshow-phase1-native-input.ps1'),
      'utf8'
    );
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::mouse_event(0x0800');
    expect(inputSource).toContain("[ValidateSet('Wheel', 'Click', 'Drag', 'Select', 'Range', 'Fill')]");
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::ClientToScreen');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::SetWindowPos');
    expect(inputSource).toContain('$script:processIds -notcontains $foregroundAfterPid');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::AttachThreadInput');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::keybd_event(0x12');
    expect(inputSource).toContain('$bounds.Top + 10');
    expect(inputSource).toContain('activationClick = $activationClick');
    expect(inputSource).toContain('foregroundVerified = $foregroundVerified');
    expect(inputSource).toContain('Sort-Object ViewportError');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::GetDpiForWindow');
    expect(inputSource).toContain('$X * $scale');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::mouse_event(0x0002');
    expect(inputSource).toContain('Send-VirtualKey 0x24');
    expect(inputSource).toMatch(
      /Click-CurrentPointer\r?\n\s+# Chromium may acknowledge the physical click/
    );
    expect(inputSource).toContain('Start-Sleep -Milliseconds 180');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::SendChord(0x11, 0x41)');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::SendUnicodeText($text)');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::EnumWindows');
  });
});
