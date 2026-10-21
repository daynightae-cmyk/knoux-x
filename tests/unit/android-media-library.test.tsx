/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MobileMediaLibraryView } from '../../src/features/library/MobileMediaLibraryView';
import { androidMediaStore } from '../../src/platform/androidMediaStore';

jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('../../src/components/neon/NeonSelect', () => ({ NeonSelect: () => null }));
jest.mock('../../src/features/library/MediaStoreThumbnail', () => ({ MediaStoreThumbnail: () => null }));
jest.mock('../../src/store/appStore', () => ({ useAppStore: (select: (value: unknown) => unknown) => select({ locale: 'en', setView: jest.fn(), addNotification: jest.fn() }) }));
jest.mock('../../src/store/playerStore', () => ({ usePlayerStore: (select: (value: unknown) => unknown) => select({ setCurrentMedia: jest.fn(), setMediaTitle: jest.fn() }) }));
jest.mock('../../src/store/imageEditorStore', () => ({ useImageEditorStore: (select: (value: unknown) => unknown) => select({ setSource: jest.fn() }) }));
jest.mock('../../src/features/player/mobilePlayerSession', () => ({ readRecentMedia: () => [] }));
jest.mock('../../src/platform/androidMediaStore', () => ({ androidMediaStore: jest.fn(), mediaRequestId: () => 'unit-request' }));

let root: Root;
let host: HTMLDivElement;
const native = {
  mediaPermissions: jest.fn(), queryMedia: jest.fn(), cancelMediaRequest: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn().mockResolvedValue({ remove: jest.fn().mockResolvedValue(undefined) }),
};
const openFile = jest.fn().mockResolvedValue(null);
const scanDirectory = jest.fn().mockResolvedValue([]);
const getSetting = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'knouxRuntime', { configurable: true, value: { edition: 'android' } });
  Object.defineProperty(window, 'knouxAPI', { configurable: true, value: { settings: { get: getSetting, set: jest.fn().mockResolvedValue(undefined) }, file: { openFile, scanDirectory } } });
  getSetting.mockImplementation((_key: string, fallback: unknown) => Promise.resolve(fallback));
  native.mediaPermissions.mockResolvedValue({ videos: 'full', photos: 'denied', audio: 'denied' });
  native.queryMedia.mockResolvedValue({ items: [], after: '', hasMore: false, access: 'full' });
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

test('Recents cancels an outstanding scan and leaves ordinary file opening usable', async () => {
  native.queryMedia.mockImplementation(() => new Promise(() => undefined));
  await mount();
  expect(host.textContent).toContain('Loading media');
  await click('Recents');
  expect(native.cancelMediaRequest).toHaveBeenCalled();
  await click('Open Video');
  expect(openFile).toHaveBeenCalledTimes(1);
});

test('restores the saved SAF source without replacing it with a device query', async () => {
  getSetting.mockImplementation((key: string) => Promise.resolve(key === 'mobile.libraryPath' ? 'content://saved/tree/root' : 'saf'));
  await mount();
  expect(scanDirectory).toHaveBeenCalledWith('content://saved/tree/root', false);
  expect(native.queryMedia).not.toHaveBeenCalled();
  expect(host.textContent).toContain('KNOUX media folder');
});

test('revoked device access shows denied state and does not query unauthorized rows', async () => {
  native.mediaPermissions.mockResolvedValue({ videos: 'denied', photos: 'denied', audio: 'denied' });
  await mount();
  expect(host.querySelector('[data-media-access="denied"]')).not.toBeNull();
  expect(native.queryMedia).not.toHaveBeenCalled();
  expect(host.querySelectorAll('.kml-media-card')).toHaveLength(0);
});
