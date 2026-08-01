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
    expect(source).toContain('$Dialog = [IntPtr]::Zero');
    expect(source).toContain('[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)');
    expect(source).toContain("Wait-DialogClosed $dialog 'Native Save dialog'");
    expect(source).toContain("Wait-DialogClosed $overwriteDialog 'Native overwrite dialog'");
  });

  test('reconnects only to the same live installed process and normalizes uncertain input', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../tools/run-slideshow-phase1-installed-verification.cjs'),
      'utf8'
    );
    expect(source).toContain('async function connectRenderer');
    expect(source).toContain('if (!appIsAlive())');
    expect(source).toContain('attempt < 8');
    expect(source).toContain("type: 'mouseReleased'");
    expect(source).toContain("type: 'keyUp'");
    expect(source).toContain('pointer-recovered-after-uncertain-press');
    expect(source).toContain('blindly replaying this possibly non-idempotent click is forbidden');
  });
});
