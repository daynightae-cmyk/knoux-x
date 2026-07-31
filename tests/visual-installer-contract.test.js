const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('KNOUX Windows visual installer contract', () => {
  test('embeds the Squirrel payload and all nine official slides', () => {
    const source = read('installer/windows/KnouxVisualInstaller.cs');
    expect(source).toContain('Knoux.Payload.Setup.exe');
    expect(source).toContain('Enumerable.Range(1, 9)');
    expect(source).toContain('Knoux.Slide.');
    expect(source).toContain('slides=9');

    const build = read('tools/build-visual-installer.ps1');
    expect(build).toContain('for ($index = 1; $index -le 9; $index++)');
    expect(build).toContain('/resource:$setup,Knoux.Payload.Setup.exe');
    expect(build).toContain('assets/installer/slides');
    expect(build).toContain('--self-test');
    expect(build).toContain('visual-installer-self-test.json');

    for (let index = 1; index <= 9; index += 1) {
      const slide = path.join(root, 'assets', 'installer', 'slides', `${String(index).padStart(2, '0')}.png`);
      const stats = fs.statSync(slide);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1024);
    }
  });

  test('supports bilingual interactive install, upgrade, repair and uninstall', () => {
    const source = read('installer/windows/KnouxVisualInstaller.cs');
    expect(source).toContain('English');
    expect(source).toContain('العربية');
    expect(source).toContain('Upgrade or Repair');
    expect(source).toContain('Install now');
    expect(source).toContain('Uninstall');
    expect(source).toContain('--install-silent-test');
    expect(source).toContain('--repair-silent-test');
    expect(source).toContain('--uninstall-silent-test');
    expect(source).toContain('--uninstall -s');
    expect(source).toContain('WaitForInstallation');
  });

  test('writes machine-readable evidence for every acceptance mode', () => {
    const source = read('installer/windows/KnouxVisualInstaller.cs');
    expect(source).toContain('WriteEvidence(string destination, string mode, bool success');
    expect(source).toContain('json.AppendLine("  \\"success\\": " + (success ? "true" : "false") + ",");');
    expect(source).toContain('WriteEvidence(evidencePath, "self-test", true, details);');
    expect(source).toContain('WriteEvidence(evidencePath, "self-test", false, details);');
    expect(source).toContain('WriteEvidence(evidencePath, mode, false, details);');
    expect(source).toContain('"install"');
    expect(source).toContain('"repair"');
    expect(source).toContain('"uninstall"');
    expect(source).toContain('"self-test"');
    expect(source).toContain('installed-executable=');

    const build = read('tools/build-visual-installer.ps1');
    expect(build).toContain('ConvertFrom-Json');
    expect(build).toContain("$evidenceDocument.success -ne $true");
    expect(build).toContain("$evidenceDocument.mode -ne 'self-test'");
    expect(build).toContain("$_ -eq 'slides=9'");
    expect(build).toContain("$_ -eq 'languages=en,ar'");
  });

  test('build script compiles a Unicode x64 WinForms executable with the official icon', () => {
    const build = read('tools/build-visual-installer.ps1');
    expect(build).toContain('/target:winexe');
    expect(build).toContain('/platform:x64');
    expect(build).toContain('/codepage:65001');
    expect(build).toContain('/win32icon:$icon');
    expect(build).toContain('System.Windows.Forms.dll');
    expect(build).toContain('System.Drawing.dll');
    expect(build).toContain('Compiled visual installer is not larger than its embedded Squirrel payload.');
  });
});
