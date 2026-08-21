import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DSPSystemManager } from '../../src/core/dsp/DSPSystemManager';
import { GeminiService } from '../../src/core/services/ai/GeminiService';
import { FileManager } from '../../src/core/services/file/FileManager';
import { LibraryManager } from '../../src/core/services/library/LibraryManager';
import { PlaylistManager } from '../../src/core/services/playlist/PlaylistManager';
import { VideoEngine } from '../../src/core/services/video/VideoEngine';

type RuntimeGlobal = 'document' | 'window' | 'AudioContext';

function removeRuntimeGlobal(name: RuntimeGlobal): PropertyDescriptor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value: undefined, writable: true });
  return descriptor;
}

function restoreRuntimeGlobal(name: RuntimeGlobal, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

describe('main-process runtime separation', () => {
  let storageRoot: string;
  let documentDescriptor: PropertyDescriptor | undefined;
  let windowDescriptor: PropertyDescriptor | undefined;
  let audioContextDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'knoux-main-runtime-'));
    documentDescriptor = removeRuntimeGlobal('document');
    windowDescriptor = removeRuntimeGlobal('window');
    audioContextDescriptor = removeRuntimeGlobal('AudioContext');
  });

  afterEach(async () => {
    restoreRuntimeGlobal('document', documentDescriptor);
    restoreRuntimeGlobal('window', windowDescriptor);
    restoreRuntimeGlobal('AudioContext', audioContextDescriptor);
    await rm(storageRoot, { recursive: true, force: true });
  });

  test('initializes real main-safe desktop services without browser globals', async () => {
    const dsp = new DSPSystemManager({ enabled: true, quality: 'high' });
    const file = new FileManager(join(storageRoot, 'files'));
    const library = new LibraryManager(join(storageRoot, 'library.json'));
    const playlist = new PlaylistManager(join(storageRoot, 'current-playlist.json'));
    const video = new VideoEngine();
    const ai = new GeminiService('');

    await expect(dsp.initialize()).resolves.toBeUndefined();
    await expect(file.initialize()).resolves.toBeUndefined();
    await expect(library.initialize()).resolves.toBeUndefined();
    await expect(playlist.initialize()).resolves.toBeUndefined();
    await expect(video.initialize()).resolves.toBeUndefined();
    await expect(ai.initialize()).resolves.toBeUndefined();

    expect(dsp.isEnabled()).toBe(true);
    expect(library.getMedia()).toEqual([]);
    expect(playlist.getItemCount()).toBe(0);

    await expect(ai.shutdown()).resolves.toBeUndefined();
    await expect(video.shutdown()).resolves.toBeUndefined();
    await expect(playlist.shutdown()).resolves.toBeUndefined();
    await expect(library.shutdown()).resolves.toBeUndefined();
    await expect(file.shutdown()).resolves.toBeUndefined();
    await expect(dsp.shutdown()).resolves.toBeUndefined();
  });
});
