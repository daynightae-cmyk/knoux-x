import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Knoux X Android release acceptance contract', () => {
  const workflow = read('.github/workflows/android-release-acceptance.yml');
  const debugWorkflow = read('.github/workflows/android-apk.yml');
  const helper = read('tools/android-ci-release.sh');
  const smoke = read('tools/android-emulator-smoke.sh');
  const verifier = read('tools/verify-android-apk.cjs');
  const installed = read('tools/run-android-installed-acceptance.sh');
  const diagnostics = read('tools/android-acceptance-diagnostics.sh');
  const configurator = read('tools/configure-android-webview-debugging.cjs');
  const nativeMedia = read('tools/prepare-android-native-media.cjs');
  const overlay = read('src/components/mobile/MobileSplashOverlay.tsx');

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
    expect(verifier).toContain('process.argv[3] || path.dirname(apk)');
    expect(workflow).toContain('node tools/verify-android-apk.cjs android-ci-release-output/KNOUX-X-Android-release-ci-signed.apk');
  });

  test('verifies optimized release resources by content instead of unstable resource names', () => {
    expect(verifier).toContain("files.filter((file) => file.toLowerCase().endsWith('.png'))");
    expect(verifier).toContain('candidate.decoded.data.equals(source.decoded.data)');
    expect(verifier).toContain("files.filter((file) => file.toLowerCase().endsWith('.xml') && file.startsWith('res/'))");
    expect(verifier).toContain("adaptiveIcons.filter((item) => item.hasMonochrome).length >= 2");
    expect(verifier).not.toContain("resourceFiles(resources, 'mipmap/ic_launcher')");
    expect(verifier).not.toContain("icon='res/mipmap-anydpi-v33/ic_launcher.xml'");
  });

  test('installs and launches the exact release artifact on the emulator', () => {
    expect(smoke).toContain('APK="${1:-android-ci-output/KNOUX-X-Android-debug.apk}"');
    expect(workflow).toContain('bash tools/run-android-installed-acceptance.sh android-ci-release-output android-ci-release-output/KNOUX-X-Android-release-ci-signed.apk');
    expect(installed).toContain('bash tools/android-emulator-smoke.sh "$APK" dev.knoux.playerx "$OUTPUT_DIR"');
    expect(installed).toContain('set -euo pipefail');
    expect(workflow).toContain("data['installedAndLaunched'] = True");
  });

  test('requires actual functional verdict and preserves diagnostic command failures', () => {
    expect(installed).toContain('KNOUX_ANDROID_EVIDENCE_DIR="$OUTPUT_DIR" node tools/android-real-workflows.cjs');
    expect(workflow).toContain("functional.get('verdict') != 'PASS_SCOPED_CASES_ONLY'");
    expect(diagnostics).toContain('local status=$?');
    expect(diagnostics).toContain('exit "$status"');
  });

  test('enables WebView debugging only for debug and acceptance builds', () => {
    expect(nativeMedia).not.toContain('setWebContentsDebuggingEnabled(true)');
    expect(configurator).toContain('delete config.android.webContentsDebuggingEnabled');
    expect(configurator).toContain('config.android.webContentsDebuggingEnabled = true');
    expect(configurator).toContain('const MODES = new Set(["debug", "acceptance", "production"])');
    expect(helper).toContain('node tools/configure-android-webview-debugging.cjs "$ANDROID_DIR" "$SIGNING_MODE"');
    expect(helper).toContain('packagedWebContentsDebuggingEnabled');
    expect(helper).toContain('Production-signed APK must not expose WebView debugging.');
    expect(debugWorkflow).toContain('node tools/configure-android-webview-debugging.cjs android debug');
  });

  test('does not make release acceptance depend solely on WebView console logging', () => {
    expect(smoke).toContain('MARKER_READY=false');
    expect(smoke).toContain('foreground_activity_ready');
    expect(smoke).toContain('native_splash_gone');
    expect(smoke).toContain('Splash Screen $PACKAGE');
    expect(smoke).toContain('wait_for_home_screen "$OUTPUT_DIR/android-launch.png" 10');
    expect(smoke).toContain('--require-marker');
    expect(smoke).toContain("READINESS_SOURCE='foreground+visual+ready-ui'");
    expect(smoke).toContain('android-ui-readiness.txt');
    expect(smoke).toContain("grep -q 'KNOUX_ANDROID_UI_READY'");
  });

  test('requires the renderer marker only where Capacitor forwards the console', () => {
    expect(smoke).toContain('app_is_debuggable');
    expect(smoke).toContain('MARKER_SUPPORTED=false');
    expect(smoke).toContain("marker_args+=('--require-marker')");
    expect(smoke).toContain('node tools/verify-android-screen.cjs "$destination" "${marker_args[@]}"');
    expect(smoke).not.toContain('node tools/verify-android-screen.cjs "$destination" --require-marker');
    expect(smoke).toContain('android-console-marker-supported.txt');
  });

  test('proves the actionable interface instead of accepting a rendered splash', () => {
    expect(smoke).toContain('write_readiness_marker');
    expect(smoke).toContain('android-splash-frame.png');
    expect(overlay).toContain('KNOUX_ANDROID_UI_READY screen=');
  });
});
