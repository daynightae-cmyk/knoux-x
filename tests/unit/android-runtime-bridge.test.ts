/** @jest-environment jsdom */

import { installAndroidRuntimeBridge } from '../../src/platform/androidRuntimeBridge';

function ensureStructuredClone(): void {
  if (typeof globalThis.structuredClone === 'function') return;
  Object.defineProperty(globalThis, 'structuredClone', {
    configurable: true,
    writable: true,
    value: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
  });
}

function clearRuntime(): void {
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
}

describe('Android runtime bridge', () => {
  beforeEach(() => {
    ensureStructuredClone();
    clearRuntime();
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      writable: true,
      value: {
        getPlatform: () => 'android',
        isNativePlatform: () => true,
      },
    });
  });

  afterEach(() => clearRuntime());

  test('boots Android as its own runtime and installs every route-critical namespace', () => {
    expect(installAndroidRuntimeBridge()).toBe(true);
    expect(window.knouxRuntime?.edition).toBe('android');
    expect(document.documentElement.dataset.runtime).toBe('android');
    expect(document.documentElement.dataset.platform).toBe('android');

    expect(window.knouxAPI).toBeDefined();
    expect(window.knouxCreativeAPI).toBeDefined();
    expect(window.knouxRecordingAPI).toBeDefined();
    expect(window.knouxMultitrackAPI).toBeDefined();
    expect(window.knouxSlideshowAPI).toBeDefined();
    expect(window.knouxAudioToolsAPI).toBeDefined();
    expect(window.knouxImageStudioAPI).toBeDefined();
    expect(window.knouxVideoStudioAPI).toBeDefined();
  });

  test('persists Android settings and creates functional studio projects', async () => {
    installAndroidRuntimeBridge();

    await window.knouxAPI.settings.set('android-test', { enabled: true });
    await expect(window.knouxAPI.settings.get('android-test', { enabled: false }))
      .resolves.toEqual({ enabled: true });

    const multitrack = await window.knouxMultitrackAPI.create('Android project');
    expect(multitrack.name).toBe('Android project');
    expect(multitrack.tracks.length).toBeGreaterThan(0);
    const multitrackPath = await window.knouxMultitrackAPI.save(multitrack);
    expect(multitrackPath).toContain('knoux-android://multitrack/');
    await expect(window.knouxMultitrackAPI.openRecent(multitrackPath)).resolves.toMatchObject({
      project: { id: multitrack.id },
      filePath: multitrackPath,
    });

    const image = await window.knouxImageStudioAPI.create({ title: 'Android image', width: 640, height: 360 });
    expect(image.title).toBe('Android image');
    expect(image.canvas.width).toBe(640);
    expect(image.canvas.height).toBe(360);
    await expect(window.knouxImageStudioAPI.getCurrent()).resolves.toMatchObject({ documentId: image.documentId });
  });

  test('does not claim Android when Capacitor reports another platform', () => {
    clearRuntime();
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      writable: true,
      value: {
        getPlatform: () => 'web',
        isNativePlatform: () => false,
      },
    });
    expect(installAndroidRuntimeBridge()).toBe(false);
    expect(window.knouxRuntime).toBeUndefined();
  });
});
