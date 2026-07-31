import {
  type PrimaryInstanceRuntime,
  startSingleInstanceEntry,
} from '../../electron/startup/single-instance';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('single-instance startup', () => {
  test('exits a Squirrel lifecycle process before requesting the lock or bootstrapping', () => {
    const requestLock = jest.fn(() => true);
    const bootstrap = jest.fn<PrimaryInstanceRuntime, []>(() => ({
      handleSecondInstance: jest.fn(),
    }));
    const exit = jest.fn();

    expect(startSingleInstanceEntry({
      squirrelStartup: true,
      requestLock,
      onSecondInstance: jest.fn(),
      bootstrap,
      exit,
      onFatal: jest.fn(),
    })).toBe('squirrel');

    expect(exit).toHaveBeenCalledWith(0);
    expect(requestLock).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  test('exits a secondary process without registering handlers or bootstrapping services', () => {
    const onSecondInstance = jest.fn();
    const bootstrap = jest.fn<PrimaryInstanceRuntime, []>(() => ({
      handleSecondInstance: jest.fn(),
    }));
    const exit = jest.fn();

    expect(startSingleInstanceEntry({
      squirrelStartup: false,
      requestLock: () => false,
      onSecondInstance,
      bootstrap,
      exit,
      onFatal: jest.fn(),
    })).toBe('secondary');

    expect(exit).toHaveBeenCalledWith(0);
    expect(onSecondInstance).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  test('acquires the primary lock and forwards arguments received before runtime readiness', async () => {
    let secondInstanceListener: ((argv: readonly string[]) => void) | undefined;
    let resolveRuntime: ((runtime: PrimaryInstanceRuntime) => void) | undefined;
    const handleSecondInstance = jest.fn();
    const runtimePromise = new Promise<PrimaryInstanceRuntime>((resolve) => {
      resolveRuntime = resolve;
    });

    expect(startSingleInstanceEntry({
      squirrelStartup: false,
      requestLock: () => true,
      onSecondInstance: (listener) => {
        secondInstanceListener = listener;
      },
      bootstrap: () => runtimePromise,
      exit: jest.fn(),
      onFatal: jest.fn(),
    })).toBe('primary');

    secondInstanceListener?.(['knoux-player-x.exe', 'C:\\media\\movie.mp4']);
    expect(handleSecondInstance).not.toHaveBeenCalled();

    resolveRuntime?.({ handleSecondInstance });
    await flushPromises();
    await flushPromises();

    expect(handleSecondInstance).toHaveBeenCalledWith([
      'knoux-player-x.exe',
      'C:\\media\\movie.mp4',
    ]);
  });

  test('keeps the primary entry active and reports bootstrap failures', async () => {
    const failure = new Error('bootstrap failed');
    const onFatal = jest.fn();
    const exit = jest.fn();

    expect(startSingleInstanceEntry({
      squirrelStartup: false,
      requestLock: () => true,
      onSecondInstance: jest.fn(),
      bootstrap: () => Promise.reject(failure),
      exit,
      onFatal,
    })).toBe('primary');

    await flushPromises();
    await flushPromises();

    expect(onFatal).toHaveBeenCalledWith(failure);
    expect(exit).not.toHaveBeenCalled();
  });
});
