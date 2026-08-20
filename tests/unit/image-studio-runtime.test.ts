import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { IpcMainInvokeEvent } from 'electron';

import type { DeferredAiJob } from '../../src/core/image-studio/ai/offline';
import { IPC_INVOKE, IPC_OUTBOUND } from '../../electron/ipc/contract';
import type { IpcRegistrar } from '../../electron/ipc/registry';
import { setupImageStudioRuntime, type ImageStudioRuntimeController } from '../../electron/ipc/image-studio-runtime';

let mockUserData = '';
let safeStorageAvailable = true;
const mockStores = new Map<string, Record<string, unknown>>();

jest.mock('electron', () => {
  const window = {
    isDestroyed: () => false,
    webContents: { id: 1 },
  };
  return {
    app: {
      getPath: (name: string) => (name === 'userData' ? mockUserData : os.tmpdir()),
      getVersion: () => '2.0.0-test',
    },
    safeStorage: {
      isEncryptionAvailable: () => safeStorageAvailable,
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      decryptString: (buffer: Buffer) => buffer.toString('utf8'),
    },
    BrowserWindow: {
      fromWebContents: () => window,
      getAllWindows: () => [window],
    },
    net: { isOnline: () => true },
  };
});

jest.mock('electron-store', () => ({
  __esModule: true,
  default: class MockStore<T extends Record<string, unknown>> {
    private readonly values: T;
    constructor(options: { name: string; defaults: T }) {
      if (!mockStores.has(options.name)) mockStores.set(options.name, structuredClone(options.defaults));
      this.values = mockStores.get(options.name) as T;
    }
    get<K extends keyof T>(key: K): T[K] { return this.values[key]; }
    set<K extends keyof T>(key: K, value: T[K]): void { this.values[key] = value; }
  },
}));

jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));

const IMAGE_STUDIO_INVOKE_CHANNELS = Object.values(IPC_INVOKE).filter((channel) =>
  channel.startsWith('image-studio:')
);

const IMAGE_STUDIO_OUTBOUND_CHANNELS = Object.values(IPC_OUTBOUND).filter((channel) =>
  channel.startsWith('image-studio:')
);

function trustedEvent(url = 'file:///index.html'): IpcMainInvokeEvent {
  return {
    sender: { id: 7 },
    senderFrame: { url },
  } as unknown as IpcMainInvokeEvent;
}

function mockJob(): Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> {
  return {
    task: 'text-to-image',
    provider: 'mock',
    modelId: 'knoux-mock-image',
    prompt: 'a calm ocean at sunset',
    negativePrompt: null,
    seed: 42,
    width: 64,
    height: 64,
    maskAssetId: null,
    sourceAssetId: null,
  };
}

