import fs from 'node:fs';
import path from 'node:path';

import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from 'electron';

import {
  BASIC_INVOKE_CHANNELS,
  EXPOSED_INVOKE_CHANNELS,
  IPC_CHANNEL_DEFINITIONS,
  type BuildIdentity,
  type IpcFailure,
  type IpcInboundChannel,
  type IpcInvokeChannel,
  type IpcOutboundChannel,
  type IpcResult,
  type OutboundPayload,
  type TypedInboundListener,
  type TypedInvokeHandler,
} from './contract';

type InvokeHandler = { invoke(event: IpcMainInvokeEvent, ...args: unknown[]): unknown }['invoke'];
type InboundListener = { listen(event: IpcMainEvent, ...args: unknown[]): void }['listen'];

export interface IpcRegistrar {
  handle<C extends IpcInvokeChannel>(channel: C, listener: TypedInvokeHandler<C>): void;
  on<C extends IpcInboundChannel>(channel: C, listener: TypedInboundListener<C>): void;
  removeListener<C extends IpcInboundChannel>(channel: C, listener: TypedInboundListener<C>): void;
  send<C extends IpcOutboundChannel>(contents: WebContents, channel: C, ...args: OutboundPayload<C>): void;
}

export interface IpcRegistrationRecord {
  channel: string;
  owner: string;
  count: number;
  active?: boolean;
}

export interface IpcHealthReport {
  schemaVersion: 1;
  status: 'ready' | 'failed';
  exposed: string[];
  registered: IpcRegistrationRecord[];
  listeners: IpcRegistrationRecord[];
  missing: string[];
  duplicates: IpcRegistrationRecord[];
  preloadPath: string;
  preloadExists: boolean;
  packaged: boolean;
  version: string;
  sha: string;
  branch: string;
  buildTimestamp: string;
  electronVersion: string;
}

export interface IpcDiagnosticEvent {
  at: string;
  channel: string;
  code: string;
  owner: string;
  detail: string;
}

function safeDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 1024);
  return String(error).slice(0, 1024);
}

function classifyFailure(channel: string, error: unknown): IpcFailure {
  const validation = error instanceof TypeError || error instanceof RangeError;
  return {
    code: validation ? 'IPC_VALIDATION_FAILED' : 'IPC_HANDLER_FAILED',
    channel,
    message: validation ? 'The desktop request was invalid.' : 'The desktop service could not complete the request.',
    detail: safeDetail(error),
  };
}

function assertArgumentCount(channel: string, args: unknown[], minimum: number, maximum = minimum): void {
  if (args.length < minimum || args.length > maximum) throw new TypeError(`${channel} received an invalid argument count.`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSafeString(value: unknown, maximum = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\u0000');
}

function validateDialogOptions(channel: string, args: unknown[]): void {
  assertArgumentCount(channel, args, 0, 1);
  if (args.length === 0 || args[0] === undefined) return;
  if (!isPlainRecord(args[0])) throw new TypeError(`${channel} dialog options are invalid.`);
  const options = args[0];
  for (const key of ['title', 'defaultPath', 'buttonLabel'] as const) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || String(options[key]).length > 4096 || String(options[key]).includes('\u0000'))) {
      throw new TypeError(`${channel} dialog option ${key} is invalid.`);
    }
  }
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters) || options.filters.length > 32) throw new TypeError(`${channel} dialog filters are invalid.`);
    for (const filter of options.filters) {
      if (!isPlainRecord(filter) || !isSafeString(filter.name, 128) || !Array.isArray(filter.extensions) || filter.extensions.length === 0 || filter.extensions.length > 64) {
        throw new TypeError(`${channel} dialog filter is invalid.`);
      }
      if (filter.extensions.some((extension) => typeof extension !== 'string' || !/^(\*|[a-z0-9]{1,12})$/i.test(extension))) throw new TypeError(`${channel} dialog extension is invalid.`);
    }
  }
}

