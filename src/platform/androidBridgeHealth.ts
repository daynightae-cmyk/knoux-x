/**
 * Android bridge health registry (directive §16.4, §17, §20.2).
 *
 * Every Android capability in the WebView is installed by its own bridge. A
 * bridge can fail in three genuinely different ways — it installed, the native
 * plugin it depends on is absent from this build, or it threw while installing
 * — and until now the first two looked identical from the outside. Screens
 * that then advertised a capability had nothing truthful to point at.
 *
 * This module records the real outcome per bridge so a diagnostics surface can
 * state it. It is deliberately in-memory only: it never touches storage, never
 * records media paths, keys, or PINs.
 */

export type AndroidBridgeState = 'ready' | 'absent' | 'failed';

export type AndroidBridgeRecord = {
  name: string;
  state: AndroidBridgeState;
  detail: string | null;
};

/** Canonical install order used by src/main.tsx, for stable reporting. */
export const ANDROID_BRIDGE_NAMES = [
  'file',
  'saf',
  'capture',
  'audio-tools',
  'image-editor',
  'retouch-models',
  'multitrack-export',
  'slideshow-render',
  'back-button',
] as const;

const records = new Map<string, AndroidBridgeRecord>();

function write(name: string, state: AndroidBridgeState, detail: string | null): void {
  records.set(name, { name, state, detail });
}

/**
 * Called by a bridge that decided for itself that the capability is not
 * present in this build (for example the native SAF plugin is missing).
 */
export function markAndroidBridgeAbsent(name: string, detail: string): void {
  write(name, 'absent', detail);
}

/**
 * Called by a bridge that could not be installed at all. The message is the
 * real thrown reason, never a placeholder.
 */
export function markAndroidBridgeFailed(name: string, detail: string): void {
  write(name, 'failed', detail);
}

/**
 * Called by the installer after a bridge ran without throwing. A bridge that
 * already recorded a worse outcome keeps it, so "absent" is never overwritten
 * by the optimistic default.
 */
export function markAndroidBridgeReady(name: string): void {
  if (records.has(name)) return;
  write(name, 'ready', null);
}

export function readAndroidBridge(name: string): AndroidBridgeRecord {
  return records.get(name) ?? { name, state: 'absent', detail: 'This build never attempted the bridge.' };
}

export function readAndroidBridgeHealth(): AndroidBridgeRecord[] {
  const known = new Set<string>(ANDROID_BRIDGE_NAMES);
  const extra = [...records.keys()].filter((name) => !known.has(name));
  return [...ANDROID_BRIDGE_NAMES, ...extra].map((name) => readAndroidBridge(name));
}

/** Test-only: the registry is module state, so suites must be able to reset it. */
export function resetAndroidBridgeHealth(): void {
  records.clear();
}
