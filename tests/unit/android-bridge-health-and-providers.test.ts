/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';

import {
  markAndroidBridgeAbsent,
  markAndroidBridgeFailed,
  markAndroidBridgeReady,
  readAndroidBridge,
  readAndroidBridgeHealth,
  resetAndroidBridgeHealth,
} from '../../src/platform/androidBridgeHealth';
import { installAndroidBackButton } from '../../src/platform/androidBackButton';
import { installAndroidRuntimeBridge } from '../../src/platform/androidRuntimeBridge';
import { installAndroidSafBridge } from '../../src/platform/androidSafBridge';

const main = readFileSync('src/main.tsx', 'utf8');
const developerView = readFileSync('src/features/settings/MobileDeveloperView.tsx', 'utf8');

type Loose = Record<string, unknown>;

beforeEach(() => {
  resetAndroidBridgeHealth();
  window.localStorage.clear();
});

describe('Android bridge health records the real outcome', () => {
  test('a capability nobody tried to install is reported as absent, never as ready', () => {
    expect(readAndroidBridge('capture')).toMatchObject({
      name: 'capture',
      state: 'absent',
      detail: 'This build never attempted the bridge.',
    });
  });

  test('an explicit absence outranks the optimistic default', () => {
    markAndroidBridgeReady('saf');
    expect(readAndroidBridge('saf').state).toBe('ready');
    markAndroidBridgeAbsent('saf', 'The KnouxSaf native plugin is not in this build.');
    markAndroidBridgeReady('saf');
    expect(readAndroidBridge('saf')).toEqual({
      name: 'saf',
      state: 'absent',
      detail: 'The KnouxSaf native plugin is not in this build.',
    });
  });

  test('a thrown install is kept as a failure with its real reason', () => {
    markAndroidBridgeFailed('audio-tools', 'KnouxAudio plugin returned null');
    expect(readAndroidBridgeHealth().find((entry) => entry.name === 'audio-tools')).toMatchObject({
      state: 'failed',
      detail: 'KnouxAudio plugin returned null',
    });
  });

  test('the SAF bridge marks itself absent when the native plugin is missing', () => {
    Reflect.deleteProperty(window, 'Capacitor');
    expect(() => installAndroidSafBridge()).not.toThrow();
    expect(readAndroidBridge('saf')).toMatchObject({
      state: 'absent',
      detail: 'The KnouxSaf native plugin is not in this build, so documents picked here are not persisted through SAF.',
    });
  });

  test('the hardware back bridge says so when Capacitor App is unavailable', () => {
    Reflect.deleteProperty(window, 'Capacitor');
    const dispose = installAndroidBackButton();
    expect(typeof dispose).toBe('function');
    expect(readAndroidBridge('back-button').state).toBe('absent');
    expect(readAndroidBridge('back-button').detail).toMatch(/Capacitor App/i);
    dispose();
  });

  test('main.tsx records both outcomes instead of only logging', () => {
    expect(main).toContain('markAndroidBridgeReady(name)');
    expect(main).toContain('markAndroidBridgeFailed(name, message)');
    expect(main).toContain('KNOUX_ANDROID_BRIDGE_FAILED');
  });

  test('the developer view lists capability state and keeps raw reasons behind the diagnostics flag', () => {
    expect(developerView).toContain('readAndroidBridgeHealth()');
    expect(developerView).toContain('data-bridge-state');
    expect(developerView).toContain("get('knouxDiagnostics') === '1'");
    expect(developerView).toMatch(/diagnostics && entry\.detail/);
  });
});

describe('Android never presents an AI provider it does not have (directive §17)', () => {
  let image: Window['knouxImageStudioAPI'];
  let video: Window['knouxVideoStudioAPI'];

  beforeEach(() => {
    resetAndroidBridgeHealth();
    for (const name of [
      'knouxRuntime',
      'knouxAPI',
      'knouxCreativeAPI',
      'knouxRecordingAPI',
      'knouxMultitrackAPI',
      'knouxSlideshowAPI',
      'knouxAudioToolsAPI',
      'knouxImageStudioAPI',
      'knouxVideoStudioAPI',
      'Capacitor',
    ] as const) {
      Reflect.deleteProperty(window, name);
    }
    delete document.documentElement.dataset.runtime;
    delete document.documentElement.dataset.platform;
    window.localStorage.clear();
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      writable: true,
      value: { getPlatform: () => 'android', isNativePlatform: () => true },
    });
    expect(installAndroidRuntimeBridge()).toBe(true);
    image = window.knouxImageStudioAPI;
    video = window.knouxVideoStudioAPI;
  });

  test('no provider, model or credential is advertised', async () => {
    await expect(image.listProviders()).resolves.toEqual([]);
    await expect(image.listModels()).resolves.toEqual([]);
    await expect(video.listProviders()).resolves.toEqual([]);
    await expect(video.listModels()).resolves.toEqual([]);
    await expect(video.aiHealth()).resolves.toMatchObject({ available: false, providers: [] });
    await expect(video.aiEntitlement()).resolves.toMatchObject({ entitled: false });
    const credential = (await image.setCredential('openai', 'sk-unit-test-key-must-not-be-stored')) as Loose;
    expect(credential.configured).toBe(false);
    expect(credential.healthy).toBe(false);
    expect(credential.storageMode).toBe('unavailable');
    expect(String(credential.reason)).toContain('No API key was saved');
    expect(await image.removeCredential('openai')).toBe(false);
    expect(await video.setCredential('openai', 'sk-unit-test-key-must-not-be-stored')).toBe(false);
  });

  test('the API key is not written to device storage', async () => {
    await image.setCredential('openai', 'sk-unit-test-key-must-not-be-stored');
    const dump = Object.keys(window.localStorage).map((key) => `${key}=${window.localStorage.getItem(key)}`).join('\n');
    expect(dump).not.toContain('sk-unit-test-key-must-not-be-stored');
  });

  test('credential validation reports the missing provider instead of pretending', async () => {
    expect(await image.validateCredential('openai', 'sk-any')).toMatchObject({
      valid: false,
      reason: 'No Android provider is configured.',
    });
  });

  test('job control refuses to invent a job', async () => {
    await expect(image.createJob({} as never)).rejects.toThrow(
      'No Android image provider is configured, so this job was not created.',
    );
    await expect(video.createJob({} as never)).rejects.toThrow(
      'No Android video provider is configured, so this job was not created.',
    );
    await expect(image.cancelJob('job-1')).resolves.toBe(false);
    await expect(image.removeJob('job-1')).resolves.toBe(false);
    await expect(image.listJobs()).resolves.toEqual([]);
    await expect(video.offlineJobs()).resolves.toEqual([]);
  });

  test('local model probes state that the model is not installed', async () => {
    const face = (await image.getVerifiedFaceModel()) as Loose;
    expect(face.status).toBe('unavailable');
    expect(String(face.reason)).toContain('No local face model is installed.');
  });

  test('settings only claim success when storage accepted them', async () => {
    await expect(video.aiSettingsSet({ temperature: 1 } as never)).resolves.toBe(true);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    await expect(video.aiSettingsSet({ temperature: 2 } as never)).resolves.toBe(false);
    await expect(video.gatewayConfigSet({ base: 'x' } as never)).resolves.toBe(false);
    jest.restoreAllMocks();
  });
});
