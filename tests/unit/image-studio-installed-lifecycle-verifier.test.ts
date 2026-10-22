import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireForTest = createRequire(__filename);

interface NativeDialogArguments {
  nativeDialogArguments: (
    root: string,
    processId: number,
    kind: 'open' | 'save',
    file: string | null,
    evidence: string,
    sequence: number
  ) => string[];
}

const { nativeDialogArguments } = requireForTest(
  '../../tools/installed-image-lifecycle-driver.cjs'
) as NativeDialogArguments;

function argumentValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  expect(index).toBeGreaterThan(-1);
  return args[index + 1];
}

describe('installed Image Studio native dialog driver', () => {
  test('maps an import to the native Open dialog with the requested file', () => {
    const args = nativeDialogArguments('C:/repo', 4242, 'open', 'C:/repo/fixture.jpg', 'C:/evidence', 3);
    expect(argumentValue(args, '-Mode')).toBe('Open');
    expect(Buffer.from(argumentValue(args, '-PayloadBase64'), 'base64').toString('utf8')).toBe(
      JSON.stringify(['C:/repo/fixture.jpg'])
    );
    expect(argumentValue(args, '-ProcessId')).toBe('4242');
    expect(argumentValue(args, '-ScreenshotPath')).toBe(path.join('C:/evidence', 'native-picker-3.png'));
  });

  test('maps a project save to the native Save dialog with the requested path', () => {
    const args = nativeDialogArguments('C:/repo', 77, 'save', 'C:/evidence/portrait.knouximage', 'C:/evidence', 4);
    expect(argumentValue(args, '-Mode')).toBe('Save');
    expect(Buffer.from(argumentValue(args, '-PayloadBase64'), 'base64').toString('utf8')).toBe(
      JSON.stringify(['C:/evidence/portrait.knouximage'])
    );
  });

  test('maps a cancelled operation to the native Cancel dialog without a payload', () => {
    const args = nativeDialogArguments('C:/repo', 77, 'save', null, 'C:/evidence', 5);
    expect(argumentValue(args, '-Mode')).toBe('Cancel');
    expect(Buffer.from(argumentValue(args, '-PayloadBase64'), 'base64').toString('utf8')).toBe('[]');
    // The helper confirms its own overwrite prompts; the removed switch must not
    // be passed again, because PowerShell would fail on an unknown parameter.
    expect(args).not.toContain('-ConfirmOverwrite');
  });
});

describe('installed Image Studio lifecycle acceptance contract', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../tools/verify-image-studio-project-lifecycle.cjs'),
    'utf8'
  );

  test('reports a failed native dialog with its own reason instead of an unrelated timeout', () => {
    expect(source).toContain('async function settleNativePicker()');
    expect(source).toContain("throw new Error(`Native ${report.nativePickerKind || 'file'} dialog failed: ${error.message}`)");
    expect(source).toContain('await settleNativePicker();');
    expect(source).toContain('report.nativePickerError = error.message;');
  });

  test('covers a cancelled native Save dialog without writing a project', () => {
    expect(source).toContain("await picker('save', null);");
    expect(source).toContain('A cancelled save must not report a saved project');
    expect(source).toContain('A cancelled save must keep the project unsaved');
    expect(source).toContain('A cancelled save must not write a project file');
  });

  test('waits for the real completion signal of the project save', () => {
    expect(source).toContain("await page.locator('.image-studio-saved').waitFor();");
    expect(source).toContain("await page.locator('.image-studio-dirty').waitFor();");
    expect(source).not.toMatch(/setTimeout\(resolve, \d{4,}\)/);
  });

  test('waits for the persisted workspace section before trusting the view', () => {
    // A navigation made before the shell's settings load settles can be
    // overridden by the restored last section, so the acceptance must observe
    // the app's own persistence signal and then confirm the view is still live.
    expect(source).toContain("workspace?.lastOpenedSection === 'image-studio'");
    expect(source).toContain("assert.equal(await page.locator('.app-shell').getAttribute('data-current-view'), 'image-studio')");
  });
});
