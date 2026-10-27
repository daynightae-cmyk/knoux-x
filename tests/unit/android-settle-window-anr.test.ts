import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
// Git stores these scripts with LF, but a Windows checkout materialises CRLF, so
// any assertion that spans lines has to read a normalised copy.
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');

/** Pull one top-level bash function out of the script so an assertion cannot
 *  pass by matching the same words somewhere else in the file. */
const functionBody = (source: string, name: string): string => {
  const start = source.indexOf(`${name}() {`);
  if (start === -1) throw new Error(`${name}() is missing from the script`);
  const end = source.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`${name}() body is not terminated`);
  return source.slice(start, end);
};

describe('Android settle-window ANR contract', () => {
  const smoke = read('tools/android-emulator-smoke.sh');
  const settle = functionBody(smoke, 'wait_for_settled_frame');

  // 2026-10-27: main (42aef17) and PR #89 both failed this step with a
  // correctly rendered home screen behind a "Pixel Launcher isn't responding"
  // dialog. The ANR helpers existed but were only called before the exercise,
  // never during it, so a dialog raised inside the window was reported as an
  // app defect.
  test('looks for a foreign ANR while waiting for a settled frame', () => {
    expect(settle).toContain('foreign_anr_packages');
    expect(settle).toContain('handle_foreign_anr');
  });

  test('still fails closed when the dialog cannot be cleared safely', () => {
    expect(settle).toMatch(/if ! handle_foreign_anr; then[\s\S]*?return 1/);
  });

  test('keeps every assertion the gate made before the fix', () => {
    expect(settle).toContain('node tools/verify-android-screen.cjs');
    expect(settle).toContain('png_dimensions');
    expect(settle).toContain('cmp -s "$settle" "$destination"');
    // Success may only be claimed from the settled-and-verified branch, so the
    // recovery path cannot return early with an unproven frame.
    expect(settle.match(/return 0/g)).toHaveLength(1);
  });

  test('grants extra budget only after an actual recovery', () => {
    expect(settle).toContain('extra=$((extra + 10))');
    expect(settle).toMatch(/while \(\( attempt < attempts \+ extra \)\)/);
    // A clean run must still be bounded by the caller's budget alone.
    expect(settle.indexOf('extra=$((extra + 10))')).toBeGreaterThan(settle.indexOf('while'));
  });

  test('never lets the app dismiss its own ANR', () => {
    const dismiss = functionBody(smoke, 'dismiss_foreign_anr');
    expect(dismiss).toContain('KNOUX X itself is not responding; refusing to dismiss');
    expect(dismiss).toContain('return 1');
  });
});
