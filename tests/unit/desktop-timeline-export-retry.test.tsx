/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { renderMultitrackProject } from '../../src/features/export/mobileTimelineRenderer';
import { MAX_RENDER_ATTEMPTS } from '../../src/features/video-studio/exportAttemptPolicy';
import { DesktopVideoStudioView } from '../../src/features/video-studio/DesktopVideoStudioView';

jest.mock('../../src/features/export/mobileTimelineRenderer', () => ({ renderMultitrackProject: jest.fn() }));
jest.mock('../../src/features/video-studio/VideoStudioView', () => ({ VideoStudioView: () => null }));
jest.mock('../../src/store/appStore', () => {
  const state = { locale: 'en', setView: jest.fn() };
  return { useAppStore: (select: (value: typeof state) => unknown) => select(state) };
});

const DESTINATION = 'C:\\out\\film-timeline.webm';
const TIMELINE_DURATION = 4;

function fakeBlob(size: number): Blob {
  const bytes = new Uint8Array(size).fill(7);
  return {
    size,
    type: 'video/webm;codecs=vp8,opus',
    slice: (start?: number, end?: number) => fakeBlob(bytes.slice(start ?? 0, end ?? size).byteLength),
    arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as Blob;
}

function renderResult(): { blob: Blob; mimeType: string; duration: number } {
  return { blob: fakeBlob(4096), mimeType: 'video/webm;codecs=vp8,opus', duration: TIMELINE_DURATION };
}

/** A video track that stops short of the authored timeline length. */
function truncatedProbe(): Record<string, unknown> {
  return { streams: [{ codec_type: 'video', codec_name: 'vp8' }], format: { duration: '1.20' }, contentDurationSeconds: 1.2 };
}

function completeProbe(): Record<string, unknown> {
  return {
    streams: [{ codec_type: 'video', codec_name: 'vp8' }, { codec_type: 'audio', codec_name: 'opus' }],
    format: { duration: '4.00' },
    contentDurationSeconds: TIMELINE_DURATION,
  };
}

const file = {
  saveFile: jest.fn(),
  exists: jest.fn(),
  writeFile: jest.fn(),
  appendFile: jest.fn(),
  deleteFile: jest.fn(),
};
const creative = { export: { probe: jest.fn() } };
const multitrack = { open: jest.fn(), openRecent: jest.fn() };

let root: Root;
let host: HTMLDivElement;

function buttonLabeled(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((entry) => new RegExp(label, 'i').test(entry.textContent ?? ''));
}

/** Drives the real control the same way a user does, inside one act scope. */
async function exportSavedProject(steps: () => Promise<void> | void = async () => undefined, drainMs = 3000): Promise<void> {
  const button = buttonLabeled('Export Saved Project');
  if (!button) throw new Error(`The saved-project export control never appeared. DOM=${host.innerHTML.slice(0, 400)}`);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await steps();
    await new Promise((resolve) => setTimeout(resolve, drainMs));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    // jsdom does not expose structuredClone; the Electron renderer always does.
    structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown,
  });
  Object.defineProperty(window, 'knouxAPI', { configurable: true, value: { file } });
  Object.defineProperty(window, 'knouxCreativeAPI', { configurable: true, value: creative });
  Object.defineProperty(window, 'knouxMultitrackAPI', { configurable: true, value: multitrack });
  (renderMultitrackProject as jest.Mock).mockResolvedValue(renderResult());
  (file.saveFile as jest.Mock).mockResolvedValue(DESTINATION);
  (file.exists as jest.Mock).mockResolvedValue(false);
  (file.writeFile as jest.Mock).mockResolvedValue(undefined);
  (file.appendFile as jest.Mock).mockResolvedValue(undefined);
  (file.deleteFile as jest.Mock).mockResolvedValue(undefined);
  (multitrack.open as jest.Mock).mockResolvedValue({
    project: { name: 'film', settings: { width: 1280, height: 720, fps: 30 }, tracks: [] },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(<DesktopVideoStudioView />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Windows timeline export survives an encoder that stops early', () => {
  jest.setTimeout(30_000);

  test('an export that renders in one attempt claims no retries', async () => {
    (creative.export.probe as jest.Mock).mockResolvedValue(completeProbe());

    await exportSavedProject();

    expect((renderMultitrackProject as jest.Mock).mock.calls.length).toBe(1);
    expect(host.textContent).toContain('Export verified');
    expect(host.textContent).not.toContain('automatic attempts');
    expect(host.textContent).not.toContain('Attempt 1 of 3');
  });

  test('rejects the truncated file, retries, and only reports success for a covered render', async () => {
    (creative.export.probe as jest.Mock)
      .mockResolvedValueOnce(truncatedProbe())
      .mockResolvedValueOnce(completeProbe());

    await exportSavedProject();

    expect((renderMultitrackProject as jest.Mock).mock.calls.length).toBe(2);
    expect(file.deleteFile).toHaveBeenCalledWith(DESTINATION);
    expect(host.textContent).toContain('Export verified');
    // The recovered export says how many tries it took, so a slow export is
    // explainable instead of looking like a silent success.
    expect(host.textContent).toContain('· after 2 automatic attempts');
    expect(host.textContent).not.toContain('ended before the timeline');
    // The retry re-encodes the identical timeline at the same settings; nothing is
    // downgraded to make the second attempt look successful.
    const first = (renderMultitrackProject as jest.Mock).mock.calls[0][1];
    const second = (renderMultitrackProject as jest.Mock).mock.calls[1][1];
    expect(second.videoBitsPerSecond).toBe(first.videoBitsPerSecond);
    expect(second.width).toBe(first.width);
    expect(second.height).toBe(first.height);
    expect(second.fps).toBe(first.fps);
    expect(second.preferredMimeTypes).toBe(first.preferredMimeTypes);
  });

  test('reports which automatic attempt ran and that no partial file was accepted', async () => {
    (creative.export.probe as jest.Mock).mockResolvedValue(truncatedProbe());

    await exportSavedProject();

    expect(host.textContent).toContain(`Attempt ${MAX_RENDER_ATTEMPTS} of ${MAX_RENDER_ATTEMPTS}`);
    expect(host.textContent).toContain('no partial file was accepted');
    expect(host.textContent).toContain('ended before the timeline');
  });

  test('stops after the bounded attempts instead of looping forever on a broken encoder', async () => {
    (creative.export.probe as jest.Mock).mockResolvedValue(truncatedProbe());

    await exportSavedProject();

    expect((renderMultitrackProject as jest.Mock).mock.calls.length).toBe(MAX_RENDER_ATTEMPTS);
    expect(file.deleteFile.mock.calls.length).toBe(MAX_RENDER_ATTEMPTS);
    expect(host.textContent).toContain(`after ${MAX_RENDER_ATTEMPTS} automatic attempts`);
    expect(host.textContent).not.toContain('Export verified');
    // Every write creates the destination exclusively; a half-file is never
    // silently replaced or overwritten.
    for (const call of file.writeFile.mock.calls) expect(call[2]).toEqual({ exclusive: true });
  });

  test('moves to a fresh path when the rejected partial file cannot be deleted', async () => {
    // Attempt 1 writes DESTINATION, is rejected, and Windows keeps the file open.
    (file.exists as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    (creative.export.probe as jest.Mock)
      .mockResolvedValueOnce(truncatedProbe())
      .mockResolvedValueOnce(completeProbe());

    await exportSavedProject();

    expect(file.writeFile.mock.calls.map((call) => call[0])).toEqual([
      DESTINATION,
      'C:\\out\\film-timeline (2).webm',
    ]);
    expect(host.textContent).toContain('Export verified');
    expect(host.textContent).toContain('film-timeline (2).webm');
  });

  test('retries an encoder that produced no bytes at all, as observed under machine load', async () => {
    // Reproduced on the packaged EXE with other processes competing for CPU:
    // the realtime pipeline emitted nothing, so the renderer refused the blob.
    (renderMultitrackProject as jest.Mock)
      .mockRejectedValueOnce(new Error('The project encoder produced an empty file.'))
      .mockResolvedValue(renderResult());
    (creative.export.probe as jest.Mock).mockResolvedValue(completeProbe());

    await exportSavedProject();

    expect((renderMultitrackProject as jest.Mock).mock.calls.length).toBe(2);
    // Nothing was written for the failed attempt, so nothing had to be cleaned up.
    expect(file.writeFile).toHaveBeenCalledTimes(1);
    expect(file.deleteFile).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Export verified');
    expect(host.textContent).not.toContain('produced an empty file');
  });

  test('gives up with the encoder error instead of looping when every attempt stalls', async () => {
    (renderMultitrackProject as jest.Mock)
      .mockRejectedValue(new Error('The project encoder produced an empty file.'));

    await exportSavedProject();

    expect((renderMultitrackProject as jest.Mock).mock.calls.length).toBe(MAX_RENDER_ATTEMPTS);
    expect(file.saveFile).not.toHaveBeenCalled();
    expect(host.textContent).toContain('produced an empty file');
    expect(host.textContent).not.toContain('Export verified');
  });

  test('a cancelled render is never retried', async () => {
    let releaseRender: ((value: ReturnType<typeof renderResult>) => void) | undefined;
    (renderMultitrackProject as jest.Mock)
      .mockImplementation(() => new Promise((resolve) => { releaseRender = resolve; }));

    // Scope 1: press export and let React commit the rendering UI. The render
    // itself stays parked, so the only way forward is the cancel control.
    const start = buttonLabeled('Export Saved Project');
    if (!start) throw new Error('The saved-project export control never appeared.');
    await act(async () => {
      start.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    const cancel = buttonLabeled('Cancel render');
    expect(cancel ?? `DOM=${host.innerHTML.slice(0, 400)}`).toBeDefined();

    // Scope 2: cancel, then let the parked encoder settle as a real renderer would.
    await act(async () => {
      cancel?.click();
      releaseRender?.(renderResult());
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect((renderMultitrackProject as jest.Mock).mock.calls.length).toBe(1);
    expect(file.saveFile).not.toHaveBeenCalled();
    expect(creative.export.probe).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('ended before the timeline');
    expect(host.textContent).not.toContain('Export verified');
  });
});
