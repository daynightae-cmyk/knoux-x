const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyAndroidAppPlugin } = require('../../tools/verify-android-app-plugin.cjs');

describe('generated App plugin contract', () => {
  let root;
  const put = (name, value) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-app-registration-'));
    put('package.json', { dependencies: { '@capacitor/core': '8.5.0', '@capacitor/app': '8.1.2' }, devDependencies: { '@capacitor/cli': '8.5.0', '@capacitor/android': '8.5.0' } });
    for (const name of ['core', 'cli', 'android', 'app']) put(`node_modules/@capacitor/${name}/package.json`, { version: name === 'app' ? '8.1.2' : '8.5.0' });
    put('android/app/src/main/assets/capacitor.plugins.json', [{ pkg: '@capacitor/app', classpath: 'com.capacitorjs.plugins.app.AppPlugin' }]);
    put('android/capacitor.settings.gradle', "include ':capacitor-app'\nproject(':capacitor-app').projectDir = new File('../node_modules/@capacitor/app/android')");
    put('android/app/capacitor.build.gradle', "dependencies { implementation project(':capacitor-app') }");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  test('accepts a fully registered compatible pinned toolchain', () => expect(verifyAndroidAppPlugin(root).gradleRegistered).toBe(true));
  test('rejects an installed but undeclared plugin (the previous no-save failure)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    delete manifest.dependencies['@capacitor/app']; put('package.json', manifest);
    expect(() => verifyAndroidAppPlugin(root)).toThrow('manifest dependency');
  });
  test('rejects package drift', () => { put('node_modules/@capacitor/app/package.json', { version: '8.1.1' }); expect(() => verifyAndroidAppPlugin(root)).toThrow('expected locked 8.1.2'); });
  test('rejects a synced registry with no App plugin', () => { put('android/app/src/main/assets/capacitor.plugins.json', []); expect(() => verifyAndroidAppPlugin(root)).toThrow('capacitor.plugins.json'); });
  test('rejects a missing Gradle include', () => { put('android/capacitor.settings.gradle', ''); expect(() => verifyAndroidAppPlugin(root)).toThrow('Gradle project'); });
  test('rejects a missing application dependency', () => { put('android/app/capacitor.build.gradle', ''); expect(() => verifyAndroidAppPlugin(root)).toThrow('Gradle dependency'); });
});
