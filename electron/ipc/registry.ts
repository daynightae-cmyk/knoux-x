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
} from './contract';

type InvokeHandler = { invoke(event: IpcMainInvokeEvent, ...args: unknown[]): unknown }['invoke'];
type InboundListener = { listen(event: IpcMainEvent, ...args: unknown[]): void }['listen'];

export interface IpcRegistrar {
  handle(channel: IpcInvokeChannel, listener: InvokeHandler): void;
  on(channel: IpcInboundChannel, listener: InboundListener): void;
  removeListener(channel: IpcInboundChannel, listener: InboundListener): void;
  send(contents: WebContents, channel: IpcOutboundChannel, ...args: unknown[]): void;
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

function validateBasicArguments(channel: IpcInvokeChannel, args: unknown[]): void {
  if (channel === 'settings:get' || channel === 'settings:set') {
    if (typeof args[0] !== 'string' || args[0].length === 0 || args[0].length > 128) throw new TypeError('Settings key is invalid.');
  }
  if (channel === 'settings:import' && (typeof args[0] !== 'string' || args[0].length === 0)) throw new TypeError('Settings import data is invalid.');
  if (channel === 'file:exists' && (typeof args[0] !== 'string' || args[0].length === 0 || args[0].length > 4096 || args[0].includes('\u0000'))) {
    throw new TypeError('File path is invalid.');
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
  if (channel === 'settings:export' && typeof value !== 'string') throw new TypeError('settings:export returned an invalid result.');
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

  private registerHandler(channel: IpcInvokeChannel, owner: string, listener: InvokeHandler): void {
    if (!EXPOSED_INVOKE_CHANNELS.includes(channel)) throw new Error(`IPC_UNDECLARED_CHANNEL ${channel}`);
    const existing = this.handlers.get(channel);
    if (existing) {
      this.duplicates.push({ channel, owner: `${existing.owner} -> ${owner}`, count: 2 });
      throw new Error(`IPC_DUPLICATE_HANDLER ${channel} owned by ${existing.owner} and ${owner}`);
    }
    this.handlers.set(channel, { owner, listener });
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

  private registerListener(channel: IpcInboundChannel, owner: string, listener: InboundListener): void {
    const existing = this.listeners.get(channel);
    if (existing) {
      this.duplicates.push({ channel, owner: `${existing.owner} -> ${owner}`, count: 2, active: true });
      throw new Error(`IPC_DUPLICATE_LISTENER ${channel} owned by ${existing.owner} and ${owner}`);
    }
    const wrapped: InboundListener = (event, ...args) => Reflect.apply(listener, undefined, [event, ...args]);
    this.listeners.set(channel, { owner, original: listener, wrapped });
    this.ipc.on(channel, wrapped as Parameters<IpcMain['on']>[1]);
  }

  private removeRegisteredListener(channel: IpcInboundChannel, owner: string, listener: InboundListener): void {
    const existing = this.listeners.get(channel);
    if (!existing || existing.owner !== owner || existing.original !== listener) return;
    this.ipc.removeListener(channel, existing.wrapped as Parameters<IpcMain['removeListener']>[1]);
    this.listeners.delete(channel);
  }

  private send(contents: WebContents, channel: IpcOutboundChannel, ...args: unknown[]): void {
    if (contents.isDestroyed()) return;
    contents.send(channel, ...args);
  }
}
