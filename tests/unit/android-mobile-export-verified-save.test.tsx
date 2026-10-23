/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MobileExportView } from '../../src/features/export/MobileExportView';
import { renderMultitrackProject } from '../../src/features/export/mobileTimelineRenderer';

jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('../../src/platform/androidMultitrackExportBridge', () => ({
  readActiveAndroidMultitrackProject: () => ({
    id: 'project-1',
    name: 'Story',
    settings: { width: 1920, height: 1080 },
    tracks: [],
  }),
}));
jest.mock('../../src/core/creative/multitrackProject', () => ({ projectDuration: () => 2 }));
jest.mock('../../src/features/export/mobileTimelineRenderer', () => ({ renderMultitrackProject: jest.fn() }));
jest.mock('../../src/store/appStore', () => {
  const state = {
    locale: 'en',
    setView: jest.fn(),
    notifications: [] as { type: string; title: string; message: string }[],
    addNotification: jest.fn((notification: { type: string; title: string; message: string }) => {
      state.notifications.push(notification);
    }),
  };
  (globalThis as unknown as { __exportState: typeof state }).__exportState = state;
  return { useAppStore: (select: (value: typeof state) => unknown) => select(state) };
});
jest.mock('../../src/store/playerStore', () => ({
  usePlayerStore: (select: (value: { currentMedia: string | null }) => unknown) => select({ currentMedia: null }),
}));

const EXPORT_BYTES = new Uint8Array(2048).fill(7);
const FILE_NAME = 'Story-1080p-30fps.mp4';

let root: Root;
let host: HTMLDivElement;
const file = {
  saveFile: jest.fn(),
  writeFile: jest.fn(),
  exists: jest.fn(),
  getStats: jest.fn(),
};

type ExportStoreState = {
  locale: string;
  notifications: { type: string; title: string; message: string }[];
};

function state(): ExportStoreState {
  return (globalThis as unknown as { __exportState: ExportStoreState }).__exportState;
}

async function exportToResult(): Promise<void> {
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.kme-export-primary')?.click();
  });
}

function clickSave(): Promise<void> {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('.kme-result button'))
    .find((entry) => /save|حفظ/i.test(entry.textContent ?? ''));
  if (!button) throw new Error('The "Save to Device" control never appeared.');
  return act(async () => {
    button.click();
  });
}

/* jsdom's Blob has no arrayBuffer(); the Android WebView does. Supply a
 * microtask-based read for the blobs this suite creates so the exporter sees
 * the exact bytes it was handed and every await settles inside act(). */
const blobBytes = new WeakMap<Blob, Uint8Array>();

function bytesBlob(bytes: Uint8Array): Blob {
  const blob = new Blob([bytes], { type: 'video/mp4' });
  blobBytes.set(blob, bytes);
  return blob;
}

