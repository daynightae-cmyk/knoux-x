import fs from 'node:fs';
import path from 'node:path';

export const SECURE_RENDERER_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
});

export function resolveTrustedPreloadPath(): string {
  const preloadPath = path.resolve(__dirname, 'preload-entry.js');
  if (!fs.existsSync(preloadPath) || !fs.statSync(preloadPath).isFile()) {
    throw new Error(`TRUSTED_PRELOAD_MISSING ${preloadPath}`);
  }
  return preloadPath;
}
