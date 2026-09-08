import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_APPLICATION_SETTINGS } from '../src/core/settings/applicationSettings';
import { getKnouxThemePreset } from '../src/theme/knouxThemeCatalog';
import { getPlatformCapabilities, supportedAudioOutputFormats } from '../src/platform/platformCapabilities';

const root = path.resolve(__dirname, '..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('KNOUX X absolute final product closure regressions', () => {
  test('fresh application truth is premium daylight', () => {
    expect(DEFAULT_APPLICATION_SETTINGS.theme).toBe('system-light');
    expect(DEFAULT_APPLICATION_SETTINGS.accentColor).toBe('#7828e8');
    expect(getKnouxThemePreset('system-light')).toMatchObject({
      label: 'KNOUX Daylight',
      background: '#f8f7fc',
      surface: '#ffffff',
      accent: '#7828e8',
      logo: 'day',
    });

    const store = read('src/store/appStore.ts');
    expect(store).toContain("currentView: 'home'");
    expect(store).toContain("theme: 'system-light'");
    expect(store).toContain("version: 8");
    expect(store).toContain("?? 'system-light'");
  });

  test('Android capability truth never advertises guaranteed-error audio formats or GIF', () => {
    const capabilities = getPlatformCapabilities({ platform: 'android', screenWakeLock: true, online: false });
    expect(capabilities.audioLab.status).toBe('supported');
    expect(capabilities.audioLab.limits.outputFormats).toEqual(['wav']);
    expect(supportedAudioOutputFormats({ platform: 'android' })).toEqual(['wav']);
    expect(capabilities.gifExport.status).toBe('unsupported');
    expect(capabilities.saf.status).toBe('requires-permission');
    expect(capabilities.screenRecording.status).toBe('requires-permission');
    expect(capabilities.ai.status).toBe('unavailable');
  });

  test('Windows retains the full local audio encoder surface', () => {
    expect(supportedAudioOutputFormats({ platform: 'windows' })).toEqual([
      'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus',
    ]);
  });

  test('Android Audio Lab consumes capability truth and never presents local peak normalization as LUFS', () => {
    const audioView = read('src/features/audio-tools/AudioToolsView.tsx');
    expect(audioView).toContain('supportedAudioOutputFormats');
    expect(audioView).toContain("androidRuntime ? 'wav' : 'mp3'");
    expect(audioView).toContain('Local peak normalization');
    expect(audioView).toContain('WAV PCM only');
  });

  test('mobile speed and wake-lock settings have concrete runtime consumers', () => {
    const consumer = read('src/platform/AndroidPlaybackPreferences.tsx');
    expect(consumer).toContain("mobile.defaultPlaybackSpeed");
    expect(consumer).toContain("mobile.keepScreenAwake");
    expect(consumer).toContain("wakeLock.request('screen')");
    expect(consumer).toContain('rememberedMediaSpeed(currentMedia)');
    expect(consumer).not.toContain('setTimeout');

    const settings = read('src/features/settings/MobileSettingsView.tsx');
    expect(settings).toContain("announceMobileSetting('mobile.keepScreenAwake', true)");
    expect(settings).toContain("setTheme('system-light')");
  });

  test('Video Studio export is gated by a real persistence acknowledgement', () => {
    const mobileStudio = read('src/features/video-studio/MobileVideoStudioView.tsx');
    expect(mobileStudio).toContain('knoux:command-result');
    expect(mobileStudio).toContain('requestId');
    expect(mobileStudio).toContain("detail?.command !== 'save'");
    expect(mobileStudio).not.toContain('setTimeout');

    const editor = read('src/features/editor/MultitrackEditorView.tsx');
    expect(editor).toContain("window.dispatchEvent(new CustomEvent('knoux:command-result'");
    expect(editor).toContain('const snapshot = structuredClone(project)');

    const bridge = read('src/platform/androidMultitrackExportBridge.ts');
    const persistPosition = bridge.indexOf('await (base.save');
    const publishPosition = bridge.indexOf('writeActiveAndroidMultitrackProject(project)', persistPosition);
    expect(persistPosition).toBeGreaterThanOrEqual(0);
    expect(publishPosition).toBeGreaterThan(persistPosition);
  });

  test('Android image runtime uses typed arrays and not Node Buffer globals', () => {
    for (const relative of [
      'src/platform/androidImageEditorBridge.ts',
      'src/platform/androidSafBridge.ts',
      'src/platform/androidRetouchModels.ts',
    ]) {
      const source = read(relative);
      expect(source).not.toMatch(/\bBuffer\.(?:from|alloc)\b/);
      expect(source).toContain('Uint8Array');
    }
  });
});
