import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Knoux X Android signing pipeline', () => {
  const script = read('tools/android-ci-release.sh');

  test('classifies acceptance and production signing modes', () => {
    expect(script).toContain('SIGNING_MODE');
    expect(script).toContain('acceptance');
    expect(script).toContain('production');
  });

  test('production mode requires an explicitly configured keystore', () => {
    expect(script).toContain('KNOUX_ANDROID_KEYSTORE');
    expect(script).toContain('KNOUX_ANDROID_KEYSTORE_PASSWORD');
    expect(script).toContain('KNOUX_ANDROID_KEY_ALIAS');
    expect(script).toContain('Production signing requires KNOUX_ANDROID_KEYSTORE');
  });

  test('production mode fails closed when identity is missing', () => {
    expect(script).toContain('exit 1');
    // No keytool genkeypair in production branch.
    const start = script.indexOf('if [[ "$SIGNING_MODE" == "production" ]]');
    const end = script.indexOf('else', start);
    const prodSection = script.slice(start, end);
    expect(prodSection).not.toContain('keytool -genkeypair');
  });

  test('acceptance mode keeps disposable signing distinguishable', () => {
    expect(script).toContain('knoux-x-ci-release.jks');
    expect(script).toContain('TEST_SIGNED');
  });

  test('records signing label and productionSigned flag', () => {
    expect(script).toContain('signingLabel');
    expect(script).toContain('PRODUCTION_SIGNED');
    expect(script).toContain('TEST_SIGNED');
    expect(script).toContain('productionSigned');
  });

  test('secret values are not logged', () => {
    expect(script).toContain('Secret values are not logged');
    expect(script).not.toMatch(/echo[^\n]*\$STORE_PASS/);
    expect(script).not.toMatch(/echo[^\n]*\$KEY_PASS/);
  });
});
