/**
 * KNOUX-X — RENDERER NAVIGATION POLICY (directive §5)
 *
 * The secure preload boundary only means something if the window can never be
 * navigated to foreign content. This policy:
 *   - allows top-level navigation only inside the packaged renderer directory
 *     (or the Forge dev-server origin during development);
 *   - never lets the renderer create windows; validated https/mailto links are
 *     handed to the OS default browser instead.
 */
import path from 'node:path';

import { shell, type WebContents } from 'electron';

import { isTrustedNavigationTarget, type NavigationContext } from './security/navigation-target';
import { validateExternalUrl } from './security/validation';

export { isTrustedNavigationTarget };
export type { NavigationContext };

/** The packaged-app context; all main-bundle modules share this __dirname. */
export function rendererNavigationContext(devServerUrl?: string): NavigationContext {
  return {
    rendererRoot: path.join(__dirname, '..', 'renderer'),
    devServerUrl,
  };
}

export function applyNavigationPolicy(contents: WebContents, context: NavigationContext): void {
  contents.setWindowOpenHandler(({ url }) => {
    try {
      // https/mailto only, no embedded credentials; anything else is denied.
      const external = validateExternalUrl(url);
      void shell.openExternal(external.toString());
    } catch {
      /* Deny silently: the renderer must not learn whether a URL was valid. */
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedNavigationTarget(targetUrl, context)) event.preventDefault();
  });
}
