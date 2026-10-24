/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MobileScreenRecordingView } from '../../src/features/recording/MobileScreenRecordingView';
import { prepareRecordingEditor } from '../../src/features/recording/recordingEditorHandoff';

jest.mock('../../src/platform/withDeadline', () => ({ withDeadline: (work: Promise<unknown>) => work }));
jest.mock('../../src/platform/androidBackButton', () => ({ registerAndroidBackInterceptor: () => () => undefined }));
jest.mock('../../src/platform/androidSafBridge', () => ({ androidDocumentTitle: async () => 'KNOUX clip.mp4' }));
jest.mock('../../src/features/recording/recordingEditorHandoff', () => ({ prepareRecordingEditor: jest.fn() }));
jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('../../src/platform/androidScreenCaptureStatus', () => {
  const box = { edition: 'android' as string | undefined, plugin: null as null | Record<string, unknown> };
  (globalThis as unknown as { __capture: typeof box }).__capture = box;
  const status = () => {
    if (box.edition !== 'android') return { available: false, source: 'non-android' as const };
    return box.plugin ? { available: true, source: 'plugin' as const } : { available: false, source: 'plugin-missing' as const };
  };
  return {
    readScreenCaptureStatus: status,
    describeScreenCapture: () => (status().source === 'non-android' ? null : (box.plugin as never)),
  };
});
jest.mock('../../src/store/appStore', () => {
  const box = { locale: 'en', setView: jest.fn() };
  (globalThis as unknown as { __app: typeof box }).__app = box;
  return { useAppStore: (select: (value: typeof box) => unknown) => select(box) };
});
jest.mock('../../src/store/playerStore', () => ({
  usePlayerStore: (select: (value: { setCurrentMedia: jest.Mock; setMediaTitle: jest.Mock }) => unknown) => select({
    setCurrentMedia: jest.fn(),
    setMediaTitle: jest.fn(),
  }),
}));

const clip = 'content://media/external/video/media/77';

let root: Root;
let host: HTMLDivElement;
const file = { exists: jest.fn(), getStats: jest.fn() };

type CaptureBox = { edition: string | undefined; plugin: null | Record<string, unknown> };

function captureBox(): CaptureBox {
  return (globalThis as unknown as { __capture: CaptureBox }).__capture;
}
function appBox(): { locale: string; setView: jest.Mock } {
  return (globalThis as unknown as { __app: { locale: string; setView: jest.Mock } }).__app;
}

type StatusResult = { recording?: boolean; outputUri?: string | null };

function plugin(over: Partial<{
  start: () => Promise<StatusResult>;
  stop: () => Promise<StatusResult>;
  status: () => Promise<StatusResult>;
}> = {}) {
  return {
    startScreenRecording: over.start ?? (async () => ({ recording: true })),
    stopScreenRecording: over.stop ?? (async () => ({ recording: false, outputUri: clip })),
    status: over.status ?? (async () => ({ recording: false, outputUri: null })),
  };
}

function buttonMatching(pattern: RegExp): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((entry) => pattern.test(entry.textContent ?? ''));
}

async function mount(): Promise<void> {
  await act(async () => { root.render(<MobileScreenRecordingView />); });
}

