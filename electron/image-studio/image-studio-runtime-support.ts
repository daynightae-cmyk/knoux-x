import { safeStorage } from 'electron';
import Store from 'electron-store';

import type { ImageProviderId } from '../../src/core/image-studio/ai/catalog';
import {
  MemorySecretVault,
  type ConsentRecord,
  type ConsentStore,
  type SecretRef,
  type SecretVault,
} from '../../src/core/image-studio/ai/credentials';
import type { DeferredAiJob } from '../../src/core/image-studio/ai/offline';

import { createMemoryCipher } from './image-studio-service';
import type {
  ImageStudioJobStore,
  JobRecord,
  StringListStore,
} from './image-studio-service';

interface SecretsSchema {
  secrets: Record<string, string>;
}

interface ConsentSchema {
  consents: Record<string, ConsentRecord>;
}

interface RecentsSchema {
  items: string[];
}

interface JobsSchema {
  deferred: DeferredAiJob[];
  history: JobRecord[];
}

function refKey(ref: SecretRef): string {
  return `${ref.provider}:${ref.keyName}`;
}

function parseRefKey(entry: string): SecretRef {
  const separator = entry.indexOf(':');
  return {
    provider: entry.slice(0, separator) as ImageProviderId,
    keyName: entry.slice(separator + 1),
  };
}

/**
 * SecretVault backed by Electron safeStorage. When the OS key store is
 * unavailable the vault degrades to a session-only in-memory cipher and
 * never writes key material to disk.
 */
export class SafeStorageSecretVault implements SecretVault {
  private readonly memory = new MemorySecretVault(createMemoryCipher());

  constructor(private readonly store: Store<SecretsSchema>) {}

  get sessionOnly(): boolean {
    return !safeStorage.isEncryptionAvailable();
  }

  async saveSecret(ref: SecretRef, secret: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      await this.memory.saveSecret(ref, secret);
      return;
    }
    const key = refKey(ref);
    const encrypted = safeStorage.encryptString(secret).toString('base64');
    this.store.set('secrets', { ...this.store.get('secrets'), [key]: encrypted });
  }

  async readSecret(ref: SecretRef): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return this.memory.readSecret(ref);
    const encrypted = this.store.get('secrets')[refKey(ref)];
    if (!encrypted) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return null;
    }
  }

  async deleteSecret(ref: SecretRef): Promise<void> {
    await this.memory.deleteSecret(ref);
    const next = { ...this.store.get('secrets') };
    delete next[refKey(ref)];
    this.store.set('secrets', next);
  }

  async listSecrets(): Promise<SecretRef[]> {
    const keys = new Set<string>(Object.keys(this.store.get('secrets')));
    for (const ref of await this.memory.listSecrets()) keys.add(refKey(ref));
    return [...keys].map(parseRefKey);
  }
}

export class StoreConsentStore implements ConsentStore {
  constructor(private readonly store: Store<ConsentSchema>) {}

  async readConsent(provider: ImageProviderId): Promise<ConsentRecord | null> {
    return this.store.get('consents')[provider] ?? null;
  }

  async writeConsent(record: ConsentRecord): Promise<void> {
    this.store.set('consents', {
      ...this.store.get('consents'),
      [record.provider]: { ...record, scopes: [...record.scopes] },
    });
  }

  async deleteConsent(provider: ImageProviderId): Promise<void> {
    const next = { ...this.store.get('consents') };
    delete next[provider];
    this.store.set('consents', next);
  }
}

export class StoreRecents implements StringListStore {
  constructor(private readonly store: Store<RecentsSchema>) {}

  load(): string[] {
    return this.store.get('items');
  }

  save(items: string[]): void {
    this.store.set('items', items);
  }
}

export class StoreJobsStore implements ImageStudioJobStore {
  constructor(private readonly store: Store<JobsSchema>) {}

  async loadDeferredJobs(): Promise<DeferredAiJob[]> {
    return this.store.get('deferred');
  }

  async saveDeferredJobs(jobs: DeferredAiJob[]): Promise<void> {
    this.store.set('deferred', jobs);
  }

  loadHistory(): JobRecord[] {
    return this.store.get('history');
  }

  saveHistory(records: JobRecord[]): void {
    this.store.set('history', records);
  }
}

export interface ImageStudioRuntimeStores {
  vault: SafeStorageSecretVault;
  consentStore: StoreConsentStore;
  recents: StoreRecents;
  jobsStore: StoreJobsStore;
}

export function createImageStudioRuntimeStores(): ImageStudioRuntimeStores {
  const secrets = new Store<SecretsSchema>({
    name: 'image-studio-secrets',
    defaults: { secrets: {} },
  });
  const consents = new Store<ConsentSchema>({
    name: 'image-studio-consent',
    defaults: { consents: {} },
  });
  const recents = new Store<RecentsSchema>({
    name: 'image-studio-recents',
    defaults: { items: [] },
  });
  const jobs = new Store<JobsSchema>({
    name: 'image-studio-jobs',
    defaults: { deferred: [], history: [] },
  });
  return {
    vault: new SafeStorageSecretVault(secrets),
    consentStore: new StoreConsentStore(consents),
    recents: new StoreRecents(recents),
    jobsStore: new StoreJobsStore(jobs),
  };
}
