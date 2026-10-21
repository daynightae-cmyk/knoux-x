/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MobileMediaLibraryView } from '../../src/features/library/MobileMediaLibraryView';
import { androidMediaStore } from '../../src/platform/androidMediaStore';

jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('../../src/features/library/MediaStoreThumbnail', () => ({ MediaStoreThumbnail: () => null }));
jest.mock('../../src/store/appStore', () => ({ useAppStore: (select: (value: unknown) => unknown) => select({ locale: 'en', setView: jest.fn(), addNotification: jest.fn() }) }));
jest.mock('../../src/store/playerStore', () => ({ usePlayerStore: (select: (value: unknown) => unknown) => select({ setCurrentMedia: jest.fn(), setMediaTitle: jest.fn() }) }));
jest.mock('../../src/store/imageEditorStore', () => ({ useImageEditorStore: (select: (value: unknown) => unknown) => select({ setSource: jest.fn() }) }));
jest.mock('../../src/features/player/mobilePlayerSession', () => ({ readRecentMedia: () => [] }));
jest.mock('../../src/platform/androidMediaStore', () => ({ androidMediaStore: jest.fn(), mediaRequestId: () => 'unit-request' }));
jest.mock('../../src/components/neon/NeonSelect', () => ({
  NeonSelect: ({ value, onChange, options, 'aria-label': ariaLabel }: {
    value: string;
    onChange: (next: string) => void;
    options: { value: string; label: string }[];
    'aria-label'?: string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

let root: Root;
let host: HTMLDivElement;
const native = {
  mediaPermissions: jest.fn(),
  queryMedia: jest.fn(),
  mediaFolders: jest.fn(),
  cancelMediaRequest: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn(() => ({ remove: jest.fn().mockResolvedValue(undefined) })),
};
const settings = new Map<string, unknown>();
const setSetting = jest.fn(async (key: string, value: unknown) => { settings.set(key, value); });
const getSetting = jest.fn(async (key: string, fallback: unknown) => (settings.has(key) ? settings.get(key) : fallback));

const item = (name: string, id: number, extra: Record<string, unknown> = {}) => ({
  uri: `content://media/external/video/media/${id}`,
  name,
  kind: 'videos',
  mime: 'video/mp4',
  size: 1024,
  date_added: 1700000000,
  relative_path: 'Movies/KNOUX-Discovery/',
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  settings.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'knouxRuntime', { configurable: true, value: { edition: 'android' } });
  Object.defineProperty(window, 'knouxAPI', {
    configurable: true,
    value: { settings: { get: getSetting, set: setSetting }, file: { openFile: jest.fn().mockResolvedValue(null), scanDirectory: jest.fn().mockResolvedValue([]) } },
  });
  native.mediaPermissions.mockResolvedValue({ videos: 'full', photos: 'full', audio: 'full' });
  native.queryMedia.mockResolvedValue({ items: [], after: '', hasMore: false, access: 'full' });
  native.mediaFolders.mockResolvedValue({ folders: [], access: 'full' });
  (androidMediaStore as jest.Mock).mockReturnValue(native);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});

afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function mount(): Promise<void> { await act(async () => { root.render(<MobileMediaLibraryView />); }); }

async function click(text: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(text));
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

async function clickLabel(label: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Missing labelled button: ${label}`);
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

async function select(label: string, value: string): Promise<void> {
  const control = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!control) throw new Error(`Missing select: ${label}`);
  await act(async () => {
    control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const cardNames = (): string[] => [...host.querySelectorAll('.kml-media-card > strong')].map((node) => node.textContent ?? '');

test('device folders are listed with their real counts and open a filtered query', async () => {
  native.mediaFolders.mockImplementation(async ({ kind }: { kind: string }) => ({
    folders: kind === 'videos'
      ? [{ name: 'KNOUX-Discovery', path: 'Movies/KNOUX-Discovery/', count: 5, kind }]
      : kind === 'photos'
        ? [{ name: 'KNOUX-Discovery', path: 'Movies/KNOUX-Discovery/', count: 2, kind }]
        : [],
    access: 'full',
  }));
  native.queryMedia.mockResolvedValue({ items: [item('inside-folder.mp4', 5)], after: '', hasMore: false, access: 'full' });
  await mount();
  await click('Folders');
  expect(host.textContent).toContain('KNOUX-Discovery');
  expect(host.textContent).toContain('7');  await click('KNOUX-Discovery');
  expect(host.querySelector('[data-media-access="full"]')).not.toBeNull();
  const last = native.queryMedia.mock.calls.at(-1)?.[0];
  expect(last.bucket).toBe('Movies/KNOUX-Discovery/');
  expect(cardNames()).toContain('inside-folder.mp4');
});

test('a device collection is forwarded to the native query as a real filter', async () => {
  await mount();
  await select('Device collections', 'downloads');
  const last = native.queryMedia.mock.calls.at(-1)?.[0];
  expect(last.collection).toBe('downloads');
  await select('Device collections', 'camera');
  expect(native.queryMedia.mock.calls.at(-1)?.[0].collection).toBe('camera');
  await select('Device collections', 'media');
  expect(native.queryMedia.mock.calls.at(-1)?.[0].collection).toBeUndefined();
});

test('a favorite is stored in the runtime settings and reappears in the Favorites tab', async () => {
  native.queryMedia.mockResolvedValue({ items: [item('favorite-clip.mp4', 9)], after: '', hasMore: false, access: 'full' });
  await mount();
  const star = host.querySelector<HTMLButtonElement>('.kml-favorite');
  if (!star) throw new Error('Missing favorite control');
  await act(async () => { star.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(setSetting).toHaveBeenCalledWith('mobile.mediaFavorites', expect.arrayContaining([
    expect.objectContaining({ uri: 'content://media/external/video/media/9', name: 'favorite-clip.mp4' }),
  ]));
  await click('Favorites');
  expect(cardNames()).toContain('favorite-clip.mp4');
});

test('the sort direction reverses the loaded order', async () => {
  native.queryMedia.mockResolvedValue({
    items: [item('alpha.mp4', 1), item('bravo.mp4', 2)],
    after: '',
    hasMore: false,
    access: 'full',
  });
  await mount();
  expect(cardNames()).toEqual(['alpha.mp4', 'bravo.mp4']);
  await clickLabel('Sort ascending');
  expect(cardNames()).toEqual(['bravo.mp4', 'alpha.mp4']);
});

test('the list layout is offered next to the grid layout', async () => {
  native.queryMedia.mockResolvedValue({ items: [item('alpha.mp4', 1)], after: '', hasMore: false, access: 'full' });
  await mount();
  expect(host.querySelector('.kml-card-grid')).not.toBeNull();
  await clickLabel('List view');
  expect(host.querySelector('.kml-card-list')).not.toBeNull();
});
