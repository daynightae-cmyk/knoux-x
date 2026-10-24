/** @jest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type VaultPlugin = Record<string, jest.Mock>;

/* The mocked module owns its own state so the factory has nothing to close over
   before it runs (jest.mock is hoisted above the imports). */
jest.mock('../../src/platform/androidVault', () => {
  const state: { plugin: VaultPlugin | null; availability: string; token: string | null } = {
    plugin: null,
    availability: 'non-android',
    token: 'session-token',
  };
  (globalThis as unknown as { __vault: typeof state }).__vault = state;
  return {
    androidVault: () => state.plugin,
    describeVaultAvailability: () => state.availability,
    setVaultSessionToken: (token: string) => { state.token = token; },
    vaultSessionToken: () => state.token,
    forgetVaultSession: () => { state.token = null; },
    holdVaultSession: async () => undefined,
    releaseVaultSession: async () => undefined,
    vaultPlaybackUrl: (uri: string) => uri,
    watchVaultAutoLock: () => () => undefined,
  };
});

jest.mock('../../src/platform/androidSafBridge', () => ({
  androidDocumentTitle: async (uri: string) => uri.split('/').pop() ?? '',
}));

jest.mock('../../src/platform/withDeadline', () => ({
  // Keep the real contract but make the clock explicit in the test.
  withDeadline: (work: Promise<unknown>, ms: number, message: string) => Promise.race([
    work,
    new Promise((_, reject) => { setTimeout(() => reject(new Error(message)), ms); }),
  ]),
}));

jest.mock('../../src/components/brand/BrandMark', () => ({
  BrandMark: ({ size }: { size: number }) => createElement('span', { 'data-brand-mark': size }),
  OFFICIAL_LOGO_URL: 'logo.png',
}));

const notifications: Array<{ type: string; title: string; message: string }> = [];

jest.mock('../../src/store/appStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    locale: 'en',
    setView: jest.fn(),
    addNotification: (notification: { type: string; title: string; message: string }) => notifications.push(notification),
  }),
}));

jest.mock('../../src/store/playerStore', () => ({
  usePlayerStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    setCurrentMedia: jest.fn(),
    setMediaTitle: jest.fn(),
  }),
}));

import { MobileVaultView } from '../../src/features/vault/MobileVaultView';

const vaultState = () => (globalThis as unknown as {
  __vault: { plugin: VaultPlugin | null; availability: string; token: string | null };
}).__vault;

function baseStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    created: true,
    locked: false,
    keyAvailable: true,
    lockedOutForMs: 0,
    itemCount: 1,
    indexState: 'ok',
    indexRecoverySource: 'none',
    indexBackupHealthy: true,
    keySecurityAvailable: true,
    keySecurityLevel: 'strongbox',
    keyHardwareBacked: true,
    plaintextCacheFiles: 0,
    plaintextCacheFailures: 0,
    ...overrides,
  };
}

const ITEM = { id: 'item-1', name: 'private.mp4', mime: 'video/mp4', size: 2048, duration: 4, createdAt: 1_700_000_000, hasThumbnail: false };

function makePlugin(status: Record<string, unknown>): VaultPlugin {
  return {
    vaultStatus: jest.fn(async () => status),
    vaultList: jest.fn(async () => ({ items: [ITEM], indexRecovered: false, recoveredMetadataLimited: false })),
    vaultOpen: jest.fn(async () => ({ uri: 'knoux-vault://decrypted', mime: ITEM.mime, name: ITEM.name })),
    vaultThumbnail: jest.fn(async () => ({ hasThumbnail: false })),
    vaultLock: jest.fn(async () => ({ cachedPlaintextRemoved: 0, cachedPlaintextRetained: 0 })),
    vaultExport: jest.fn(async () => ({ exported: true, bytes: 2048 })),
    vaultImport: jest.fn(async () => ({ id: 'item-2', bytes: 4096, items: [ITEM], indexRecovered: false, recoveredMetadataLimited: false, indexBackupHealthy: true })),
    vaultDelete: jest.fn(async () => ({ items: [], filesRemoved: 1, filesRetained: 0, indexRecovered: false, recoveredMetadataLimited: false })),
    vaultChangePin: jest.fn(async () => ({ changed: true })),
    vaultCreate: jest.fn(async () => ({ token: 'session-token', createdAt: 1 })),
    vaultUnlock: jest.fn(async () => ({ token: 'session-token', items: [ITEM], indexRecovered: false, recoveredMetadataLimited: false })),
  };
}

async function mount(host: HTMLElement): Promise<Root> {
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MobileVaultView));
  });
  return root;
}

