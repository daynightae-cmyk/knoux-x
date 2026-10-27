/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';

import { installAndroidRuntimeBridge } from '../../src/platform/androidRuntimeBridge';

const bridge = readFileSync('src/platform/androidSlideshowRenderBridge.ts', 'utf8');
const editor = readFileSync('src/features/slideshow/MobileSlideshowEditor.tsx', 'utf8');
const photosView = readFileSync('src/features/slideshow/MobilePhotosToVideoView.tsx', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');

describe('Android slideshow output is never presented as a file it is not', () => {
  test('the completed render publishes no synthetic path and no phantom file', () => {
    // The scheme may only survive in prose explaining why it was removed.
    expect(bridge).not.toMatch(/[=:]\s*['"`]knoux-android-render/);
    expect(bridge).toMatch(/snapshot\.status = 'completed';[\s\S]*?snapshot\.outputPath = null;[\s\S]*?snapshot\.outputExists = false;/);
    // The completion still states the in-memory truth; an encoder-substitution
    // warning is prepended when the device had to fall back to WebM.
    expect(bridge).toMatch(/const memoryWarning = "The rendered slideshow is held in this session's memory/);
    expect(bridge).toContain('snapshot.warning = encoding.warning ?');
    expect(bridge).toContain(': memoryWarning;');
  });

  test('saving a slideshow verifies the written file before claiming it', () => {
    const save = bridge.slice(bridge.indexOf('async function saveResult'));
    expect(save.slice(0, save.indexOf('\n}\n'))).toContain("window.knouxAPI.file.exists(destination)");
    expect(save).toContain('window.knouxAPI.file.getStats(destination)');
    expect(save).toContain('if (saved !== bytes.length)');
    expect(save).toContain('snapshot.outputPath = destination');
    expect(save).toContain("snapshot.outputExists = true");
    // A dismissed picker claims nothing.
    expect(save).toContain('if (!destination) return;');
  });

  test('the editor states the in-memory state and surfaces save failures', () => {
    expect(editor).toContain("t('Rendered in memory — not a file yet')");
    expect(editor).toContain("t('Saved on this device')");
    expect(editor).not.toMatch(/openOutput\?\.\(job\.id\)\.catch\(\(\) => undefined\)/);
    expect(editor).toContain("setError(reason instanceof Error ? reason.message : 'The slideshow copy could not be saved.');");
    expect(editor).toContain('readSlideshowBridgeFailure()');
    expect(main).toContain("install('slideshow-render', installAndroidSlideshowRenderBridge, recordSlideshowBridgeFailure)");
  });

  test('the photos-to-video screen is bilingual like the rest of the mobile app', () => {
    expect(photosView).toContain("state.locale) === 'ar'");
    expect(photosView).toContain("copy('Drafts', 'المسودات')");
    expect(photosView).toContain("className=\"kmc-round-button kx-back\"");
    expect(editor).toContain("state.locale) === 'ar'");
  });
});

describe('Android project storage refuses to claim a save it could not make', () => {
  const storage = window.localStorage;

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
  }

  beforeEach(() => {
    clearRuntime();
    storage.clear();
    if (typeof globalThis.structuredClone !== 'function') {
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        writable: true,
        value: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
      });
    }
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      writable: true,
      value: { getPlatform: () => 'android', isNativePlatform: () => true },
    });
    expect(installAndroidRuntimeBridge()).toBe(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearRuntime();
    storage.clear();
  });

  test('a slideshow save that the WebView refuses rejects instead of returning a path', async () => {
    const project = await window.knouxSlideshowAPI.create('Unit slideshow', 'minimal');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await expect(window.knouxSlideshowAPI.save(structuredClone(project), 'unit://slideshow')).rejects.toThrow(
      'The Android storage layer refused this slideshow project, so it is not saved on the device.',
    );
  });

  test('a write that is not read back verbatim is refused too', async () => {
    const project = await window.knouxMultitrackAPI.create('Unit project');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);

    await expect(window.knouxMultitrackAPI.save(structuredClone(project), 'unit://multitrack')).rejects.toThrow(
      'The Android storage layer refused this project, so it is not saved on the device.',
    );
  });

  test('a durable save still returns its path', async () => {
    const project = await window.knouxSlideshowAPI.create('Unit slideshow', 'minimal');
    await expect(window.knouxSlideshowAPI.save(structuredClone(project), 'unit://slideshow-ok'))
      .resolves.toBe('unit://slideshow-ok');
    await expect(window.knouxSlideshowAPI.openRecent('unit://slideshow-ok')).resolves.toMatchObject({
      filePath: 'unit://slideshow-ok',
    });
  });
});
