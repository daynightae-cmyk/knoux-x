import fs from 'node:fs';
import path from 'node:path';

describe('installed slideshow verifier recovery boundaries', () => {
  test('reacquires the visible native dialog, UIA root, and controls with a bounded retry', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../tools/slideshow-phase1-native-dialog.ps1'),
      'utf8'
    );
    expect(source).toContain('function Get-DialogState');
    expect(source).toContain('[Windows.Automation.AutomationElement]::FromHandle($Dialog)');
    expect(source).toContain('[Windows.Automation.AutomationElement]::RootElement.FindAll(');
    expect(source).toContain('[Windows.Automation.AutomationElement]::ProcessIdProperty');
    expect(source).toContain("$_.Class -eq 'Edit' -and $_.Id -eq 1001");
    expect(source).toContain('Type-Control $filenameEditor.Handle $Directory');
    expect(source).toContain('$Directory');
    expect(source).toContain('Click-Control $confirm.Handle');
    expect(source).toContain('$Dialog = [IntPtr]::Zero');
    expect(source).toContain('[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)');
    expect(source).toContain('$dialogState = Get-DialogState -TimeoutSeconds 20');
    expect(source).toContain("Wait-DialogClosed $dialog 'Native Save dialog'");
    expect(source).toContain("Wait-DialogClosed $overwriteDialog 'Native overwrite dialog'");
    expect(source).toContain('[KnouxNativeDialog]::SendMessage($folderEditor.Handle, 0x000C');
    expect(source).toContain("Invoke-AutomationButton $automationControls '1' 'Select Folder'");
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
    expect(inputSource).toContain(
      'Click-CurrentPointer\n  # Chromium may acknowledge the physical click'
    );
    expect(inputSource).toContain('Start-Sleep -Milliseconds 180');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::SendChord(0x11, 0x41)');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::SendUnicodeText($text)');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::EnumWindows');
  });
});
