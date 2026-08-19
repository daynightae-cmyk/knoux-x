import { PROVIDERS, type ImageProviderId } from './catalog';

/**
 * Credential, consent and secure-storage layer for KNOUX Image Studio AI.
 *
 * Pure logic that keeps secrets out of documents and logs:
 *  - provider-specific API key validation and masking,
 *  - an injectable SecretVault that encrypts secrets at rest (the real
 *    implementation backs it with Electron safeStorage + AES-GCM),
 *  - explicit, revocable, scope-scoped consent records that must be
 *    granted before any prompt or image is sent to a provider.
 *
 * No network, no Electron imports: fully unit-testable in Node.
 */

export const AI_TERMS_VERSION = '1.0';

export type ConsentScope = 'prompt' | 'image' | 'seed-and-options';

/** Which scopes each network provider necessarily exercises. */
export const PROVIDER_REQUIRED_SCOPES: Record<ImageProviderId, ConsentScope[]> = {
  openrouter: ['prompt', 'seed-and-options'],
  huggingface: ['prompt', 'seed-and-options'],
  local: ['seed-and-options'],
  mock: [],
};

export interface KeyValidationResult {
  ok: boolean;
  reason?: string;
}

export interface SecretRef {
  provider: ImageProviderId;
  keyName: string;
}

export interface SecretVault {
  saveSecret(ref: SecretRef, secret: string): Promise<void>;
  readSecret(ref: SecretRef): Promise<string | null>;
  deleteSecret(ref: SecretRef): Promise<void>;
  listSecrets(): Promise<SecretRef[]>;
}

export interface SecretCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export interface ConsentRecord {
  provider: ImageProviderId;
  grantedAt: string;
  scopes: ConsentScope[];
  termsVersion: string;
  revokedAt: string | null;
}

export interface ConsentStore {
  readConsent(provider: ImageProviderId): Promise<ConsentRecord | null>;
  writeConsent(record: ConsentRecord): Promise<void>;
  deleteConsent(provider: ImageProviderId): Promise<void>;
}

export interface ConsentStatus {
  provider: ImageProviderId;
  granted: boolean;
  termsVersion: string;
  scopes: ConsentScope[];
  revokedAt: string | null;
  requiresConsent: boolean;
  missingScopes: ConsentScope[];
}

export interface ProviderCredentialStatus {
  provider: ImageProviderId;
  configured: boolean;
  requiresKey: boolean;
  keyMasked: string | null;
  requiresConsent: boolean;
  consented: boolean;
  termsVersion: string;
}

