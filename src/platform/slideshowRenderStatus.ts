/**
 * Records whether the Android slideshow render provider actually installed.
 *
 * `installAndroidSlideshowRenderBridge()` can throw (a WebView without
 * MediaRecorder, for example). The runtime bridge then leaves the honest stub
 * `render: async () => null` in place, and the editor can only say "not
 * implemented". Keeping the real failure message here lets the screen tell the
 * user *why* no provider is running instead of pointing at a console log.
 */

let lastFailure: string | null = null;

export function recordSlideshowBridgeFailure(message: string): void {
  lastFailure = message;
}

export function readSlideshowBridgeFailure(): string | null {
  return lastFailure;
}

export function clearSlideshowBridgeFailure(): void {
  lastFailure = null;
}
