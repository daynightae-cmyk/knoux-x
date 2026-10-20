/** @jest-environment jsdom */
import { installAndroidRuntimeBridge } from '../../src/platform/androidRuntimeBridge';
import { installAndroidFileBridge } from '../../src/platform/androidFileBridge';
import { installAndroidSafBridge } from '../../src/platform/androidSafBridge';
import { clearAndroidVirtualFiles } from '../../src/platform/androidVirtualFiles';

test('SAF slideshow import uses persisted provider URIs and survives virtual-cache loss', async () => {
  globalThis.structuredClone ??= <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const item = { uri: 'content://qa.documents/document/photo-1', name: 'صورة.jpg', mime: 'image/jpeg', size: 32 };
  const pick = jest.fn().mockResolvedValue({ items: [item] });
  Object.defineProperty(window, 'Capacitor', { configurable: true, value: {
    getPlatform: () => 'android', isNativePlatform: () => true,
    convertFileSrc: (uri: string) => `https://localhost/_capacitor_content_/${uri.slice(10)}`,
    Plugins: { KnouxSaf: { pick } },
  } });
  installAndroidRuntimeBridge();
  installAndroidFileBridge();
  installAndroidSafBridge();
  const imported = await window.knouxSlideshowAPI.importFiles();
  expect(imported.assets).toEqual([expect.objectContaining({ filePath: item.uri, family: 'image' })]);
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ mode: 'files' }));
  clearAndroidVirtualFiles();
  await expect(window.knouxCreativeAPI.media.toUrl(imported.assets[0].filePath))
    .resolves.toBe('https://localhost/_capacitor_content_/qa.documents/document/photo-1');
});
