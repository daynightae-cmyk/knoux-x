import { maybeRunSettingsPersistenceSelfTest } from '../../electron/startup/settings-self-test-runtime';

describe('packaged settings self-test startup', () => {
  test('does not intercept ordinary desktop startup arguments', async () => {
    const whenReady = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const exit = jest.fn<void, [number]>();
    const runSelfTest = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

    await expect(maybeRunSettingsPersistenceSelfTest(['knoux-player-x.exe'], { whenReady, exit }, runSelfTest)).resolves.toBe(false);

    expect(whenReady).not.toHaveBeenCalled();
    expect(runSelfTest).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  test('runs settings persistence evidence mode before normal startup and exits cleanly', async () => {
    const calls: string[] = [];
    const whenReady = jest.fn<Promise<void>, []>().mockImplementation(async () => { calls.push('ready'); });
    const exit = jest.fn<void, [number]>((code) => { calls.push(`exit:${code}`); });
    const runSelfTest = jest.fn<Promise<void>, [string]>().mockImplementation(async (evidencePath) => {
      calls.push(`self-test:${evidencePath}`);
    });

    await expect(maybeRunSettingsPersistenceSelfTest(
      ['knoux-player-x.exe', '--settings-self-test', '--settings-evidence=C:\\Temp\\settings-evidence.json'],
      { whenReady, exit },
      runSelfTest,
    )).resolves.toBe(true);

    expect(runSelfTest).toHaveBeenCalledWith('C:\\Temp\\settings-evidence.json');
    expect(calls).toEqual(['ready', 'self-test:C:\\Temp\\settings-evidence.json', 'exit:0']);
  });

  test('propagates a failed self-test without reporting a successful process exit', async () => {
    const failure = new Error('settings persistence verification failed');
    const whenReady = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const exit = jest.fn<void, [number]>();
    const runSelfTest = jest.fn<Promise<void>, [string]>().mockRejectedValue(failure);

    await expect(maybeRunSettingsPersistenceSelfTest(
      ['knoux-player-x.exe', '--settings-self-test'],
      { whenReady, exit },
      runSelfTest,
    )).rejects.toBe(failure);

    expect(exit).not.toHaveBeenCalled();
  });
});
