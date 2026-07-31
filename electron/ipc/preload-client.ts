import { ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  type IpcInboundChannel,
  type IpcInvokeChannel,
  type IpcOutboundChannel,
  type InboundPayload,
  type InvokeArguments,
  type InvokeResult,
  type IpcResult,
  type OutboundPayload,
} from './contract';

const MAX_ERROR_MESSAGE = 512;

export class DesktopIpcError extends Error {
  public readonly code: string;
  public readonly channel: string;
  public readonly detail?: string;

  constructor(code: string, channel: string, message: string, detail?: string) {
    super(message.slice(0, MAX_ERROR_MESSAGE));
    this.name = 'DesktopIpcError';
    this.code = code;
    this.channel = channel;
    this.detail = detail;
  }
}

function isResultEnvelope(value: unknown): value is IpcResult<unknown> {
  if (!value || typeof value !== 'object' || !('ok' in value)) return false;
  if ((value as { ok?: unknown }).ok === true) return 'value' in value;
  const error = (value as { error?: unknown }).error;
  return (value as { ok?: unknown }).ok === false
    && Boolean(error && typeof error === 'object' && 'code' in error && 'channel' in error && 'message' in error);
}

export async function invokeDesktop<
  C extends IpcInvokeChannel,
  T extends InvokeResult<C> = InvokeResult<C>,
>(channel: C, ...args: InvokeArguments<C>): Promise<T> {
  let response: unknown;
  try {
    response = await ipcRenderer.invoke(channel, ...args);
  } catch {
    throw new DesktopIpcError('IPC_TRANSPORT_FAILURE', channel, `Desktop service ${channel} could not be reached.`);
  }
  if (!isResultEnvelope(response)) {
    throw new DesktopIpcError('IPC_PROTOCOL_FAILURE', channel, `Desktop service ${channel} returned an invalid response.`);
  }
  if (!response.ok) {
    throw new DesktopIpcError(response.error.code, response.error.channel, response.error.message, response.error.detail);
  }
  return response.value as T;
}

export function sendDesktop<C extends IpcInboundChannel>(channel: C, ...args: InboundPayload<C>): void {
  ipcRenderer.send(channel, ...args);
}

export function onDesktop<C extends IpcOutboundChannel>(
  channel: C,
  callback: (...args: OutboundPayload<C>) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => callback(...args as OutboundPayload<C>);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

export type DesktopEventListener = { listen(event: IpcRendererEvent, ...args: never[]): void }['listen'];

export function onDesktopEvent<C extends IpcOutboundChannel>(channel: C, listener: (event: IpcRendererEvent, ...args: OutboundPayload<C>) => void): void {
  ipcRenderer.on(channel, listener as Parameters<typeof ipcRenderer.on>[1]);
}

export function offDesktopEvent<C extends IpcOutboundChannel>(channel: C, listener: (event: IpcRendererEvent, ...args: OutboundPayload<C>) => void): void {
  ipcRenderer.removeListener(channel, listener as Parameters<typeof ipcRenderer.removeListener>[1]);
}