describe('image-studio runtime', () => {
  let registrar: IpcRegistrar;
  let handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
  let sendSpy: jest.Mock;
  let controller: ImageStudioRuntimeController;

  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-image-studio-runtime-'));
    safeStorageAvailable = true;
    mockStores.clear();
    handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    sendSpy = jest.fn();
    registrar = {
      handle: (channel, listener) => {
        handlers.set(channel, listener as never);
      },
      on: jest.fn() as never,
      removeListener: jest.fn() as never,
      send: sendSpy,
    };
    controller = setupImageStudioRuntime(registrar);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  afterEach(async () => {
    controller.close();
    await fs.rm(mockUserData, { recursive: true, force: true });
  });

  async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No Image Studio handler registered for ${channel}.`);
    return handler(trustedEvent(), ...args);
  }

  async function createDocument(): Promise<Record<string, unknown>> {
    return (await invoke(IPC_INVOKE.IMAGE_STUDIO_CREATE, {
      title: 'Test Canvas',
      width: 320,
      height: 240,
      backgroundMode: 'solid',
      backgroundColor: '#ffffff',
    })) as Record<string, unknown>;
  }

  test('registers every Image Studio invoke and outbound channel', () => {
    expect(IMAGE_STUDIO_INVOKE_CHANNELS).toHaveLength(57);
    expect(IMAGE_STUDIO_OUTBOUND_CHANNELS).toHaveLength(5);
    for (const channel of IMAGE_STUDIO_INVOKE_CHANNELS) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  test('rejects untrusted renderers before touching the service', async () => {
    const handler = handlers.get(IPC_INVOKE.IMAGE_STUDIO_CREATE)!;
    await expect(handler({ sender: { id: 9 }, senderFrame: { url: 'https://evil.example.com' } }, {})).rejects.toThrow(
      /untrusted renderer/i
    );
  });

  test('creates, returns, saves and tracks a recent document', async () => {
    const document = await createDocument();
    expect(document.documentId).toBeTruthy();
    expect(document.schema).toBe('knoux-image-studio');

    const current = (await invoke(IPC_INVOKE.IMAGE_STUDIO_GET_CURRENT)) as Record<string, unknown> | null;
    expect(current?.documentId).toBe(document.documentId);

    const target = path.join(mockUserData, 'canvas.knouximage');
    const saved = (await invoke(IPC_INVOKE.IMAGE_STUDIO_SAVE, target)) as string | null;
    expect(saved).toBe(target);
    const recent = (await invoke(IPC_INVOKE.IMAGE_STUDIO_RECENT)) as string[];
    expect(recent).toContain(target);
  });

  test('validates a relative open path through the service', async () => {
    await expect(invoke(IPC_INVOKE.IMAGE_STUDIO_OPEN, 'relative/file.knouximage')).rejects.toThrow(
      /must be an absolute path/i
    );
  });

  test('layer operations mutate the current document', async () => {
    await createDocument();
    const layer = {
      id: 'layer-1',
      kind: 'raster',
      name: 'Background',
      assetId: 'asset-1',
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      locked: false,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      parentId: null,
      mask: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const document = (await invoke(IPC_INVOKE.IMAGE_STUDIO_CREATE_LAYER, layer)) as Record<string, unknown>;
    expect(document.layers).toHaveLength(1);
    expect(await invoke(IPC_INVOKE.IMAGE_STUDIO_RENAME_LAYER, 'layer-1', 'Renamed')).toBe(true);
    expect(await invoke(IPC_INVOKE.IMAGE_STUDIO_SET_OPACITY, 'layer-1', 0.5)).toBe(true);
    expect(await invoke(IPC_INVOKE.IMAGE_STUDIO_DELETE_LAYER, 'layer-1')).toBe(true);
    const afterDelete = (await invoke(IPC_INVOKE.IMAGE_STUDIO_GET_CURRENT)) as Record<string, unknown>;
    expect(afterDelete.layers).toHaveLength(0);
  });

  test('persists credentials through safeStorage and reports encrypted mode', async () => {
    const key = 'sk-or-v1-testkey1234567890';
    const validation = (await invoke(IPC_INVOKE.IMAGE_STUDIO_VALIDATE_CREDENTIAL, 'openrouter', key)) as {
      ok: boolean;
    };
    expect(validation.ok).toBe(true);

    const status = (await invoke(IPC_INVOKE.IMAGE_STUDIO_SET_CREDENTIAL, 'openrouter', key)) as Record<string, unknown>;
    expect(status.configured).toBe(true);
    expect(status.storageMode).toBe('encrypted-at-rest');

    const all = (await invoke(IPC_INVOKE.IMAGE_STUDIO_PROVIDER_STATUS)) as Record<string, unknown>;
    expect(all.openrouter.storageMode).toBe('encrypted-at-rest');
    expect(all.openrouter.keyMasked).not.toContain(key.slice(10));

    expect(await invoke(IPC_INVOKE.IMAGE_STUDIO_REMOVE_CREDENTIAL, 'openrouter')).toBe(true);
    const afterRemove = (await invoke(IPC_INVOKE.IMAGE_STUDIO_PROVIDER_STATUS)) as Record<string, unknown>;
    expect(afterRemove.openrouter.configured).toBe(false);
  });

  test('falls back to a session-only vault without writing key material to disk', async () => {
    safeStorageAvailable = false;
    mockStores.clear();
    controller.close();
    controller = setupImageStudioRuntime(registrar);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const key = 'sk-or-v1-testkey1234567890';
    const status = (await invoke(IPC_INVOKE.IMAGE_STUDIO_SET_CREDENTIAL, 'openrouter', key)) as Record<string, unknown>;
    expect(status.configured).toBe(true);
    expect(status.storageMode).toBe('session-only');
    const persisted = mockStores.get('image-studio-secrets')?.secrets ?? {};
    expect(Object.keys(persisted)).toHaveLength(0);
  });

  test('runs a mock AI job to completion and imports the result as a layer', async () => {
    await createDocument();
    const jobId = (await invoke(IPC_INVOKE.IMAGE_STUDIO_CREATE_JOB, mockJob())) as string;
    expect(jobId).toBeTruthy();

    const snapshot = (await invoke(IPC_INVOKE.IMAGE_STUDIO_GET_JOB, jobId)) as Record<string, unknown>;
    expect(snapshot.status).toBe('completed');

    const document = (await invoke(IPC_INVOKE.IMAGE_STUDIO_IMPORT_RESULT, jobId, true)) as Record<string, unknown>;
    expect(document.layers.some((entry: Record<string, unknown>) => entry.jobId === jobId)).toBe(true);
    expect(
      document.aiProvenance.some(
        (entry: Record<string, unknown>) => entry.jobId === jobId && entry.accepted === true
      )
    ).toBe(true);

    const channels = sendSpy.mock.calls.map((call) => call[1]);
    expect(channels).toContain(IPC_OUTBOUND.IMAGE_STUDIO_JOB_PROGRESS);
    expect(channels).toContain(IPC_OUTBOUND.IMAGE_STUDIO_JOB_COMPLETE);
  });

  test('triggers an autosave and broadcasts the autosave event', async () => {
    const document = await createDocument();
    const autosavePath = path.join(mockUserData, 'project.knouximage');
    const written = (await invoke(IPC_INVOKE.IMAGE_STUDIO_TRIGGER_AUTOSAVE, autosavePath)) as string;
    expect(written).toBeTruthy();
    expect(sendSpy.mock.calls.some((call) => call[1] === IPC_OUTBOUND.IMAGE_STUDIO_AUTOSAVE)).toBe(true);

    const sessions = (await invoke(IPC_INVOKE.IMAGE_STUDIO_RECOVERY_SESSIONS, autosavePath)) as Array<{
      documentId: string;
    }>;
    expect(sessions.some((entry) => entry.documentId === document.documentId)).toBe(true);
  });

  test('closing the controller clears the current document', async () => {
    await createDocument();
    controller.close();
    const current = await invoke(IPC_INVOKE.IMAGE_STUDIO_GET_CURRENT);
    expect(current).toBeNull();
  });
});