async function tap(pattern: RegExp): Promise<void> {
  const button = buttonMatching(pattern);
  if (!button) throw new Error(`No control matched ${pattern}.`);
  await act(async () => { button.click(); });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  /* The mocked module closes over its own box object, so the box is mutated
   * rather than replaced. */
  captureBox().edition = 'android';
  captureBox().plugin = plugin();
  appBox().locale = 'en';
  Object.defineProperty(window, 'knouxAPI', {
    configurable: true,
    value: { file },
  });
  file.exists.mockResolvedValue(true);
  file.getStats.mockResolvedValue({ size: 5_242_880 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Android screen recording never claims what the device did not do', () => {
  test('a missing capture plugin is an explicit blocker, not a dead Start button', async () => {
    captureBox().plugin = null;
    await mount();

    expect(host.querySelector('.knoux-mobile-recording')?.getAttribute('data-capture-availability')).toBe('plugin-missing');
    expect(host.querySelector('.kmr-unavailable')?.textContent).toContain('did not start in this build');
    const start = buttonMatching(/Start screen recording/);
    expect(start).toBeDefined();
    expect(start?.disabled).toBe(true);
  });

  test('a start Android does not confirm leaves the screen idle with no REC claim', async () => {
    captureBox().plugin = plugin({ start: async () => ({ recording: false }) });
    await mount();
    await tap(/Start screen recording/);

    expect(host.querySelector('.knoux-mobile-recording')?.getAttribute('data-capture-phase')).toBe('idle');
    expect(host.querySelector('.kmr-error')?.textContent).toContain('Android did not confirm that recording started');
    expect(host.querySelector('.kmr-topbar .live')).toBeNull();
    expect(host.querySelector('.kmr-status')?.textContent).toContain('Ready');
  });

  test('a confirmed start enters a visually distinct recording state', async () => {
    await mount();
    await tap(/Start screen recording/);

    expect(host.querySelector('.knoux-mobile-recording')?.getAttribute('data-capture-phase')).toBe('recording');
    expect(host.querySelector('.kmr-status')?.textContent).toContain('Recording');
    expect(buttonMatching(/Stop & save MP4/)).toBeDefined();
  });

  test('finalizing keeps the stop control and its own phase', async () => {
    let resolveStop: (value: { recording?: boolean; outputUri?: string | null }) => void = () => undefined;
    captureBox().plugin = plugin({ stop: () => new Promise((resolve) => { resolveStop = resolve; }) });
    await mount();
    await tap(/Start screen recording/);

    const stop = buttonMatching(/Stop & save MP4/);
    await act(async () => { stop?.click(); });
    expect(host.querySelector('.knoux-mobile-recording')?.getAttribute('data-capture-phase')).toBe('finalizing');
    expect(host.querySelector('.kmr-primary.kmr-stop.kmr-finalizing')).not.toBeNull();
    expect(host.querySelector('.kmr-status')?.textContent).toContain('Finalizing MP4');

    await act(async () => { resolveStop({ recording: false, outputUri: clip }); });
    expect(host.querySelector('.knoux-mobile-recording')?.getAttribute('data-capture-phase')).toBe('idle');
  });

  test('an empty output URI is reported as not saved', async () => {
    captureBox().plugin = plugin({ stop: async () => ({ recording: false, outputUri: '' }) });
    await mount();
    await tap(/Start screen recording/);
    await tap(/Stop & save MP4/);

    expect(host.querySelector('.kmr-error')?.textContent).toContain('Android returned no finalized recording');
    expect(host.textContent).not.toContain('Recording saved');
  });

  test('a saved recording is only announced after the file is read back with content', async () => {
    await mount();
    await tap(/Start screen recording/);
    await tap(/Stop & save MP4/);

    expect(file.exists).toHaveBeenCalledWith(clip);
    expect(file.getStats).toHaveBeenCalledWith(clip);
    expect(host.querySelector('.kmr-output')?.textContent).toContain('Recording saved');
    expect(host.querySelector('.kmr-output')?.textContent).toContain('5.0 MB');
  });

  test('a zero-byte file is refused instead of celebrated', async () => {
    file.getStats.mockResolvedValue({ size: 0 });
    await mount();
    await tap(/Start screen recording/);
    await tap(/Stop & save MP4/);

    expect(host.querySelector('.kmr-unverified')?.textContent).toContain('no readable file with content was found');
    expect(host.textContent).not.toContain('Recording saved');
    expect(host.textContent).not.toContain('Open in Video Editor');
  });

  test('a URI Android remembered from an earlier session is labelled as such', async () => {
    captureBox().plugin = plugin({ status: async () => ({ recording: false, outputUri: clip }) });
    await mount();

    expect(host.querySelector('.kmr-output')?.textContent).toContain('Recording already on this device');
    expect(host.querySelector('.kmr-output')?.textContent).toContain('from an earlier session');
    expect(buttonMatching(/Recording saved/)).toBeUndefined();
  });

  test('a leftover URI that no longer resolves is not offered for playback', async () => {
    file.exists.mockResolvedValue(false);
    captureBox().plugin = plugin({ status: async () => ({ recording: false, outputUri: clip }) });
    await mount();

    expect(host.querySelector('.kmr-unverified')?.textContent).toContain('Nothing was saved');
    expect(buttonMatching(/Open in Video Editor/)).toBeUndefined();
  });

  test('the editor hand-off only runs against a verified recording', async () => {
    await mount();
    await tap(/Start screen recording/);
    await tap(/Stop & save MP4/);
    await tap(/Open in Video Editor/);

    expect(prepareRecordingEditor).toHaveBeenCalledWith(clip);
    expect(appBox().setView).toHaveBeenCalledWith('editor');
  });

  test('the Arabic build translates the unconfirmed-start alert', async () => {
    appBox().locale = 'ar';
    captureBox().plugin = plugin({ start: async () => ({ recording: false }) });
    await mount();
    await tap(/ابدأ تسجيل الشاشة/);

    expect(host.querySelector('.kmr-error')?.textContent).toContain('لم يؤكد أندرويد بدء التسجيل');
  });
});
