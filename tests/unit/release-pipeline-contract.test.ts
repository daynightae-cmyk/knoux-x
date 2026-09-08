import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Knoux X unified release pipeline contracts', () => {
  test('master workflow orchestrates one release across three platforms', () => {
    const workflow = read('.github/workflows/knoux-live-release.yml');
    expect(workflow).toContain('knoux-x-production-release');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain("'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('workflow_dispatch');
    for (const job of ['preflight:', 'quality:', 'windows:', 'android:', 'web:', 'publish:']) {
      expect(workflow).toContain(job);
    }
    // Platform builds run after shared gates; publish runs last.
    expect(workflow).toContain('needs: [preflight, quality]');
    expect(workflow).toContain('needs: [preflight, quality, windows, android, web]');
    // Same-SHA enforcement and transactional publish.
    expect(workflow).toContain('KNOUX_RELEASE_SHA');
    expect(workflow).toContain('--draft');
    expect(workflow).toContain('knoux-release-manifest.cjs');
    expect(workflow).toContain('verify-web-production.cjs');
    // Native runners per platform.
    expect(workflow).toContain('windows-2022');
    // Signing truth is reported, never faked.
    expect(workflow).toContain('not-configured');
    expect(workflow).toContain('windows-signing');
    expect(workflow).toContain('android-signing');
  });

  test('updater IPC travels through the authoritative registry', () => {
    const contract = read('electron/ipc/contract.ts');
    for (const channel of ['update:check', 'update:download', 'update:install', 'update:status']) {
      expect(contract).toContain(`'${channel}'`);
    }
    const preload = read('electron/preload.ts');
    expect(preload).toContain('updateAPI');
    expect(preload).toContain('UPDATE_CHECK');
    expect(preload).toContain('UPDATE_STATUS');
    expect(preload).toContain('update: typeof updateAPI');
    const setup = read('electron/ipc/setup.ts');
    expect(setup).toContain('setupUpdateHandlers');
    expect(setup).toContain("registry.forOwner('core-update')");
    const main = read('electron/main.ts');
    expect(main).toContain('startAppUpdater');
  });

  test('main-process updater never auto-downloads or runs arbitrary binaries', () => {
    const updater = read('electron/startup/app-updater.ts');
    expect(updater).toContain('autoDownload = false');
    expect(updater).toContain("provider: 'github'");
    expect(updater).toContain('daynightae-cmyk');
    expect(updater).toContain('quitAndInstall');
    expect(updater).toContain('app.isPackaged');
    expect(updater).toContain("process.platform === 'win32'");
  });

  test('Settings About exposes version, SHA and update discovery', () => {
    const settings = read('src/features/settings/SettingsView.tsx');
    expect(settings).toContain('<ReleaseUpdatePanel />');
    expect(settings).toContain('getReleaseInfo()');
    const panel = read('src/features/settings/ReleaseUpdatePanel.tsx');
    expect(panel).toContain('window.knouxAPI.update.check()');
    expect(panel).toContain('window.knouxAPI.update.download()');
    expect(panel).toContain('window.knouxAPI.update.install()');
    expect(panel).toContain('checkManifestForUpdate');
    expect(panel).toContain('updateAndroidApproval');
    const locales = read('src/locales/settingsStudio.ts');
    for (const key of ['updateCheck', 'updateDownload', 'updateDownloadApk', 'updateInstall', 'updateAvailable', 'updateCurrent', 'updateLatest', 'updateBuild', 'updateChannel']) {
      expect(locales).toContain(`${key}:`);
    }
  });

  test('release tooling is deterministic and secret-free', () => {
    expect(read('tools/knoux-release-version.cjs')).toContain('* 10000');
    expect(read('tools/knoux-release-manifest.cjs')).toContain("product: 'Knoux X'");
    expect(read('tools/knoux-release-manifest.cjs')).toContain('versionCode');
    expect(read('tools/verify-web-production.cjs')).toContain('STALE');
    expect(read('tools/knoux-release-prepare.cjs')).toContain('release:prepare');
    const workflow = read('.github/workflows/knoux-live-release.yml');
    expect(workflow).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/i);
    expect(workflow).toContain('secrets.KNOUX_ANDROID_KEYSTORE_BASE64');
  });
});
