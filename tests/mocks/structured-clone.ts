import { randomUUID } from 'node:crypto';
import v8 from 'node:v8';

// jsdom gaps that the real Electron/Chromium runtime always provides.
if (typeof (globalThis as unknown as Record<string, unknown>).structuredClone !== 'function') {
  (globalThis as unknown as Record<string, unknown>).structuredClone = <T>(value: T): T =>
    v8.deserialize(v8.serialize(value)) as T;
}

const webCrypto = (globalThis as unknown as Record<string, unknown>).crypto as
  | { randomUUID?: unknown }
  | undefined;
if (webCrypto && typeof webCrypto.randomUUID !== 'function') {
  webCrypto.randomUUID = randomUUID;
}

export {};
