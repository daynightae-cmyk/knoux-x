import fs from 'node:fs';
import path from 'node:path';

import { session } from 'electron';

export interface Phase3bAcceptanceRuntimeConfig {
  openQueue: string[];
  savePath: string;
  networkLogPath: string;
}

interface ExternalRequestRecord {
  source: 'electron-session' | 'main-fetch';
  method?: string;
  url: string;
  blocked: true;
}

const CONFIG_PREFIX = '--retouch-phase3b-acceptance-config=';
let cachedConfig: Phase3bAcceptanceRuntimeConfig | null | undefined;
let externalRequests: ExternalRequestRecord[] = [];

function absoluteJsonPathFromArg(): string | null {
  const argument = process.argv.find((value) => value.startsWith(CONFIG_PREFIX));
  if (!argument) return null;
  const candidate = argument.slice(CONFIG_PREFIX.length);
  if (!path.isAbsolute(candidate) || path.extname(candidate).toLowerCase() !== '.json') return null;
  return candidate;
}

function loadConfig(): Phase3bAcceptanceRuntimeConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  cachedConfig = null;
  const configPath = absoluteJsonPathFromArg();
  if (!configPath || !fs.existsSync(configPath)) return cachedConfig;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<Phase3bAcceptanceRuntimeConfig>;
    if (!Array.isArray(parsed.openQueue) || !parsed.openQueue.every((value) => typeof value === 'string' && path.isAbsolute(value))) return cachedConfig;
    if (typeof parsed.savePath !== 'string' || !path.isAbsolute(parsed.savePath)) return cachedConfig;
    if (typeof parsed.networkLogPath !== 'string' || !path.isAbsolute(parsed.networkLogPath)) return cachedConfig;
    cachedConfig = { openQueue: [...parsed.openQueue], savePath: parsed.savePath, networkLogPath: parsed.networkLogPath };
  } catch {
    cachedConfig = null;
  }
  return cachedConfig;
}

function writeNetworkLog(config: Phase3bAcceptanceRuntimeConfig): void {
  fs.mkdirSync(path.dirname(config.networkLogPath), { recursive: true });
  fs.writeFileSync(config.networkLogPath, `${JSON.stringify({
    guardInstalled: true,
    externalRequests,
  }, null, 2)}\n`, 'utf8');
}

function recordExternalRequest(config: Phase3bAcceptanceRuntimeConfig, request: ExternalRequestRecord): void {
  externalRequests = [...externalRequests, request];
  writeNetworkLog(config);
}

export function takePhase3bAcceptanceOpenPath(): string | null {
  const config = loadConfig();
  if (!config) return null;
  return config.openQueue.shift() ?? null;
}

export function getPhase3bAcceptanceSavePath(): string | null {
  return loadConfig()?.savePath ?? null;
}

export function installPhase3bAcceptanceNetworkGuard(): boolean {
  const config = loadConfig();
  if (!config) return false;
  externalRequests = [];
  writeNetworkLog(config);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) {
      recordExternalRequest(config, {
        source: 'electron-session',
        method: details.method,
        url: details.url,
        blocked: true,
      });
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  globalThis.fetch = (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
    recordExternalRequest(config, {
      source: 'main-fetch',
      url: String(args[0]),
      blocked: true,
    });
    return Promise.reject(new Error('Phase 3B acceptance external network is blocked.')) as ReturnType<typeof fetch>;
  };
  return true;
}