export interface ConfigureOptions {
  provider: ImageProviderId;
  apiKey: string;
  scopes?: ConsentScope[];
  termsVersion?: string;
  keyName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Key validation & masking
// ═══════════════════════════════════════════════════════════════════════════

export function validateApiKey(provider: ImageProviderId, apiKey: string): KeyValidationResult {
  const value = apiKey.trim();
  const definition = PROVIDERS[provider];
  if (!definition.requiresKey) {
    return { ok: false, reason: `Provider "${provider}" does not use an API key.` };
  }
  if (value.length === 0) return { ok: false, reason: 'API key is empty.' };
  if (/\s/.test(value)) return { ok: false, reason: 'API key must not contain whitespace.' };
  if (value.length < 20) return { ok: false, reason: 'API key is too short to be valid.' };
  if (value.length > 512) return { ok: false, reason: 'API key is too long.' };
  if (provider === 'openrouter' && !value.startsWith('sk-or-v1-')) {
    return { ok: false, reason: 'OpenRouter keys start with "sk-or-v1-".' };
  }
  if (provider === 'huggingface' && !value.startsWith('hf_')) {
    return { ok: false, reason: 'Hugging Face tokens start with "hf_".' };
  }
  return { ok: true };
}

/** Mask a key so it can be displayed or logged without leaking the secret. */
export function maskApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (value.length <= 8) return '****';
  const head = value.startsWith('sk-or-v1-') || value.startsWith('hf_') ? value.slice(0, 8) : value.slice(0, 4);
  const tail = value.slice(-4);
  return `${head}****${tail}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Consent management
// ═══════════════════════════════════════════════════════════════════════════

export class ConsentManager {
  private readonly store: ConsentStore;
  private readonly now: () => Date;

  constructor(store: ConsentStore, now: () => Date = () => new Date()) {
    this.store = store;
    this.now = now;
  }

  async grant(options: {
    provider: ImageProviderId;
    scopes?: ConsentScope[];
    termsVersion?: string;
  }): Promise<ConsentRecord> {
    const provider = options.provider;
    const required = PROVIDER_REQUIRED_SCOPES[provider];
    const scopes = [...new Set(options.scopes ?? required)];
    const record: ConsentRecord = {
      provider,
      grantedAt: this.now().toISOString(),
      scopes,
      termsVersion: options.termsVersion ?? AI_TERMS_VERSION,
      revokedAt: null,
    };
    await this.store.writeConsent(record);
    return record;
  }

  async revoke(provider: ImageProviderId): Promise<void> {
    const existing = await this.store.readConsent(provider);
    if (!existing) return;
    existing.revokedAt = this.now().toISOString();
    await this.store.writeConsent(existing);
  }

  async status(provider: ImageProviderId): Promise<ConsentStatus> {
    const record = await this.store.readConsent(provider);
    const required = PROVIDER_REQUIRED_SCOPES[provider];
    const active = Boolean(record && !record.revokedAt);
    const grantedScopes = active && record ? record.scopes : [];
    const missingScopes = required.filter((scope) => !grantedScopes.includes(scope));
    return {
      provider,
      granted: active && missingScopes.length === 0,
      termsVersion: record?.termsVersion ?? AI_TERMS_VERSION,
      scopes: grantedScopes,
      revokedAt: record?.revokedAt ?? null,
      requiresConsent: required.length > 0,
      missingScopes,
    };
  }

  async isReady(provider: ImageProviderId): Promise<boolean> {
    return (await this.status(provider)).granted;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Credential manager
// ═══════════════════════════════════════════════════════════════════════════

export class ImageStudioCredentialManager {
  private readonly vault: SecretVault;
  private readonly consent: ConsentManager;

  constructor(vault: SecretVault, consent: ConsentManager) {
    this.vault = vault;
    this.consent = consent;
  }

  async configure(options: ConfigureOptions): Promise<ProviderCredentialStatus> {
    const { provider } = options;
    const validation = validateApiKey(provider, options.apiKey);
    if (!validation.ok) throw new TypeError(validation.reason);
    const ref: SecretRef = { provider, keyName: options.keyName ?? `${provider}-api-key` };
    await this.vault.saveSecret(ref, options.apiKey.trim());
    await this.consent.grant({
      provider,
      scopes: options.scopes ?? PROVIDER_REQUIRED_SCOPES[provider],
      termsVersion: options.termsVersion,
    });
    return this.status(provider);
  }

  async clear(provider: ImageProviderId): Promise<ProviderCredentialStatus> {
    await this.vault.deleteSecret({ provider, keyName: `${provider}-api-key` });
    await this.consent.revoke(provider);
    return this.status(provider);
  }

  /** Resolve the live key for a request; throws if not configured/consented. */
  async resolveKey(provider: ImageProviderId): Promise<string> {
    if (!PROVIDERS[provider].requiresKey) throw new Error(`Provider "${provider}" does not require a key.`);
    const key = await this.vault.readSecret({ provider, keyName: `${provider}-api-key` });
    if (!key) throw new Error(`No API key configured for "${provider}".`);
    const consent = await this.consent.status(provider);
    if (!consent.granted) {
      throw new Error(`Consent for "${provider}" has not been granted or has been revoked.`);
    }
    return key;
  }

  async hasKey(provider: ImageProviderId): Promise<boolean> {
    if (!PROVIDERS[provider].requiresKey) return false;
    return (await this.vault.readSecret({ provider, keyName: `${provider}-api-key` })) !== null;
  }

  async status(provider: ImageProviderId): Promise<ProviderCredentialStatus> {
    const definition = PROVIDERS[provider];
    const key = await this.vault.readSecret({ provider, keyName: `${provider}-api-key` });
    const consent = await this.consent.status(provider);
    return {
      provider,
      configured: key !== null,
      requiresKey: definition.requiresKey,
      keyMasked: key ? maskApiKey(key) : null,
      requiresConsent: consent.requiresConsent,
      consented: consent.granted,
      termsVersion: consent.termsVersion,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Encrypted vault helpers (pure crypto, injected cipher)
// ═══════════════════════════════════════════════════════════════════════════

/** In-memory SecretVault that encrypts secrets through an injected cipher. */
export class MemorySecretVault implements SecretVault {
  private readonly secrets = new Map<string, string>();
  private readonly cipher: SecretCipher;

  constructor(cipher: SecretCipher) {
    this.cipher = cipher;
  }

  private key(ref: SecretRef): string {
    return `${ref.provider}:${ref.keyName}`;
  }

  async saveSecret(ref: SecretRef, secret: string): Promise<void> {
    this.secrets.set(this.key(ref), await this.cipher.encrypt(secret));
  }

  async readSecret(ref: SecretRef): Promise<string | null> {
    const stored = this.secrets.get(this.key(ref));
    if (!stored) return null;
    return this.cipher.decrypt(stored);
  }

  async deleteSecret(ref: SecretRef): Promise<void> {
    this.secrets.delete(this.key(ref));
  }

  async listSecrets(): Promise<SecretRef[]> {
    return [...this.secrets.keys()].map((entry) => {
      const [provider, keyName] = entry.split(':');
      return { provider: provider as ImageProviderId, keyName };
    });
  }
}

/** Memory-only consent store for tests. */
export class MemoryConsentStore implements ConsentStore {
  private readonly records = new Map<ImageProviderId, ConsentRecord>();

  async readConsent(provider: ImageProviderId): Promise<ConsentRecord | null> {
    return this.records.get(provider) ?? null;
  }

  async writeConsent(record: ConsentRecord): Promise<void> {
    this.records.set(record.provider, { ...record, scopes: [...record.scopes] });
  }

  async deleteConsent(provider: ImageProviderId): Promise<void> {
    this.records.delete(provider);
  }
}
