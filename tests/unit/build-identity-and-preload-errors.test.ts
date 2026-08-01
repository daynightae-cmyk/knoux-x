import fs from 'node:fs';
import path from 'node:path';

import { validateBuildMetadata } from '../../electron/build-metadata-policy';
import { IPC_INVOKE } from '../../electron/ipc/contract';
import { DesktopIpcError, invokeDesktop } from '../../electron/ipc/preload-client';

const mockInvoke = jest.fn();
const mockSend = jest.fn();
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: (...args: unknown[]) => mockInvoke(...args),
    send: (...args: unknown[]) => mockSend(...args),
    on: (...args: unknown[]) => mockOn(...args),
    removeListener: (...args: unknown[]) => mockRemoveListener(...args),
  },
}));

describe('build identity rejection policy', () => {
  test('accepts and normalizes concrete build metadata', () => {
    expect(validateBuildMetadata({
      sha: 'A'.repeat(40),
      branch: 'fix/native-runtime-and-creative-suite-completion',
      timestamp: '2026-08-01T12:34:56.789Z',
    })).toEqual({
      sha: 'a'.repeat(40),
      branch: 'fix/native-runtime-and-creative-suite-completion',
      timestamp: '2026-08-01T12:34:56.789Z',
    });
  });

  test.each([
    [{ branch: 'feature/test', timestamp: '2026-08-01T00:00:00.000Z' }, 'sha'],
    [{ sha: 'placeholder', branch: 'feature/test', timestamp: '2026-08-01T00:00:00.000Z' }, 'sha'],
    [{ sha: 'a'.repeat(40), branch: '', timestamp: '2026-08-01T00:00:00.000Z' }, 'branch'],
    [{ sha: 'a'.repeat(40), branch: 'unknown', timestamp: '2026-08-01T00:00:00.000Z' }, 'branch'],
    [{ sha: 'a'.repeat(40), branch: 'dev', timestamp: '2026-08-01T00:00:00.000Z' }, 'branch'],
    [{ sha: 'a'.repeat(40), branch: 'feature/test', timestamp: 'not-a-time' }, 'timestamp'],
    [{ sha: 'a'.repeat(40), branch: 'feature/test' }, 'timestamp'],
  ])('rejects missing or placeholder build identity %#', (metadata, field) => {
    expect(() => validateBuildMetadata(metadata)).toThrow(`BUILD_IDENTITY_INVALID ${field}`);
  });
});

describe('preload transport, protocol, and structured errors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('maps transport failures to a stable safe error without leaking raw details', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Error invoking remote method: secret filesystem stack'));
    let captured: unknown;
    try {
      await invokeDesktop(IPC_INVOKE.SYSTEM_INFO);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(DesktopIpcError);
    expect(captured).toMatchObject({
      name: 'DesktopIpcError',
      code: 'IPC_TRANSPORT_FAILURE',
      channel: IPC_INVOKE.SYSTEM_INFO,
      message: 'Desktop service system:info could not be reached.',
    });
    expect(String(captured)).not.toContain('secret filesystem stack');
  });

  test('rejects malformed success, failure, and non-envelope protocol responses', async () => {
    for (const response of [undefined, {}, { ok: true }, { ok: false }, { ok: false, error: { code: 'X' } }]) {
      mockInvoke.mockResolvedValueOnce(response);
      await expect(invokeDesktop(IPC_INVOKE.SYSTEM_INFO)).rejects.toMatchObject({
        code: 'IPC_PROTOCOL_FAILURE',
        channel: IPC_INVOKE.SYSTEM_INFO,
      });
    }
  });

  test('preserves a structured handler error and rejects an unknown raw error shape', async () => {
    mockInvoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'IPC_HANDLER_FAILED',
        channel: IPC_INVOKE.SYSTEM_INFO,
        message: 'The desktop service could not complete the request.',
        detail: 'diagnostic-id',
      },
    });
    await expect(invokeDesktop(IPC_INVOKE.SYSTEM_INFO)).rejects.toMatchObject({
      code: 'IPC_HANDLER_FAILED',
      channel: IPC_INVOKE.SYSTEM_INFO,
      message: 'The desktop service could not complete the request.',
      detail: 'diagnostic-id',
    });

    mockInvoke.mockResolvedValueOnce({ ok: false, error: new Error('unknown raw failure') });
    await expect(invokeDesktop(IPC_INVOKE.SYSTEM_INFO)).rejects.toMatchObject({ code: 'IPC_PROTOCOL_FAILURE' });
  });
});

describe('startup failure cleanup evidence', () => {
  test('awaits centralized cleanup before exit and records structured cleanup and recovery logs', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../electron/main.ts'), 'utf8');
    const failure = source.indexOf(".catch(async (error) =>");
    const cleanup = source.indexOf("await cleanupApplication('startup-failure')", failure);
    const exit = source.indexOf('app.exit(1)', failure);
    expect(failure).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(failure);
    expect(exit).toBeGreaterThan(cleanup);
    expect(source).toContain('KNOUX_RUNTIME_CLEANUP');
    expect(source).toContain('KNOUX_SETTINGS_RECOVERY');
    expect(source.indexOf("settings.on('recovery'")).toBeLessThan(source.indexOf('await systemOrchestrator.services.settings.initialize()'));
  });

  test('settings persistence self-test always removes its temporary root and records cleanup evidence', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../electron/startup/settings-persistence-self-test.ts'), 'utf8');
    expect(source).toMatch(/finally\s*{/);
    expect(source).toContain("await fs.rm(root, { recursive: true, force: true })");
    expect(source).toContain('temporaryRootRemoved');
    expect(source.indexOf('finally {')).toBeLessThan(source.lastIndexOf('writeEvidence(evidencePath, evidence)'));
  });
});
