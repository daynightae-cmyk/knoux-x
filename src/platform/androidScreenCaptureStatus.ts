/**
 * Truthful availability reporting for the Android screen capture plugin.
 *
 * `KnouxScreenCapture` is a native Capacitor plugin, so the only honest states
 * are: this is not Android, the plugin never reached the WebView, or the plugin
 * answered and exposes its methods. Nothing here infers capability from the
 * platform alone — a missing plugin must surface as a visible blocker instead
 * of a Start button that silently does nothing.
 */

export type ScreenCapturePlugin = {
  startScreenRecording(options: { width: number; height: number; fps: number; bitrate: number; microphone: boolean }): Promise<{ recording?: boolean }>;
  stopScreenRecording(): Promise<{ recording?: boolean; outputUri?: string | null }>;
  status(): Promise<{ recording?: boolean; outputUri?: string | null }>;
};

export type ScreenCaptureSource = 'plugin' | 'plugin-missing' | 'non-android';

export interface ScreenCaptureStatus {
  available: boolean;
  source: ScreenCaptureSource;
}

function readPlugin(): ScreenCapturePlugin | null {
  if (typeof window === 'undefined') return null;
  const plugin = window.Capacitor?.Plugins?.KnouxScreenCapture as ScreenCapturePlugin | undefined;
  if (!plugin) return null;
  if (
    typeof plugin.startScreenRecording !== 'function'
    || typeof plugin.stopScreenRecording !== 'function'
    || typeof plugin.status !== 'function'
  ) {
    return null;
  }
  return plugin;
}

export function readScreenCaptureStatus(): ScreenCaptureStatus {
  if (typeof window === 'undefined') return { available: false, source: 'non-android' };
  if (window.knouxRuntime?.edition !== 'android') return { available: false, source: 'non-android' };
  return readPlugin() ? { available: true, source: 'plugin' } : { available: false, source: 'plugin-missing' };
}

/** The live plugin, or null when the device cannot capture. */
export function describeScreenCapture(): ScreenCapturePlugin | null {
  if (readScreenCaptureStatus().source === 'non-android') return null;
  return readPlugin();
}