function isBuildIdentity(value: unknown): value is BuildIdentity {
  if (!isPlainRecord(value)) return false;
  return value.product === 'KNOUX Player X'
    && isSafeString(value.version, 128)
    && typeof value.sha === 'string' && /^[0-9a-f]{40}$/i.test(value.sha)
    && isSafeString(value.branch, 512)
    && typeof value.builtAt === 'string' && Number.isFinite(Date.parse(value.builtAt))
    && typeof value.packaged === 'boolean'
    && isSafeString(value.electronVersion, 128);
}

function isHealthReport(value: unknown): value is IpcHealthReport {
  if (!isPlainRecord(value)) return false;
  const registrationsValid = (entries: unknown): boolean => Array.isArray(entries) && entries.every((entry) => (
    isPlainRecord(entry) && isSafeString(entry.channel, 256) && isSafeString(entry.owner, 256) && Number.isInteger(entry.count) && Number(entry.count) >= 0
  ));
  return value.schemaVersion === 1
    && (value.status === 'ready' || value.status === 'failed')
    && Array.isArray(value.exposed) && value.exposed.every((entry) => typeof entry === 'string')
    && registrationsValid(value.registered)
    && registrationsValid(value.listeners)
    && Array.isArray(value.missing) && value.missing.every((entry) => typeof entry === 'string')
    && registrationsValid(value.duplicates)
    && isSafeString(value.preloadPath, 32767)
    && typeof value.preloadExists === 'boolean'
    && typeof value.packaged === 'boolean'
    && isSafeString(value.version, 128)
    && typeof value.sha === 'string' && /^[0-9a-f]{40}$/i.test(value.sha)
    && isSafeString(value.branch, 512)
    && typeof value.buildTimestamp === 'string' && Number.isFinite(Date.parse(value.buildTimestamp))
    && isSafeString(value.electronVersion, 128);
}

function validateBasicArguments(channel: IpcInvokeChannel, args: unknown[]): void {
  switch (channel) {
    case 'settings:get':
      assertArgumentCount(channel, args, 1, 2);
      if (!isSafeString(args[0], 128)) throw new TypeError('Settings key is invalid.');
      return;
    case 'settings:set':
      assertArgumentCount(channel, args, 2);
      if (!isSafeString(args[0], 128)) throw new TypeError('Settings key is invalid.');
      try { structuredClone(args[1]); } catch { throw new TypeError('Settings value is not serializable.'); }
      return;
    case 'settings:get-all':
    case 'settings:export':
    case 'system:info':
    case 'system:get-build-info':
    case 'system:get-ipc-health':
      assertArgumentCount(channel, args, 0);
      return;
    case 'settings:reset':
      assertArgumentCount(channel, args, 0, 1);
      if (args[0] !== undefined && !isSafeString(args[0], 128)) throw new TypeError('Settings reset key is invalid.');
      return;
    case 'settings:import':
      assertArgumentCount(channel, args, 1);
      if (!isSafeString(args[0], 16 * 1024 * 1024)) throw new TypeError('Settings import data is invalid.');
      return;
    case 'file:open':
    case 'file:open-multiple':
    case 'file:open-directory':
    case 'file:save':
      validateDialogOptions(channel, args);
      return;
    case 'file:exists':
      assertArgumentCount(channel, args, 1);
      if (!isSafeString(args[0], 4096)) throw new TypeError('File path is invalid.');
      return;
  }
}

