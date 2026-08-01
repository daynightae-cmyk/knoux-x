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
    expect(source).toContain('pointer-recovered-after-uncertain-press');
    expect(source).toContain('blindly replaying this possibly non-idempotent click is forbidden');
    expect(source).toContain('recoverCdpInput(`screenshot:${name}`)');
    expect(source).toContain('useNativeScreenshotCapture = true');
    expect(source).toContain('captureInstalledWindow(outputPath)');
    expect(source).toContain('nativeMouseWheel(deltaY)');
    const captureSource = fs.readFileSync(
      path.resolve(__dirname, '../../tools/slideshow-phase1-capture-window.ps1'),
      'utf8'
    );
    expect(captureSource).toContain('[KnouxInstalledWindowCapture]::PrintWindow');
    expect(captureSource).toContain('Sort-Object Area -Descending');
    expect(captureSource).toContain('$script:processIds -contains $ownerPid');
    const inputSource = fs.readFileSync(
      path.resolve(__dirname, '../../tools/slideshow-phase1-native-input.ps1'),
      'utf8'
    );
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::mouse_event(0x0800');
    expect(inputSource).toContain('[KnouxInstalledNativeInput]::EnumWindows');
  });
});