/** React tracks the value written through the native setter, not `input.value`. */
async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buttonByText(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((node) => (node.textContent ?? '').includes(label));
}

async function click(element: HTMLButtonElement | undefined): Promise<void> {
  if (!element) throw new Error('Expected a button that is not present.');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Private Vault reports the device answer instead of assuming success', () => {
  let host: HTMLElement;

  beforeEach(() => {
    notifications.length = 0;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    vaultState().availability = 'available';
    vaultState().token = 'session-token';
    host = document.createElement('div');
    document.body.replaceChildren(host);
    Object.defineProperty(window, 'knouxAPI', {
      configurable: true,
      value: {
        file: {
          saveFile: jest.fn(async () => 'content://downloads/exported.mp4'),
          openFile: jest.fn(async () => null),
          deleteFile: jest.fn(async () => true),
        },
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.replaceChildren();
  });

  test('an Android build whose plugin never registered says so', async () => {
    vaultState().availability = 'plugin-missing';
    vaultState().plugin = null;
    await mount(host);
    const text = host.textContent ?? '';
    expect(text).toContain('vault plugin did not start');
    expect(text).toContain('no file was read or changed');
    expect(text).not.toContain('The private vault is available on Android');
  });

  test('a desktop build still gets the platform answer', async () => {
    vaultState().availability = 'non-android';
    vaultState().plugin = null;
    await mount(host);
    expect(host.textContent).toContain('The private vault is available on Android.');
    expect(host.textContent).not.toContain('did not start');
  });

  test('an unconfirmed decrypted export is never announced as exported', async () => {
    const plugin = makePlugin(baseStatus());
    plugin.vaultExport.mockResolvedValue({ exported: false, bytes: 0 });
    vaultState().plugin = plugin;
    await mount(host);

    await click(buttonByText(host, 'Export'));
    expect(plugin.vaultExport).toHaveBeenCalled();
    expect(notifications.some((entry) => entry.title === 'Exported')).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('did not confirm a decrypted write');
  });

  test('a refused PIN change is not announced as a change', async () => {
    const plugin = makePlugin(baseStatus());
    plugin.vaultChangePin.mockResolvedValue({ changed: false });
    vaultState().plugin = plugin;
    await mount(host);

    const input = host.querySelector('input[aria-label="New vault PIN"]') as HTMLInputElement;
    await typeInput(input, '918273');
    await click(buttonByText(host, 'Update'));
    expect(notifications.some((entry) => entry.title === 'PIN changed')).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('refused the PIN change');
  });

  test('an import the index never listed is not announced as encrypted', async () => {
    const plugin = makePlugin(baseStatus());
    (window.knouxAPI.file.openFile as jest.Mock).mockResolvedValue('content://media/private-clip.mp4');
    plugin.vaultImport.mockResolvedValue({ id: 'ghost', bytes: 4096, items: [ITEM], indexRecovered: false, recoveredMetadataLimited: false, indexBackupHealthy: true });
    vaultState().plugin = plugin;
    await mount(host);

    await click(buttonByText(host, 'Encrypt media'));
    expect(plugin.vaultImport).toHaveBeenCalled();
    expect(notifications.some((entry) => entry.title === 'Encrypted into the vault')).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('did not list the new encrypted file');
  });

  test('a hung native status read is reported instead of a blank screen', async () => {
    const plugin = makePlugin(baseStatus());
    plugin.vaultStatus.mockImplementation(() => new Promise(() => undefined));
    vaultState().plugin = plugin;
    await mount(host);
    expect(host.textContent).toContain('Checking the vault');

    await act(async () => {
      jest.advanceTimersByTime(9_000);
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('did not answer in time');
  });

  test('a broken index backup after a good import is surfaced', async () => {
    const plugin = makePlugin(baseStatus());
    (window.knouxAPI.file.openFile as jest.Mock).mockResolvedValue('content://media/private-clip.mp4');
    plugin.vaultImport.mockResolvedValue({ id: 'item-1', bytes: 4096, items: [ITEM], indexRecovered: false, recoveredMetadataLimited: false, indexBackupHealthy: false });
    vaultState().plugin = plugin;
    await mount(host);

    await click(buttonByText(host, 'Encrypt media'));
    expect(notifications.some((entry) => entry.title === 'Encrypted into the vault')).toBe(true);
    expect(notifications.some((entry) => entry.title === 'The index backup is not healthy')).toBe(true);
  });

  test('a healthy index without a verified backup still warns', async () => {
    const plugin = makePlugin(baseStatus({ indexBackupHealthy: false }));
    vaultState().plugin = plugin;
    await mount(host);
    expect(host.querySelector('.kvv-warning')?.textContent).toContain('backup is not verified');
  });
});