function validateBasicResult(channel: IpcInvokeChannel, value: unknown): void {
  if ((channel === 'file:open' || channel === 'file:open-directory' || channel === 'file:save') && value !== null && typeof value !== 'string') {
    throw new TypeError(`${channel} returned an invalid path result.`);
  }
  if (channel === 'file:open-multiple' && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) {
    throw new TypeError('file:open-multiple returned an invalid path list.');
  }
  if (channel === 'file:exists' && typeof value !== 'boolean') throw new TypeError('file:exists returned an invalid result.');
  if (channel === 'settings:get') {
    try { structuredClone(value); } catch { throw new TypeError('settings:get returned a non-serializable result.'); }
  }
  if (channel === 'settings:get-all' && !isPlainRecord(value)) throw new TypeError('settings:get-all returned an invalid settings object.');
  if (channel === 'settings:export' && !isSafeString(value, 16 * 1024 * 1024)) throw new TypeError('settings:export returned an invalid document.');
  if (['settings:set', 'settings:reset', 'settings:import'].includes(channel) && value !== undefined) throw new TypeError(`${channel} returned an invalid non-void result.`);
  if (channel === 'system:get-build-info' && !isBuildIdentity(value)) throw new TypeError('system:get-build-info returned an invalid identity.');
  if (channel === 'system:info') {
    if (!isBuildIdentity(value) || !isPlainRecord(value) || !isSafeString(value.platform, 128) || !isSafeString(value.arch, 128) || !isSafeString(value.chromeVersion, 128) || !isSafeString(value.nodeVersion, 128)) {
      throw new TypeError('system:info returned an invalid system identity.');
    }
  }
  if (channel === 'system:get-ipc-health' && !isHealthReport(value)) throw new TypeError('system:get-ipc-health returned an invalid health report.');
}

export class AuthoritativeIpcRegistry {
  private readonly handlers = new Map<IpcInvokeChannel, { owner: string; listener: InvokeHandler }>();
  private readonly listeners = new Map<IpcInboundChannel, { owner: string; original: InboundListener; wrapped: InboundListener }>();
  private readonly duplicates: IpcRegistrationRecord[] = [];
  private readonly diagnostics: IpcDiagnosticEvent[] = [];
  private preloadPath = '';
  private identity: BuildIdentity | null = null;
  private trustedSender: ((event: IpcMainInvokeEvent) => boolean) | null = null;

  constructor(private readonly ipc: Pick<IpcMain, 'handle' | 'on' | 'removeListener'>) {}

  public forOwner(owner: string): IpcRegistrar {
    if (!owner.trim()) throw new TypeError('IPC owner is required.');
    return {
      handle: (channel, listener) => this.registerHandler(channel, owner, listener),
      on: (channel, listener) => this.registerListener(channel, owner, listener),
      removeListener: (channel, listener) => this.removeRegisteredListener(channel, owner, listener),
      send: (contents, channel, ...args) => this.send(contents, channel, ...args),
    };
  }

  public configureStartup(preloadPath: string, identity: BuildIdentity): void {
    if (!path.isAbsolute(preloadPath)) throw new TypeError('Desktop preload path must be absolute.');
    this.preloadPath = path.resolve(preloadPath);
    this.identity = { ...identity };
  }

  public configureTrustedSender(predicate: (event: IpcMainInvokeEvent) => boolean): void {
    this.trustedSender = predicate;
  }

  public getHealthReport(): IpcHealthReport {
    if (!this.identity) throw new Error('IPC startup identity is not configured.');
    const exposed = [...EXPOSED_INVOKE_CHANNELS].sort();
    const registered = [...this.handlers.entries()]
      .map(([channel, entry]) => ({ channel, owner: entry.owner, count: 1 }))
      .sort((left, right) => left.channel.localeCompare(right.channel));
    const listeners = IPC_CHANNEL_DEFINITIONS
      .filter((definition) => definition.direction === 'inbound-listener')
      .map((definition) => {
        const active = this.listeners.get(definition.channel as IpcInboundChannel);
        return { channel: definition.channel, owner: active?.owner ?? definition.owner, count: active ? 1 : 0, active: Boolean(active) };
      })
      .sort((left, right) => left.channel.localeCompare(right.channel));
    const missing = exposed.filter((channel) => !this.handlers.has(channel as IpcInvokeChannel));
    const preloadExists = fs.existsSync(this.preloadPath) && fs.statSync(this.preloadPath).isFile();
    const failed = missing.length > 0 || this.duplicates.length > 0 || !preloadExists;
    return {
      schemaVersion: 1,
      status: failed ? 'failed' : 'ready',
      exposed,
      registered,
      listeners,
      missing,
      duplicates: [...this.duplicates].sort((left, right) => left.channel.localeCompare(right.channel)),
      preloadPath: this.preloadPath,
      preloadExists,
      packaged: this.identity.packaged,
      version: this.identity.version,
      sha: this.identity.sha,
      branch: this.identity.branch,
      buildTimestamp: this.identity.builtAt,
      electronVersion: this.identity.electronVersion,
    };
  }

