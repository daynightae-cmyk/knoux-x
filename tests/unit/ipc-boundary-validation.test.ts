import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BASIC_INVOKE_CHANNELS,
  EXPOSED_INVOKE_CHANNELS,
  IPC_CHANNEL_DEFINITIONS,
  IPC_INBOUND,
  IPC_INVOKE,
  IPC_OUTBOUND,
} from '../../electron/ipc/contract';
import { AuthoritativeIpcRegistry } from '../../electron/ipc/registry';
import { collectProductionIpcSourceRoots } from '../../tools/ipc-source-parity';

interface FakeIpc {
  handlers: Map<string, (...args: unknown[]) => unknown>;
  handle(channel: string, listener: (...args: unknown[]) => unknown): void;
  on(channel: string, listener: (...args: unknown[]) => unknown): void;
  removeListener(channel: string, listener: (...args: unknown[]) => unknown): void;
}

function fakeIpc(): FakeIpc {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: (channel, listener) => { handlers.set(channel, listener); },
    on: () => undefined,
    removeListener: () => undefined,
  };
}

function configuredRegistry(ipc: FakeIpc, preloadPath: string): AuthoritativeIpcRegistry {
  const registry = new AuthoritativeIpcRegistry(ipc as never);
  registry.configureStartup(preloadPath, {
    product: 'KNOUX Player X', version: '2.0.0', sha: 'a'.repeat(40), branch: 'test/ipc-boundary',
    builtAt: '2026-08-01T00:00:00.000Z', packaged: false, electronVersion: '32.3.3',
  });
  registry.configureTrustedSender(() => true);
  return registry;
}

