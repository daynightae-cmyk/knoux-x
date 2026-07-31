/** @jest-environment jsdom */

import { installBrowserPreviewBridge } from '../../src/platform/browserPreviewBridge';
import { isBrowserPreviewRuntime, isDesktopRuntime } from '../../src/platform/runtime';

describe('honest runtime bridge ownership', () => {
  beforeEach(() => {
    delete window.knouxRuntime;
    delete (window as Partial<Window>).knouxAPI;
    delete (window as Partial<Window>).knouxCreativeAPI;
    delete (window as Partial<Window>).knouxRecordingAPI;
    delete (window as Partial<Window>).knouxMultitrackAPI;
    delete (window as Partial<Window>).knouxSlideshowAPI;
    delete (window as Partial<Window>).knouxAudioToolsAPI;
    delete document.documentElement.dataset.runtime;
  });

  test('installs only an explicitly labeled browser preview without desktop claims', async () => {
    installBrowserPreviewBridge();
    expect(window.knouxRuntime).toEqual({ edition: 'web-preview', product: 'KNOUX Player X', bridgeVersion: 1 });
    expect(isBrowserPreviewRuntime()).toBe(true);
    expect(isDesktopRuntime()).toBe(false);
    expect(await window.knouxAPI.system.getInfo()).toMatchObject({ packaged: false, electronVersion: 'not-applicable' });
  });

  test('never supplements a partial desktop bridge', () => {
    window.knouxRuntime = Object.freeze({ edition: 'desktop', product: 'KNOUX Player X', bridgeVersion: 1 });
    window.knouxAPI = {} as Window['knouxAPI'];
    expect(() => installBrowserPreviewBridge()).toThrow('DESKTOP_BRIDGE_INCOMPLETE');
    expect(window.knouxCreativeAPI).toBeUndefined();
  });

  test('rejects an undeclared preexisting bridge instead of claiming preview ownership', () => {
    window.knouxAPI = {} as Window['knouxAPI'];
    expect(() => installBrowserPreviewBridge()).toThrow('RUNTIME_BRIDGE_OWNERSHIP_CONFLICT');
    expect(window.knouxRuntime).toBeUndefined();
  });
});