function installBlobArrayBuffer(): void {
  if (typeof Blob.prototype.arrayBuffer === 'function') return;
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: async function read(this: Blob): Promise<ArrayBuffer> {
      const known = blobBytes.get(this);
      if (!known) throw new Error('jsdom Blob has no arrayBuffer(); register the bytes first.');
      return known.slice().buffer;
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  state().notifications.length = 0;
  state().locale = 'en';
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  installBlobArrayBuffer();
  Object.defineProperty(window, 'knouxRuntime', { configurable: true, value: { edition: 'android' } });
  Object.defineProperty(window, 'knouxAPI', { configurable: true, value: { file } });
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, writable: true, value: jest.fn(() => 'blob:knoux-export') });
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, writable: true, value: jest.fn() });
  class FakeRecorder {
    static isTypeSupported(candidate: string): boolean { return candidate.startsWith('video/mp4'); }
  }
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder });
  (renderMultitrackProject as jest.Mock).mockResolvedValue({
    blob: bytesBlob(EXPORT_BYTES),
    mimeType: 'video/mp4',
  });
  file.saveFile.mockResolvedValue('content://media/external/video/media/99');
  file.writeFile.mockResolvedValue(undefined);
  file.exists.mockResolvedValue(true);
  file.getStats.mockResolvedValue({ size: EXPORT_BYTES.length });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Android mobile video export save is verified before it claims success', () => {
  test('a confirmed, correctly sized write reports the exported size', async () => {
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(file.writeFile).toHaveBeenCalledTimes(1);
    expect(state().notifications).toHaveLength(1);
    expect(state().notifications[0]).toMatchObject({ type: 'success', title: 'Saved' });
    expect(state().notifications[0].message).toContain(FILE_NAME);
    expect(state().notifications[0].message).toContain('2.0 KB');
    expect(host.querySelector('.kme-error')).toBeNull();
  });

  test('a temporary (non content URI) destination is labelled as unverified storage', async () => {
    file.saveFile.mockResolvedValue('/data/user/0/com.knoux.x/cache/Story.mp4');
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications[0].message).toContain('temporary path — verify the file');
  });

  test('a write the device cannot see back reports failure instead of success', async () => {
    file.exists.mockResolvedValue(false);
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications).toHaveLength(0);
    const message = host.querySelector('.kme-error')?.textContent ?? '';
    expect(message).toContain('The device did not confirm the file after writing. Nothing was saved.');
  });

  test('a missing exists() implementation is treated as an unconfirmed save', async () => {
    file.exists.mockRejectedValue(new Error('not supported'));
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications).toHaveLength(0);
    expect(host.querySelector('.kme-error')?.textContent).toContain('did not confirm the file');
  });

  test('a truncated MediaStore write surfaces both sizes', async () => {
    file.getStats.mockResolvedValue({ size: 900 });
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications).toHaveLength(0);
    const message = host.querySelector('.kme-error')?.textContent ?? '';
    expect(message).toContain('900 B');
    expect(message).toContain('2.0 KB');
  });

  test('a device that cannot report stats still keeps a confirmed file as saved', async () => {
    file.getStats.mockResolvedValue(null);
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications).toHaveLength(1);
    expect(state().notifications[0].type).toBe('success');
    /* The file is confirmed, the size is not — the notice must not present the
     * exported byte count as if the device had read it back. */
    expect(state().notifications[0].message).toContain('size not confirmed by the device');
  });

  test('a getStats that throws is labelled as an unverified size, never a confirmed one', async () => {
    file.getStats.mockRejectedValue(new Error('stat failed'));
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications).toHaveLength(1);
    expect(state().notifications[0].message).toContain('size not confirmed by the device');
    expect(host.querySelector('.kme-error')).toBeNull();
  });

  test('a correctly sized read-back is announced as device-confirmed', async () => {
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications[0].message).toContain('size confirmed by the device');
  });

  test('a zero-byte file the device does report is refused, not celebrated', async () => {
    file.getStats.mockResolvedValue({ size: 0 });
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications).toHaveLength(0);
    expect(host.querySelector('.kme-error')?.textContent).toContain('The device reports a 0-byte file after writing. Nothing was saved.');
  });

  test('the Arabic build refuses a zero-byte saved export in Arabic', async () => {
    state().locale = 'ar';
    file.getStats.mockResolvedValue({ size: 0 });
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(state().notifications).toHaveLength(0);
    expect(host.querySelector('.kme-error')?.textContent).toContain('أفاد الجهاز بملف بحجم 0 بايت بعد الكتابة');
  });

  test('the Arabic build keeps the unconfirmed-save alert in Arabic', async () => {
    state().locale = 'ar';
    file.exists.mockResolvedValue(false);
    await act(async () => { root.render(<MobileExportView />); });
    await exportToResult();
    await clickSave();

    expect(host.querySelector('.kme-error')?.textContent).toContain('لم يؤكد الجهاز وجود الملف بعد الكتابة');
    expect(state().notifications).toHaveLength(0);
  });
});
