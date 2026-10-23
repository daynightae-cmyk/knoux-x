/**
 * Single source of truth for "is the audio engine actually operational?".
 *
 * The renderer used to answer that with `typeof window.knouxAudioToolsAPI?.analyze
 * === 'function'`. On Android that is wrong: the runtime bridge installs a
 * compatibility stub with the same shape whose methods resolve `null`, so a
 * device whose real audio bridge never installed still looked "ready" — picking
 * a file then dereferenced a null probe, and exporting resolved to a null job
 * that the UI read as a silent cancel. A placeholder must never be reported as
 * an operational engine, so the real bridge brands itself and this module is the
 * only place that decides availability.
 */

export type AudioEngineSource = 'electron-ffmpeg' | 'android-local' | 'unavailable';

export type AudioEngineIssue =
  | 'not-installed'
  | 'install-failed'
  | 'fallback-bridge';

export interface AudioEngineStatus {
  available: boolean;
  source: AudioEngineSource;
  issue: AudioEngineIssue | null;
  /** The real underlying message, surfaced verbatim to the user. Never a secret. */
  detail: string | null;
}

/** Brand written onto the object by `installAndroidAudioToolsBridge()`. */
export const ANDROID_AUDIO_ENGINE_BRAND = 'android-local';

interface AudioBridgeShape {
  analyze?: unknown;
  process?: unknown;
  cancel?: unknown;
  jobs?: unknown;
  onProgress?: unknown;
  engine?: unknown;
}

const installFailures = new Map<string, string>();

function isUsable(api: AudioBridgeShape | undefined): api is AudioBridgeShape {
  return Boolean(
    api
    && typeof api.analyze === 'function'
    && typeof api.process === 'function'
    && typeof api.cancel === 'function'
    && typeof api.onProgress === 'function',
  );
}

function unavailable(issue: AudioEngineIssue, detail: string | null): AudioEngineStatus {
  return { available: false, source: 'unavailable', issue, detail };
}

/**
 * Called by the boot sequence when a bridge throws. Recording the message keeps
 * a startup failure from turning into an unexplained disabled button.
 */
export function recordAudioBridgeFailure(message: string): void {
  installFailures.set('audio', message);
}

export const AUDIO_ENGINE_UNAVAILABLE_MESSAGE =
  'The local audio engine is not running on this device. Audio analysis, editing and export are unavailable until the Android audio bridge starts.';

/**
 * The compatibility slot the Android runtime bridge installs before the real
 * engine is layered on top. Every method rejects with the true reason: an object
 * that resolves `null` looks operational to any caller that only checks the
 * method exists, and the failure then surfaces as a type error or a silent
 * "cancelled" export.
 */
export function buildUnavailableAudioBridge(): Record<string, unknown> {
  const reject = (): Promise<never> => Promise.reject(new Error(AUDIO_ENGINE_UNAVAILABLE_MESSAGE));
  return {
    engine: 'unavailable',
    analyze: reject,
    process: reject,
    jobs: reject,
    cancel: reject,
    onProgress: () => () => undefined,
  };
}

export function readAudioEngineStatus(): AudioEngineStatus {
  if (typeof window === 'undefined') {
    return unavailable('not-installed', 'No renderer window is available.');
  }

  const api = window.knouxAudioToolsAPI as unknown as AudioBridgeShape | undefined;
  const edition = window.knouxRuntime?.edition;
  const failure = installFailures.get('audio') ?? null;

  if (failure) return unavailable('install-failed', failure);

  if (edition === 'android') {
    if (!isUsable(api)) return unavailable('not-installed', null);
    // The Android runtime bridge installs a stub with the same method names so
    // unrelated screens keep loading. Only the branded object is the real
    // Web-Audio + LAME engine.
    if (api.engine !== ANDROID_AUDIO_ENGINE_BRAND) return unavailable('fallback-bridge', null);
    return { available: true, source: 'android-local', issue: null, detail: null };
  }

  if (!isUsable(api)) return unavailable('not-installed', null);
  return {
    available: true,
    source: edition === 'web-preview' ? 'unavailable' : 'electron-ffmpeg',
    issue: null,
    detail: null,
  };
}
