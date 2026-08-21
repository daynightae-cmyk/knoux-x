import { registerApplicationLifecycle, type QuitEvent } from '../../electron/startup/application-lifecycle';

type LifecycleEvent = 'before-quit' | 'window-all-closed';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('application lifecycle', () => {
  test('registers before-quit synchronously and waits for cleanup before exiting', async () => {
    const listeners = new Map<LifecycleEvent, (...args: unknown[]) => void>();
    const cleanup = deferred<void>();
    const preventDefault = jest.fn<void, []>();
    const exit = jest.fn<void, [number]>();

    registerApplicationLifecycle(
      {
        onBeforeQuit: (listener) => { listeners.set('before-quit', listener); },
        onWindowAllClosed: (listener) => { listeners.set('window-all-closed', listener); },
        quit: jest.fn<void, []>(),
        exit,
      },
      {
        platform: 'win32',
        cleanup: jest.fn<Promise<void>, []>(() => cleanup.promise),
        reportCleanupFailure: jest.fn<void, [unknown]>(),
      },
    );

    const beforeQuit = listeners.get('before-quit');
    expect(beforeQuit).toBeDefined();
    beforeQuit!({ preventDefault } satisfies QuitEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    cleanup.resolve();
    await flushPromises();
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('reports a cleanup rejection and still exits without leaking a rejected promise', async () => {
    const listeners = new Map<LifecycleEvent, (...args: unknown[]) => void>();
    const failure = new Error('cleanup failed');
    const reportCleanupFailure = jest.fn<void, [unknown]>();
    const exit = jest.fn<void, [number]>();

    registerApplicationLifecycle(
      {
        onBeforeQuit: (listener) => { listeners.set('before-quit', listener); },
        onWindowAllClosed: (listener) => { listeners.set('window-all-closed', listener); },
        quit: jest.fn<void, []>(),
        exit,
      },
      {
        platform: 'win32',
        cleanup: jest.fn<Promise<void>, []>().mockRejectedValue(failure),
        reportCleanupFailure,
      },
    );

    listeners.get('before-quit')!({ preventDefault: jest.fn<void, []>() } satisfies QuitEvent);
    await flushPromises();

    expect(reportCleanupFailure).toHaveBeenCalledWith(failure);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('quits on final window close outside macOS only', () => {
    const windowsListeners = new Map<LifecycleEvent, (...args: unknown[]) => void>();
    const windowsQuit = jest.fn<void, []>();
    registerApplicationLifecycle(
      {
        onBeforeQuit: (listener) => { windowsListeners.set('before-quit', listener); },
        onWindowAllClosed: (listener) => { windowsListeners.set('window-all-closed', listener); },
        quit: windowsQuit,
        exit: jest.fn<void, [number]>(),
      },
      { platform: 'win32', cleanup: jest.fn<Promise<void>, []>().mockResolvedValue(undefined), reportCleanupFailure: jest.fn<void, [unknown]>() },
    );
    windowsListeners.get('window-all-closed')!();
    expect(windowsQuit).toHaveBeenCalledTimes(1);

    const macListeners = new Map<LifecycleEvent, (...args: unknown[]) => void>();
    const macQuit = jest.fn<void, []>();
    registerApplicationLifecycle(
      {
        onBeforeQuit: (listener) => { macListeners.set('before-quit', listener); },
        onWindowAllClosed: (listener) => { macListeners.set('window-all-closed', listener); },
        quit: macQuit,
        exit: jest.fn<void, [number]>(),
      },
      { platform: 'darwin', cleanup: jest.fn<Promise<void>, []>().mockResolvedValue(undefined), reportCleanupFailure: jest.fn<void, [unknown]>() },
    );
    macListeners.get('window-all-closed')!();
    expect(macQuit).not.toHaveBeenCalled();
  });
});
