import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Knoux X Android release acceptance contract', () => {
  const workflow = read('.github/workflows/android-release-acceptance.yml');
  const helper = read('tools/android-ci-release.sh');
  const smoke = read('tools/android-emulator-smoke.sh');
  const verifier = read('tools/verify-android-apk.cjs');

  test('builds a real Gradle release variant instead of stopping at assembleDebug', () => {
    expect(helper).toContain('./gradlew assembleRelease --no-daemon --stacktrace');
    expect(helper).toContain('app/build/outputs/apk/release/app-release-unsigned.apk');
    expect(workflow).toContain('Build and CI-sign release APK');
  });

  test('creates an installable signed acceptance APK without pretending it is production-signed', () => {
    expect(helper).toContain('apksigner');
    expect(helper).toContain('Knoux X CI Release Verification');
    expect(helper).toContain('"productionSigned": false');
    expect(helper).toContain('"purpose": "installable release acceptance only"');
    expect(workflow).toContain("data['productionSigned'] = False");
  });

  test('runs the same packaged identity verifier against the release artifact', () => {
    expect(verifier).toContain("process.argv[2] || 'android-ci-output/KNOUX-X-Android-debug.apk'");
    expect(workflow).toContain('node tools/verify-android-apk.cjs android-ci-release-output/KNOUX-X-Android-release-ci-signed.apk');
  });

  test('installs and launches the exact release artifact on the emulator', () => {
    expect(smoke).toContain('APK="${1:-android-ci-output/KNOUX-X-Android-debug.apk}"');
    expect(workflow).toContain('bash tools/android-emulator-smoke.sh android-ci-release-output/KNOUX-X-Android-release-ci-signed.apk dev.knoux.playerx android-ci-release-output');
    expect(workflow).toContain("data['installedAndLaunched'] = True");
  });
});
