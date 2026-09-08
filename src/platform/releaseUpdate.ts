/**
 * KNOUX X release-update discovery shared by Windows, Android and Web.
 *
 * Windows packaged builds use the native electron-updater bridge
 * (window.knouxAPI.update). Everywhere else the public GitHub Release feed is
 * consulted with honest offline handling: no silent installs, no fake state.
 */
import {
  fetchLatestReleaseManifest,
  getReleaseInfo,
  githubLatestReleaseUrl,
  githubReleasesPageUrl,
  manifestAndroidSha256,
  manifestAndroidVersionCode,
  summarizeGithubRelease,
} from '../releaseInfo';

export type ReleaseUpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'error'
  | 'unsupported';

export interface ReleaseUpdateState {
  phase: ReleaseUpdatePhase;
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string | null;
  sha256: string | null;
  detail: string | null;
  checkedAt: string | null;
}

const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'knoux.releaseUpdate.lastCheck';
const FETCH_TIMEOUT_MS = 15000;

export function parseSemver(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Returns true when `latest` is strictly newer than `current`. */
export function isNewerRelease(current: string, latest: string): boolean {
  const currentParts = parseSemver(current);
  const latestParts = parseSemver(latest);
  if (!currentParts || !latestParts) return false;
  for (let index = 0; index < 3; index += 1) {
    if (latestParts[index] > currentParts[index]) return true;
    if (latestParts[index] < currentParts[index]) return false;
  }
  return false;
}

export function shouldAutoCheck(lastCheckedAt: string | null, nowMs = Date.now()): boolean {
  if (!lastCheckedAt) return true;
  const parsed = Date.parse(lastCheckedAt);
  if (!Number.isFinite(parsed)) return true;
  return nowMs - parsed >= AUTO_CHECK_INTERVAL_MS;
}

function writeLastCheck(value: string): void {
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, value);
  } catch {
    // Throttling is best-effort.
  }
}

export function hasNativeUpdater(): boolean {
  try {
    return typeof window.knouxAPI?.update?.check === 'function'
      && getReleaseInfo().channel === 'windows';
  } catch {
    return false;
  }
}

async function fetchGithubLatest(): Promise<ReturnType<typeof summarizeGithubRelease>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(githubLatestReleaseUrl(), {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Release feed answered ${response.status}.`);
    return summarizeGithubRelease(await response.json());
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Check the public release feed against the running build. Android additionally
 * resolves the manifest for an authoritative versionCode + APK checksum.
 */
export async function checkManifestForUpdate(): Promise<ReleaseUpdateState> {
  const release = getReleaseInfo();
  const idle: ReleaseUpdateState = {
    phase: 'checking',
    currentVersion: release.version,
    latestVersion: null,
    downloadUrl: null,
    sha256: null,
    detail: null,
    checkedAt: new Date().toISOString(),
  };
  try {
    const summary = await fetchGithubLatest();
    if (!summary) {
      return { ...idle, phase: 'error', detail: 'No published release was found.' };
    }
    if (!isNewerRelease(release.version, summary.version)) {
      writeLastCheck(idle.checkedAt ?? new Date().toISOString());
      return { ...idle, phase: 'current', latestVersion: summary.version };
    }
    let downloadUrl: string | null = null;
    let sha256: string | null = null;
    if (release.channel === 'android') {
      const manifest = summary.manifestUrl ? await fetchLatestReleaseManifest(summary.manifestUrl) : null;
      const latestCode = manifestAndroidVersionCode(manifest);
      const currentParts = parseSemver(release.version);
      const currentCode = currentParts ? currentParts[0] * 10000 + currentParts[1] * 100 + currentParts[2] : null;
      // Authoritative check is versionCode; semver decides when unstamped.
      if (latestCode !== null && currentCode !== null && latestCode <= currentCode) {
        writeLastCheck(idle.checkedAt ?? new Date().toISOString());
        return { ...idle, phase: 'current', latestVersion: summary.version };
      }
      downloadUrl = summary.apkAssetUrl;
      sha256 = manifestAndroidSha256(manifest);
      if (!downloadUrl) {
        return { ...idle, phase: 'available', latestVersion: summary.version, detail: 'The APK asset is missing from the latest release.' };
      }
    } else {
      downloadUrl = githubReleasesPageUrl();
    }
    writeLastCheck(idle.checkedAt ?? new Date().toISOString());
    return { ...idle, phase: 'available', latestVersion: summary.version, downloadUrl, sha256 };
  } catch (error) {
    const offline = error instanceof Error && (error.name === 'AbortError' || /network|fetch|failed/i.test(error.message));
    return {
      ...idle,
      phase: 'error',
      detail: offline ? 'Update check needs an internet connection.' : (error instanceof Error ? error.message : 'Update check failed.'),
    };
  }
}

export function openReleaseDownload(url: string | null): void {
  const target = url ?? githubReleasesPageUrl();
  // '_system' opens the platform browser/installer flow on Android; browsers
  // ignore the target and open a new tab. Never silently installs.
  window.open(target, '_system');
}
