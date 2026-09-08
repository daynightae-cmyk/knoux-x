/**
 * KNOUX X release identity for every surface.
 *
 * Values are baked at bundle build time by vite.renderer.config.ts
 * (__KNOUX_RELEASE__). Nothing here invents a SHA or build timestamp at
 * runtime: unbaked builds report null so every surface can say "unrecorded"
 * instead of faking provenance.
 */

export type ReleaseChannel = 'windows' | 'android' | 'web' | 'dev';

export interface BakedRelease {
  version: string;
  sha: string;
  builtAt: string;
}

export interface ReleaseInfo {
  product: 'Knoux X';
  version: string;
  /** Exact main SHA, or null when the bundle was not release-stamped. */
  sha: string | null;
  /** UTC build timestamp, or null when unstamped. */
  builtAt: string | null;
  channel: ReleaseChannel;
  /** Short 12-char SHA for display, or null. */
  shortSha: string | null;
}

declare const __KNOUX_RELEASE__: BakedRelease | undefined;

function baked(): BakedRelease | null {
  try {
    if (typeof __KNOUX_RELEASE__ !== 'undefined' && __KNOUX_RELEASE__ !== null) {
      return __KNOUX_RELEASE__ as BakedRelease;
    }
  } catch {
    // Bundle was built without release stamping.
  }
  return null;
}

export function detectReleaseChannel(): ReleaseChannel {
  try {
    if (typeof window !== 'undefined' && window.knouxRuntime?.edition === 'android') return 'android';
    if (
      typeof window !== 'undefined' &&
      typeof (window as unknown as { knouxAPI?: unknown }).knouxAPI === 'object' &&
      document.documentElement.dataset.runtime !== 'web-preview'
    ) {
      return 'windows';
    }
    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) return 'web';
  } catch {
    // Channel detection is best-effort.
  }
  return 'dev';
}

export function getReleaseInfo(): ReleaseInfo {
  const stamp = baked();
  const sha = stamp && stamp.sha ? stamp.sha : null;
  return {
    product: 'Knoux X',
    version: (stamp && stamp.version) || 'unrecorded',
    sha,
    builtAt: stamp && stamp.builtAt ? stamp.builtAt : null,
    channel: detectReleaseChannel(),
    shortSha: sha ? sha.slice(0, 12) : null,
  };
}

const GITHUB_OWNER = 'daynightae-cmyk';
const GITHUB_REPO = 'knoux-x';

export function githubLatestReleaseUrl(): string {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
}

export function githubReleasesPageUrl(): string {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
}

export interface GithubReleaseSummary {
  tag: string;
  version: string;
  publishedAt: string | null;
  apkAssetUrl: string | null;
  apkSha256: string | null;
  versionCode: number | null;
  manifestUrl: string | null;
}

function releaseAssetUrl(assets: Array<{ name?: string; browser_download_url?: string }>, predicate: (name: string) => boolean): string | null {
  const found = assets.find((asset) => predicate(String(asset.name || '')));
  return found?.browser_download_url ?? null;
}

export function summarizeGithubRelease(payload: unknown): GithubReleaseSummary | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as {
    tag_name?: unknown;
    published_at?: unknown;
    assets?: unknown;
  };
  if (typeof record.tag_name !== 'string') return null;
  const assets = Array.isArray(record.assets) ? record.assets as Array<{ name?: string; browser_download_url?: string }> : [];
  const manifestUrl = releaseAssetUrl(assets, (name) => name.endsWith('-release.json'));
  const apkAssetUrl = releaseAssetUrl(assets, (name) => name.endsWith('-android.apk'));
  return {
    tag: record.tag_name,
    version: record.tag_name.replace(/^v/, ''),
    publishedAt: typeof record.published_at === 'string' ? record.published_at : null,
    apkAssetUrl,
    apkSha256: null,
    versionCode: null,
    manifestUrl,
  };
}

/** Read the authoritative Android versionCode out of a release manifest. */
export function manifestAndroidVersionCode(manifest: Record<string, unknown> | null): number | null {
  const android = manifest?.android;
  if (!android || typeof android !== 'object') return null;
  const code = (android as { versionCode?: unknown }).versionCode;
  return typeof code === 'number' && Number.isSafeInteger(code) ? code : null;
}

export function manifestAndroidSha256(manifest: Record<string, unknown> | null): string | null {
  const android = manifest?.android;
  if (!android || typeof android !== 'object') return null;
  const sha = (android as { sha256?: unknown }).sha256;
  return typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha) ? sha : null;
}

export async function fetchLatestReleaseManifest(manifestUrl: string, timeoutMs = 15000): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(manifestUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
