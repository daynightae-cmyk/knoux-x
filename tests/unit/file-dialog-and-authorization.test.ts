import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { cancelledDialogResult, validateFileDialogOptions } from '../../electron/ipc/file-dialog-policy';
import { IPC_INVOKE } from '../../electron/ipc/contract';
import { AuthoritativeIpcRegistry } from '../../electron/ipc/registry';
import { AuthorizedPathRegistry } from '../../electron/security/validation';

describe('file dialog cancellation and authorization policy', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-dialog-policy-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('validates dialog option/filter shapes and clones accepted input', () => {
    const input = { title: 'Synthetic open', filters: [{ name: 'Media', extensions: ['mp4', '*'] }] };
    const accepted = validateFileDialogOptions(input);
    expect(accepted).toEqual(input);
    expect(accepted).not.toBe(input);
    expect(() => validateFileDialogOptions('bad')).toThrow('options');
    expect(() => validateFileDialogOptions({ title: '\u0000' })).toThrow('text');
    expect(() => validateFileDialogOptions({ filters: [{ name: '', extensions: [] }] })).toThrow('filter');
    expect(() => validateFileDialogOptions({ filters: [{ name: 'Bad', extensions: ['../exe'] }] })).toThrow('extension');
  });

  test('returns calm channel-specific cancellation values without authorizing or writing', () => {
    const paths = new AuthorizedPathRegistry();
    const candidate = path.join(root, 'cancelled-output.mp4');
    expect(cancelledDialogResult('open')).toBeNull();
    expect(cancelledDialogResult('open-directory')).toBeNull();
    expect(cancelledDialogResult('save')).toBeNull();
    expect(cancelledDialogResult('open-multiple')).toEqual([]);
    expect(() => paths.requireAuthorized(candidate)).toThrow('not been authorized');
    expect(fs.existsSync(candidate)).toBe(false);
  });

  test('normalizes selected paths and distinguishes existing, missing, and unauthorized files through the structured boundary', async () => {
    const fixture = path.join(root, 'fixture.mp4');
    const missing = path.join(root, 'missing.mp4');
    const unauthorized = path.join(root, 'unauthorized.mp4');
    await fsPromises.writeFile(fixture, 'synthetic');
    const paths = new AuthorizedPathRegistry();
    expect(paths.authorizeFile(path.join(root, '.', 'fixture.mp4'))).toBe(path.normalize(fixture));
    paths.authorizeFile(missing);

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const registry = new AuthoritativeIpcRegistry({
      handle: (channel, listener) => { handlers.set(channel, listener); },
      on: () => undefined,
      removeListener: () => undefined,
    } as never);
    const preloadPath = path.join(root, 'preload-entry.js');
    await fsPromises.writeFile(preloadPath, 'synthetic');
    registry.configureStartup(preloadPath, {
      product: 'KNOUX Player X', version: '2.0.0', sha: 'a'.repeat(40), branch: 'test/dialog',
      builtAt: '2026-08-01T00:00:00.000Z', packaged: false, electronVersion: '32.3.3',
    });
    registry.configureTrustedSender(() => true);
    registry.forOwner('file-policy').handle(IPC_INVOKE.FILE_EXISTS, async (_event, filePath) => {
      const authorized = paths.requireAuthorized(filePath);
      try { await fsPromises.access(authorized); return true; } catch { return false; }
    });
    const handler = handlers.get(IPC_INVOKE.FILE_EXISTS)!;
    await expect(handler({}, fixture)).resolves.toEqual({ ok: true, value: true });
    await expect(handler({}, missing)).resolves.toEqual({ ok: true, value: false });
    await expect(handler({}, unauthorized)).resolves.toMatchObject({ ok: false, error: { code: 'IPC_HANDLER_FAILED', channel: 'file:exists' } });
  });

  test('production handlers bind dialogs to BrowserWindow.fromWebContents and smoke cancellation only to the CLI flag', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../electron/ipc/setup.ts'), 'utf8');
    expect(source).toContain('BrowserWindow.fromWebContents(event.sender)');
    expect(source).toContain("process.argv.includes('--ipc-smoke-test')");
    expect(source).toContain('dialog.showOpenDialog(dialogOwner(event)');
    expect(source).toContain('dialog.showSaveDialog(dialogOwner(event)');
    expect(source).not.toMatch(/rawOptions.*ipc-smoke-test/);
  });
});