describe('complete IPC schema and basic boundary', () => {
  let root: string;
  let preloadPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-ipc-boundary-'));
    preloadPath = path.join(root, 'preload-entry.js');
    fs.writeFileSync(preloadPath, 'synthetic');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('all directions have concrete keyed shapes and source roots', () => {
    expect(IPC_CHANNEL_DEFINITIONS).toHaveLength(281);
    expect(IPC_CHANNEL_DEFINITIONS.filter((entry) => entry.direction === 'invoke')).toHaveLength(EXPOSED_INVOKE_CHANNELS.length);
    for (const definition of IPC_CHANNEL_DEFINITIONS) {
      expect(definition.arguments).toMatchObject({ schema: 'typescript' });
      expect(definition.arguments.typeId).toContain(definition.channel);
      expect(definition.result.schema).toBe('typescript');
      expect(definition.sourceRoots.length).toBeGreaterThanOrEqual(1);
      expect(definition.sourceRoots.every((sourceRoot) => sourceRoot.endsWith('.ts'))).toBe(true);
      expect(JSON.stringify(definition)).not.toMatch(/typed preload API|typed event payload|unknown\[\]/i);
    }
    const source = fs.readFileSync(path.resolve(__dirname, '../../electron/ipc/channel-types.ts'), 'utf8');
    for (const channel of EXPOSED_INVOKE_CHANNELS) {
      expect(source.match(new RegExp(`'${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':`, 'g'))).toHaveLength(2);
    }
  });

  test('manifest roots exactly match every production IPC constant use in both directions', () => {
    const repositoryRoot = path.resolve(__dirname, '../..');
    const actualRoots = collectProductionIpcSourceRoots(repositoryRoot, {
      invoke: IPC_INVOKE,
      inbound: IPC_INBOUND,
      outbound: IPC_OUTBOUND,
    });
    expect(Object.keys(actualRoots).sort()).toEqual(IPC_CHANNEL_DEFINITIONS.map(({ channel }) => channel).sort());
    for (const definition of IPC_CHANNEL_DEFINITIONS) {
      expect(definition.sourceRoots).toEqual(actualRoots[definition.channel]);
      for (const sourceRoot of definition.sourceRoots) {
        expect(fs.existsSync(path.join(repositoryRoot, sourceRoot))).toBe(true);
      }
    }
    expect(actualRoots['library:choose-folder']).toContain('electron/preload-creative.ts');
    expect(actualRoots['subtitle:select']).toContain('electron/preload-creative.ts');
    expect(actualRoots['library:scan']).toEqual([
      'electron/ipc/creative-suite.ts',
      'electron/preload-creative.ts',
      'electron/preload.ts',
    ]);
    expect(actualRoots['app:open-media']).toContain('electron/menu/app-menu.ts');
  });

  test('every no-emitter outbound declaration is explicitly reserved with a concrete reason', () => {
    const expectedReserved = [
      'ai:stream',
      'audio:visualizer-data',
      'player:ended',
      'player:error',
      'player:state-change',
      'player:time-update',
    ];
    const reserved = IPC_CHANNEL_DEFINITIONS.filter(({ lifecycle }) => lifecycle === 'reserved');
    expect(reserved.map(({ channel }) => channel).sort()).toEqual(expectedReserved);
    for (const definition of reserved) {
      expect(definition.direction).toBe('outbound-event');
      expect(definition.sourceRoots).toEqual(['electron/preload.ts']);
      expect(definition.reservedReason).toContain(definition.channel);
      expect(definition.reservedReason).toContain('no production main-process emitter');
    }
    for (const definition of IPC_CHANNEL_DEFINITIONS.filter(({ direction, lifecycle }) => direction === 'outbound-event' && lifecycle === 'active')) {
      expect(definition.sourceRoots.some((sourceRoot) => !sourceRoot.includes('preload'))).toBe(true);
      expect(definition.reservedReason).toBeUndefined();
    }
  });

  test.each(BASIC_INVOKE_CHANNELS)('startup fails when basic %s alone is omitted', (omitted) => {
    const ipc = fakeIpc();
    const registry = configuredRegistry(ipc, preloadPath);
    const registrar = registry.forOwner('missing-harness') as unknown as { handle(channel: string, listener: () => null): void };
    for (const channel of EXPOSED_INVOKE_CHANNELS) if (channel !== omitted) registrar.handle(channel, () => null);
    expect(() => registry.assertReady()).toThrow('IPC_STARTUP_HEALTH_FAILED');
    expect(registry.getHealthReport().missing).toEqual([omitted]);
  });

  test.each([
    [IPC_INVOKE.SETTINGS_GET, [], 'argument count'],
    [IPC_INVOKE.SETTINGS_SET, ['language'], 'argument count'],
    [IPC_INVOKE.SETTINGS_GET_ALL, ['extra'], 'argument count'],
    [IPC_INVOKE.SETTINGS_RESET, ['', 'extra'], 'argument count'],
    [IPC_INVOKE.SETTINGS_EXPORT, ['extra'], 'argument count'],
    [IPC_INVOKE.SETTINGS_IMPORT, [''], 'import data'],
    [IPC_INVOKE.FILE_OPEN, [{ filters: [{ name: '', extensions: [] }] }], 'filter'],
    [IPC_INVOKE.FILE_OPEN_MULTIPLE, ['invalid'], 'options'],
    [IPC_INVOKE.FILE_OPEN_DIRECTORY, [{ title: '\u0000' }], 'option'],
    [IPC_INVOKE.FILE_SAVE, [{ filters: [{ name: 'Media', extensions: ['../exe'] }] }], 'extension'],
    [IPC_INVOKE.FILE_EXISTS, [], 'argument count'],
    [IPC_INVOKE.SYSTEM_INFO, ['extra'], 'argument count'],
    [IPC_INVOKE.SYSTEM_GET_BUILD_INFO, ['extra'], 'argument count'],
    [IPC_INVOKE.SYSTEM_GET_IPC_HEALTH, ['extra'], 'argument count'],
  ] as const)('rejects invalid %s arguments', async (channel, args) => {
    const ipc = fakeIpc();
    const registry = configuredRegistry(ipc, preloadPath);
    (registry.forOwner('argument-test') as unknown as { handle(channel: string, listener: () => null): void }).handle(channel, () => null);
    const result = await ipc.handlers.get(channel)!({}, ...args);
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_VALIDATION_FAILED', channel } });
  });

  test.each([
    [IPC_INVOKE.SETTINGS_GET_ALL, []],
    [IPC_INVOKE.SETTINGS_SET, ['language', 'ar']],
    [IPC_INVOKE.SETTINGS_RESET, []],
    [IPC_INVOKE.SETTINGS_EXPORT, 42],
    [IPC_INVOKE.SETTINGS_IMPORT, ['{}']],
    [IPC_INVOKE.FILE_OPEN, 7],
    [IPC_INVOKE.FILE_OPEN_MULTIPLE, [null]],
    [IPC_INVOKE.FILE_OPEN_DIRECTORY, false],
    [IPC_INVOKE.FILE_SAVE, {}],
    [IPC_INVOKE.FILE_EXISTS, 'yes'],
    [IPC_INVOKE.SYSTEM_INFO, { product: 'KNOUX Player X' }],
    [IPC_INVOKE.SYSTEM_GET_BUILD_INFO, { product: 'KNOUX Player X', sha: 'placeholder' }],
    [IPC_INVOKE.SYSTEM_GET_IPC_HEALTH, { schemaVersion: 1, status: 'ready' }],
  ] as const)('rejects invalid %s success values', async (channel, invalidValue) => {
    const ipc = fakeIpc();
    const registry = configuredRegistry(ipc, preloadPath);
    (registry.forOwner('result-test') as unknown as { handle(channel: string, listener: () => unknown): void }).handle(channel, () => invalidValue);
    const validArgs: Record<string, unknown[]> = {
      'settings:set': ['language', 'ar'], 'settings:reset': [], 'settings:import': ['{}'],
      'file:open': [], 'file:open-multiple': [], 'file:open-directory': [], 'file:save': [], 'file:exists': ['C:\\synthetic.mp4'],
    };
    const result = await ipc.handlers.get(channel)!({}, ...(validArgs[channel] ?? []));
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_VALIDATION_FAILED', channel } });
  });

  test('rejects undeclared registration and records handler diagnostics safely', async () => {
    const ipc = fakeIpc();
    const registry = configuredRegistry(ipc, preloadPath);
    const registrar = registry.forOwner('diagnostic') as unknown as { handle(channel: string, listener: () => never): void };
    expect(() => registrar.handle('not:declared', () => { throw new Error('secret-stack'); })).toThrow('IPC_UNDECLARED_CHANNEL');
    registrar.handle(IPC_INVOKE.FILE_EXISTS, () => { throw new Error('synthetic failure'); });
    const result = await ipc.handlers.get(IPC_INVOKE.FILE_EXISTS)!({}, 'C:\\synthetic.mp4');
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_HANDLER_FAILED', message: 'The desktop service could not complete the request.' } });
    expect(registry.diagnosticEvents()).toEqual([expect.objectContaining({ channel: 'file:exists', code: 'IPC_HANDLER_FAILED', owner: 'diagnostic' })]);
  });
});
