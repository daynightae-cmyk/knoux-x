/** @jest-environment jsdom */
import fs from 'node:fs';
import path from 'node:path';

type AudioEngineModule = typeof import('../../src/platform/audioEngineStatus');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');
}

/** The status registry is module state, so every case boots a fresh copy. */
async function freshModule(): Promise<AudioEngineModule> {
  jest.resetModules();
  return await import('../../src/platform/audioEngineStatus');
}

function setRuntime(edition: 'android' | 'desktop' | 'web-preview'): void {
  Object.defineProperty(window, 'knouxRuntime', {
    configurable: true,
    value: Object.freeze({ edition, product: 'Knoux X', bridgeVersion: 2 }),
  });
}

function setBridge(bridge: Record<string, unknown> | undefined): void {
  Object.defineProperty(window, 'knouxAudioToolsAPI', { configurable: true, value: bridge });
}

describe('Android audio engine availability (no placeholder presented as an engine)', () => {
  afterEach(() => {
    setBridge(undefined);
    Object.defineProperty(window, 'knouxAudioToolsAPI', { configurable: true, value: undefined });
    Object.defineProperty(window, 'knouxRuntime', { configurable: true, value: undefined });
  });

  test('the compatibility stub is branded and rejects instead of resolving null', async () => {
    const { buildUnavailableAudioBridge, AUDIO_ENGINE_UNAVAILABLE_MESSAGE } = await freshModule();
    const bridge = buildUnavailableAudioBridge();
    expect(bridge.engine).toBe('unavailable');
    await expect((bridge.analyze as () => Promise<unknown>)()).rejects.toThrow(AUDIO_ENGINE_UNAVAILABLE_MESSAGE);
    await expect((bridge.process as () => Promise<unknown>)()).rejects.toThrow(AUDIO_ENGINE_UNAVAILABLE_MESSAGE);
    await expect((bridge.jobs as () => Promise<unknown>)()).rejects.toThrow(AUDIO_ENGINE_UNAVAILABLE_MESSAGE);
    const unsubscribe = (bridge.onProgress as () => () => void)();
    expect(typeof unsubscribe).toBe('function');
  });

  test('an Android device holding only the stub reports the engine as unavailable', async () => {
    const audioEngine = await freshModule();
    setRuntime('android');
    setBridge(audioEngine.buildUnavailableAudioBridge());
    const status = audioEngine.readAudioEngineStatus();
    expect(status.available).toBe(false);
    expect(status.source).toBe('unavailable');
    expect(status.issue).toBe('fallback-bridge');
  });

  test('the branded local engine is reported as operational', async () => {
    const audioEngine = await freshModule();
    setRuntime('android');
    setBridge({
      engine: audioEngine.ANDROID_AUDIO_ENGINE_BRAND,
      analyze: async () => null,
      process: async () => null,
      cancel: async () => false,
      onProgress: () => () => undefined,
    });
    const status = audioEngine.readAudioEngineStatus();
    expect(status).toEqual({ available: true, source: 'android-local', issue: null, detail: null });
  });

  test('a missing bridge is distinguished from a bridge that threw, and the real message survives', async () => {
    const audioEngine = await freshModule();
    setRuntime('android');
    setBridge(undefined);
    expect(audioEngine.readAudioEngineStatus().issue).toBe('not-installed');

    audioEngine.recordAudioBridgeFailure('OfflineAudioContext is not a constructor');
    const status = audioEngine.readAudioEngineStatus();
    expect(status.available).toBe(false);
    expect(status.issue).toBe('install-failed');
    expect(status.detail).toBe('OfflineAudioContext is not a constructor');
  });

  test('a half-installed bridge without cancel or progress is not treated as ready', async () => {
    const audioEngine = await freshModule();
    setRuntime('android');
    setBridge({
      engine: audioEngine.ANDROID_AUDIO_ENGINE_BRAND,
      analyze: async () => null,
      process: async () => null,
    });
    const status = audioEngine.readAudioEngineStatus();
    expect(status.available).toBe(false);
    expect(status.issue).toBe('not-installed');
  });

  test('the desktop preload bridge is still reported as operational', async () => {
    const audioEngine = await freshModule();
    setRuntime('desktop');
    setBridge({
      analyze: async () => null,
      process: async () => null,
      cancel: async () => false,
      jobs: async () => [],
      onProgress: () => () => undefined,
    });
    const status = audioEngine.readAudioEngineStatus();
    expect(status.available).toBe(true);
    expect(status.source).toBe('electron-ffmpeg');
  });
});

describe('Audio surfaces consume the engine status', () => {
  test('no audio screen infers an engine from a method name alone', () => {
    for (const file of [
      'src/features/audio-tools/AudioToolsView.tsx',
      'src/features/audio-tools/AudioBatchWorkspace.tsx',
      'src/features/audio-tools/AudioMergeWorkspace.tsx',
    ]) {
      expect(read(file)).not.toMatch(/typeof window\.knouxAudioToolsAPI\?\.[a-zA-Z]+ === 'function'/);
    }
    expect(read('src/features/audio-tools/AudioToolsView.tsx')).toContain('readAudioEngineStatus()');
    expect(read('src/features/audio-tools/AudioBatchWorkspace.tsx')).toContain('<AudioEngineNotice />');
    expect(read('src/features/audio-tools/AudioToolsView.tsx')).toContain('<AudioEngineNotice />');
  });

  test('the Android runtime bridge no longer publishes null-resolving audio stubs', () => {
    const bridge = read('src/platform/androidRuntimeBridge.ts');
    expect(bridge).not.toMatch(/analyze: async \(\) => null/);
    expect(bridge).not.toMatch(/process: async \(\) => null/);
    expect(bridge).toContain('buildUnavailableAudioBridge()');
  });

  test('a throwing Android bridge cannot blank the app nor vanish silently', () => {
    const main = read('src/main.tsx');
    expect(main).toContain('KNOUX_ANDROID_BRIDGE_FAILED');
    expect(main).toContain("install('audio-tools', installAndroidAudioToolsBridge, recordAudioBridgeFailure)");
    expect(main).toContain('try {');
  });

  test('the local renderer refuses oversized renders before allocating them', () => {
    const audioBridge = read('src/platform/androidAudioToolsBridge.ts');
    expect(audioBridge).toContain('guardRenderBudget(length, normalized.channels, rate)');
    expect(audioBridge).toContain('guardRenderBudget(length, rawRequest.channels, rate)');
    expect(audioBridge).toMatch(/const MAX_RENDER_BYTES = 200 \* 1024 \* 1024;/);
  });
});
