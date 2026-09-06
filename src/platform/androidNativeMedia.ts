export type AndroidPlaybackSnapshot = {
  title: string;
  playing: boolean;
  position: number;
  duration: number;
};

type NativeMediaPlugin = {
  enterPictureInPicture(options: { width: number; height: number }): Promise<{ entered?: boolean }>;
  updatePlayback(snapshot: AndroidPlaybackSnapshot): Promise<{ active?: boolean }>;
  stopPlayback(): Promise<{ active?: boolean }>;
};

function nativeMediaPlugin(): NativeMediaPlugin | null {
  if (window.knouxRuntime?.edition !== 'android') return null;
  const plugin = window.Capacitor?.Plugins?.KnouxMediaSession;
  return plugin ?? null;
}

export function androidNativeMediaAvailable(): boolean {
  return nativeMediaPlugin() !== null;
}

export async function enterAndroidPictureInPicture(width: number, height: number): Promise<boolean> {
  const plugin = nativeMediaPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.enterPictureInPicture({
      width: Math.max(1, Math.round(width || 16)),
      height: Math.max(1, Math.round(height || 9)),
    });
    return result.entered === true;
  } catch {
    return false;
  }
}

export async function syncAndroidMediaSession(snapshot: AndroidPlaybackSnapshot): Promise<boolean> {
  const plugin = nativeMediaPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.updatePlayback({
      title: snapshot.title.slice(0, 240),
      playing: snapshot.playing,
      position: Math.max(0, Number.isFinite(snapshot.position) ? snapshot.position : 0),
      duration: Math.max(0, Number.isFinite(snapshot.duration) ? snapshot.duration : 0),
    });
    return result.active !== false;
  } catch {
    return false;
  }
}

export async function stopAndroidMediaSession(): Promise<void> {
  const plugin = nativeMediaPlugin();
  if (!plugin) return;
  try {
    await plugin.stopPlayback();
  } catch {
    // Native media integration is best-effort; playback remains usable in the WebView.
  }
}