  public assertReady(): IpcHealthReport {
    const report = this.getHealthReport();
    const missingBasic = BASIC_INVOKE_CHANNELS.filter((channel) => report.missing.includes(channel));
    if (report.status !== 'ready' || missingBasic.length > 0) {
      throw new Error(`IPC_STARTUP_HEALTH_FAILED ${JSON.stringify({ ...report, missingBasic })}`);
    }
    return report;
  }

  public manifest(): Array<Record<string, unknown>> {
    return IPC_CHANNEL_DEFINITIONS.map((definition) => {
      const handler = definition.direction === 'invoke' ? this.handlers.get(definition.channel as IpcInvokeChannel) : undefined;
      const listener = definition.direction === 'inbound-listener' ? this.listeners.get(definition.channel as IpcInboundChannel) : undefined;
      return {
        ...definition,
        registrationCount: definition.direction === 'invoke' ? (handler ? 1 : 0) : definition.direction === 'inbound-listener' ? (listener ? 1 : 0) : null,
        registeredOwner: handler?.owner ?? listener?.owner ?? null,
      };
    });
  }

  public diagnosticEvents(): IpcDiagnosticEvent[] {
    return this.diagnostics.map((event) => ({ ...event }));
  }

  private registerHandler<C extends IpcInvokeChannel>(channel: C, owner: string, listener: TypedInvokeHandler<C>): void {
    if (!EXPOSED_INVOKE_CHANNELS.includes(channel)) throw new Error(`IPC_UNDECLARED_CHANNEL ${channel}`);
    const existing = this.handlers.get(channel);
    if (existing) {
      this.duplicates.push({ channel, owner: `${existing.owner} -> ${owner}`, count: 2 });
      throw new Error(`IPC_DUPLICATE_HANDLER ${channel} owned by ${existing.owner} and ${owner}`);
    }
    this.handlers.set(channel, { owner, listener: listener as InvokeHandler });
    this.ipc.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
      try {
        if (!this.trustedSender || !this.trustedSender(event)) throw new Error('IPC request was rejected from an untrusted renderer.');
        validateBasicArguments(channel, args);
        const value = await Reflect.apply(listener, undefined, [event, ...args]);
        validateBasicResult(channel, value);
        return { ok: true, value };
      } catch (error) {
        const failure = classifyFailure(channel, error);
        this.diagnostics.push({ at: new Date().toISOString(), channel, code: failure.code, owner, detail: failure.detail ?? failure.message });
        return { ok: false, error: failure };
      }
    });
  }

  private registerListener<C extends IpcInboundChannel>(channel: C, owner: string, listener: TypedInboundListener<C>): void {
    const existing = this.listeners.get(channel);
    if (existing) {
      this.duplicates.push({ channel, owner: `${existing.owner} -> ${owner}`, count: 2, active: true });
      throw new Error(`IPC_DUPLICATE_LISTENER ${channel} owned by ${existing.owner} and ${owner}`);
    }
    const original = listener as InboundListener;
    const wrapped: InboundListener = (event, ...args) => Reflect.apply(original, undefined, [event, ...args]);
    this.listeners.set(channel, { owner, original, wrapped });
    this.ipc.on(channel, wrapped as Parameters<IpcMain['on']>[1]);
  }

  private removeRegisteredListener<C extends IpcInboundChannel>(channel: C, owner: string, listener: TypedInboundListener<C>): void {
    const existing = this.listeners.get(channel);
    if (!existing || existing.owner !== owner || existing.original !== listener as InboundListener) return;
    this.ipc.removeListener(channel, existing.wrapped as Parameters<IpcMain['removeListener']>[1]);
    this.listeners.delete(channel);
  }

  private send<C extends IpcOutboundChannel>(contents: WebContents, channel: C, ...args: OutboundPayload<C>): void {
    if (contents.isDestroyed()) return;
    contents.send(channel, ...args);
  }
}
