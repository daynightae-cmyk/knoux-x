export type VaultIndexState = 'ok' | 'recovered' | 'corrupted' | 'unavailable' | 'locked' | 'missing';
export type VaultKeySecurityLevel = 'strongbox' | 'trusted-environment' | 'software' | 'unknown' | 'unavailable';

export interface VaultStatus {
  created: boolean;
  locked: boolean;
  keyAvailable: boolean;
  lockedOutForMs: number;
  itemCount: number;
  /* What the device actually reports for the Keystore key. "software" and
   * "unknown" are real answers and must be shown as such. */
  indexState: VaultIndexState;
  indexBackupHealthy: boolean;
  keySecurityAvailable: boolean;
  keySecurityLevel: VaultKeySecurityLevel;
  keyHardwareBacked: boolean;
  plaintextCacheFiles: number;
  plaintextCacheFailures: number;
}

export interface VaultItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  duration: number;
  createdAt: number;
  hasThumbnail: boolean;
}

export interface VaultMethods {
  vaultStatus(): Promise<VaultStatus>;
  vaultCreate(options: { pin: string }): Promise<{ token: string; createdAt: number }>;
  vaultUnlock(options: { pin: string }): Promise<{ token: string; items: VaultItem[]; indexRecovered: boolean }>;
  vaultLock(): Promise<{ cachedPlaintextRemoved: number; cachedPlaintextRetained: number }>;
  vaultHold(options: { token: string; hold: boolean }): Promise<void>;
  vaultChangePin(options: { token: string; newPin: string }): Promise<{ changed: boolean }>;
  vaultList(options: { token: string }): Promise<{ items: VaultItem[]; indexRecovered: boolean }>;
  vaultImport(options: { token: string; uri: string; name: string; mime: string }): Promise<{ id: string; bytes: number; items: VaultItem[]; indexRecovered: boolean; indexBackupHealthy: boolean }>;
  vaultOpen(options: { token: string; id: string }): Promise<{ uri: string; mime: string; name: string }>;
  vaultContainerInfo(options: { token: string; id: string }): Promise<{ header: string; headerHex: string; bytes: number; version: number; member: boolean }>;
  vaultThumbnail(options: { token: string; id: string }): Promise<{ uri?: string; hasThumbnail: boolean; reason?: string }>;
  vaultExport(options: { token: string; id: string; targetUri: string }): Promise<{ exported: boolean; bytes: number }>;
  vaultDelete(options: { token: string; id: string }): Promise<{ items: VaultItem[]; filesRemoved: number; filesRetained: number; indexRecovered: boolean }>;
}

export function androidVault(): VaultMethods | null {
  if (window.knouxRuntime?.edition !== 'android') return null;
  return window.Capacitor?.Plugins?.KnouxVault ?? null;
}

/* The session token is the only thing the renderer ever holds. The PIN itself
 * never leaves the native layer, and the token is kept in memory only: it is
 * never written to local storage and it dies with the page. */
let sessionToken: string | null = null;

export function vaultSessionToken(): string | null {
  return sessionToken;
}

export function setVaultSessionToken(token: string | null): void {
  sessionToken = token;
}

export function forgetVaultSession(): void {
  sessionToken = null;
}

/* A system file picker also pauses the app, so a vault operation that needs
 * one holds the session open for the duration. The hold is bounded on both
 * sides: the native layer expires it, and the renderer never keeps it past
 * the operation that asked for it. */
let sessionHolds = 0;

export function isVaultSessionHeld(): boolean {
  return sessionHolds > 0;
}

export async function holdVaultSession(): Promise<void> {
  sessionHolds += 1;
  const token = sessionToken;
  const plugin = androidVault();
  if (!token || !plugin) return;
  await plugin.vaultHold({ token, hold: true }).catch(() => undefined);
}

export async function releaseVaultSession(): Promise<void> {
  sessionHolds = Math.max(0, sessionHolds - 1);
  const token = sessionToken;
  const plugin = androidVault();
  if (!token || !plugin) return;
  await plugin.vaultHold({ token, hold: false }).catch(() => undefined);
}

export function vaultPlaybackUrl(uri: string): string {
  return window.Capacitor?.convertFileSrc?.(uri) ?? uri;
}

/* The vault locks itself when the app has really been away. A system file
 * picker also hides the app, so the grace period keeps a vault operation
 * alive while the user is still inside the flow. The native layer applies the
 * same rule to the key itself. */
export const VAULT_BACKGROUND_LOCK_MS = 20_000;

export function watchVaultAutoLock(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  let timer: number | null = null;
  const clear = (): void => {
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
  };
  const onVisibility = (): void => {
    if (!document.hidden) { clear(); return; }
    clear();
    timer = window.setTimeout(() => {
      timer = null;
      if (document.hidden && !isVaultSessionHeld()) {
        forgetVaultSession();
        void androidVault()?.vaultLock().catch(() => undefined);
      }
    }, VAULT_BACKGROUND_LOCK_MS);
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => { clear(); document.removeEventListener('visibilitychange', onVisibility); };
}
