import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BrowserWindow, dialog } from 'electron';

import { IPC_INVOKE } from '../../electron/ipc/contract';
import { setupIPCHandlers } from '../../electron/ipc/setup';
import { authorizedMediaPaths } from '../../electron/security/path-registry';

jest.mock('electron', () => ({
  BrowserWindow: { fromWebContents: jest.fn() },
  dialog: { showSaveDialog: jest.fn() },
  shell: {},
}));
jest.mock('../../electron/startup/app-updater', () => ({ registerUpdateHandlers: jest.fn() }));
jest.mock('../../electron/build-identity', () => ({ getBuildIdentity: jest.fn() }));
jest.mock('../../electron/retouch/phase3b-acceptance-runtime', () => ({
  getPhase3bAcceptanceSavePath: () => null,
  takePhase3bAcceptanceOpenPath: () => null,
}));

describe('production save dialog IPC', () => {
  const owner = { isDestroyed: () => false };
  const event = { sender: {} };
  let save: (event: unknown, options?: unknown) => Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(BrowserWindow.fromWebContents).mockReturnValue(owner as never);
    jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' });
    const handlers = new Map<string, typeof save>();
    setupIPCHandlers({
      forOwner: () => ({ handle: (channel: string, handler: typeof save) => handlers.set(channel, handler) }),
    } as never, { services: { settings: { onChange: jest.fn() } } } as never);
    save = handlers.get(IPC_INVOKE.FILE_SAVE)!;
  });

  test('delivers overwrite confirmation and directory creation to the native dialog', async () => {
    const properties = ['createDirectory', 'showOverwriteConfirmation'];
    const options = { title: 'Save project', defaultPath: 'portrait.knouximage', properties };
    await expect(save(event, options)).resolves.toBeNull();
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(owner, expect.objectContaining(options));
    const nativeOptions = jest.mocked(dialog.showSaveDialog).mock.calls[0][1];
    expect(nativeOptions.properties).not.toBe(properties);
  });

  test.each(['showHiddenFiles', 'createDirectory', 'treatPackageAsDirectory', 'showOverwriteConfirmation', 'dontAddToRecent'])(
    'preserves the supported save property %s', async property => {
      await save(event, { properties: [property] });
      expect(dialog.showSaveDialog).toHaveBeenCalledWith(owner, expect.objectContaining({ properties: [property] }));
    },
  );

  test.each(['createDirectory', ['openDirectory'], ['multiSelections'], [false], [null], Array(6).fill('createDirectory')])(
    'rejects malformed or unsupported save properties before opening a dialog: %j', async properties => {
      await expect(save(event, { properties })).rejects.toThrow('properties');
      expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    },
  );

  test('keeps default options and does not forward unrelated native side effects', async () => {
    await save(event, { securityScopedBookmarks: true, properties: [] });
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(owner, {
      title: 'Save File', defaultPath: undefined, buttonLabel: undefined, filters: undefined, properties: [],
    });
    await save(event);
    expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(owner, expect.objectContaining({ title: 'Save File' }));
  });

  test('cancelling does not authorize or change the existing destination', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-save-cancel-'));
    const file = path.join(directory, 'original.knouximage');
    try {
      fs.writeFileSync(file, 'existing project');
      await expect(save(event, { defaultPath: file, properties: ['showOverwriteConfirmation'] })).resolves.toBeNull();
      expect(() => authorizedMediaPaths.requireAuthorized(file)).toThrow('not been authorized');
      expect(fs.readFileSync(file, 'utf8')).toBe('existing project');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
