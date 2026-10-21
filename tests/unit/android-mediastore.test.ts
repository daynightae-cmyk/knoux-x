/** @jest-environment jsdom */
import { androidMediaStore, loadMediaThumbnail, type MediaStoreItem, type MediaStoreMethods } from '../../src/platform/androidMediaStore';

const item: MediaStoreItem = { uri: 'content://media/external/video/media/12', kind: 'videos', name: 'clip.mp4', mime: 'video/mp4', size: 4000 };
function install(mediaThumbnail: MediaStoreMethods['mediaThumbnail']): void {
  Object.defineProperty(window, 'knouxRuntime', { configurable: true, value: { edition: 'android' } });
  Object.defineProperty(window, 'Capacitor', { configurable: true, value: { Plugins: { KnouxSaf: { mediaThumbnail, cancelMediaRequest: jest.fn().mockResolvedValue(undefined) } } } });
}

test('uses the existing native document bridge only on Android', () => {
  install(jest.fn());
  expect(androidMediaStore()).toBe(window.Capacitor?.Plugins?.KnouxSaf);
  Object.defineProperty(window, 'knouxRuntime', { value: { edition: 'desktop' } });
  expect(androidMediaStore()).toBeNull();
});

test('limits thumbnail concurrency and skips an offscreen cancelled queued item', async () => {
  const finish: Array<(value: { dataUrl: string }) => void> = [];
  const thumbnail = jest.fn(() => new Promise<{ dataUrl: string }>((resolve) => finish.push(resolve)));
  install(thumbnail);
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const work = controllers.map((controller) => loadMediaThumbnail(item, controller.signal));
  expect(thumbnail).toHaveBeenCalledTimes(2);
  controllers[2].abort();
  finish[0]({ dataUrl: 'first' });
  finish[1]({ dataUrl: 'second' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(thumbnail).toHaveBeenCalledTimes(3);
  finish[2]({ dataUrl: 'last' });
  expect(await Promise.all(work)).toEqual(['first', 'second', undefined, 'last']);
});

test('cancels the native request and discards late thumbnail results', async () => {
  let complete!: (value: { dataUrl: string }) => void;
  install(() => new Promise((resolve) => { complete = resolve; }));
  const controller = new AbortController();
  const work = loadMediaThumbnail(item, controller.signal);
  controller.abort();
  expect(window.Capacitor?.Plugins?.KnouxSaf?.cancelMediaRequest).toHaveBeenCalled();
  complete({ dataUrl: 'must-not-render' });
  expect(await work).toBeUndefined();
});
