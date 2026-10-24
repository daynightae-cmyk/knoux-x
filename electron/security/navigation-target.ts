/**
 * KNOUX-X — pure navigation target predicate (no Electron imports).
 * Kept separate so the policy can be unit-tested in a plain Node process.
 */
import path from 'node:path';

import { isPathWithin } from './validation';

export interface NavigationContext {
  /** Absolute directory that holds the packaged renderer assets. */
  rendererRoot?: string;
  /** Forge dev-server URL; only its origin is trusted. */
  devServerUrl?: string;
}

export function isTrustedNavigationTarget(rawUrl: unknown, context: NavigationContext): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'file:') {
    if (!context.rendererRoot) return false;
    let filePath: string;
    try {
      filePath = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    // /C:/Users/... -> C:/Users/... on Windows file URLs.
    filePath = filePath.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, path.sep);
    return isPathWithin(filePath, context.rendererRoot);
  }
  if (context.devServerUrl) {
    try {
      return url.origin === new URL(context.devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return false;
}
