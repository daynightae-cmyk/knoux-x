import {
  AI_TERMS_VERSION,
  ConsentManager,
  ImageStudioCredentialManager,
  MemoryConsentStore,
  MemorySecretVault,
  maskApiKey,
  validateApiKey,
  type ConsentStore,
  type SecretCipher,
  type SecretVault,
} from '../../src/core/image-studio/ai/credentials';

const OPENROUTER_KEY = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890ABCDEF';
const HF_KEY = 'hf_abcdefghijklmnopqrstuvwxyz1234567890';

/** Deterministic test cipher that proves secrets are not stored as plaintext. */
class Rot13Cipher implements SecretCipher {
  async encrypt(plaintext: string): Promise<string> {
    return `enc:${Buffer.from(plaintext).toString('base64')}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext.slice(4), 'base64').toString('utf8');
  }
}

function fixedNow(): Date {
  return new Date('2026-01-01T00:00:00.000Z');
}

describe('image studio AI credentials', () => {
  describe('validateApiKey', () => {
    it('accepts a well-formed OpenRouter key', () => {
      expect(validateApiKey('openrouter', OPENROUTER_KEY)).toEqual({ ok: true });
    });

    it('accepts a well-formed Hugging Face token', () => {
      expect(validateApiKey('huggingface', HF_KEY)).toEqual({ ok: true });
    });

    it('rejects OpenRouter keys without the sk-or-v1- prefix', () => {
      const result = validateApiKey('openrouter', 'sk-or-abcdefghijklmnopqrstuvwxyz');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('sk-or-v1-');
    });

    it('rejects Hugging Face tokens without the hf_ prefix', () => {
      const result = validateApiKey('huggingface', 'abcdefghijklmnopqrstuvwxyz1234567890');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('hf_');
    });

    it('rejects empty, whitespace, too-short and too-long keys', () => {
      expect(validateApiKey('openrouter', '   ').ok).toBe(false);
      expect(validateApiKey('openrouter', `${OPENROUTER_KEY} with space`).ok).toBe(false);
      expect(validateApiKey('openrouter', 'sk-or-v1-short').ok).toBe(false);
      expect(validateApiKey('huggingface', 'hf_'.padEnd(520, 'x')).ok).toBe(false);
    });

    it('refuses keys for providers that do not use one', () => {
      const result = validateApiKey('local', 'anything-long-enough-to-be-a-key');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('does not use');
    });
  });

  describe('maskApiKey', () => {
    it('never reveals the middle of the secret', () => {
      const masked = maskApiKey(OPENROUTER_KEY);
      expect(masked).toContain('****');
      expect(masked.includes('abcdefghijklmnopqrstuvwxyz1234')).toBe(false);
      expect(masked.endsWith('CDEF')).toBe(true);
    });

    it('keeps only a short prefix and last four characters', () => {
      expect(maskApiKey(HF_KEY)).toBe('hf_abcde****7890');
    });

    it('handles short keys defensively', () => {
      expect(maskApiKey('tiny')).toBe('****');
    });
  });

  describe('ConsentManager', () => {
    it('starts un-consented for network providers that need consent', async () => {
      const manager = new ConsentManager(new MemoryConsentStore(), fixedNow);
      const status = await manager.status('openrouter');
      expect(status.requiresConsent).toBe(true);
      expect(status.granted).toBe(false);
      expect(status.missingScopes).toEqual(['prompt', 'seed-and-options']);
    });

    it('grants explicit scoped consent and persists terms version', async () => {
      const store = new MemoryConsentStore();
      const manager = new ConsentManager(store, fixedNow);
      await manager.grant({ provider: 'openrouter', scopes: ['prompt', 'seed-and-options'] });
      const status = await manager.status('openrouter');
      expect(status.granted).toBe(true);
      expect(status.termsVersion).toBe(AI_TERMS_VERSION);
      const record = await store.readConsent('openrouter');
      expect(record?.grantedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('requires all scopes a provider needs before counting as consented', async () => {
      const manager = new ConsentManager(new MemoryConsentStore(), fixedNow);
      await manager.grant({ provider: 'openrouter', scopes: ['prompt'] });
      const status = await manager.status('openrouter');
      expect(status.granted).toBe(false);
      expect(status.missingScopes).toEqual(['seed-and-options']);
    });

    it('revokes consent and records the revocation time', async () => {
      const manager = new ConsentManager(new MemoryConsentStore(), fixedNow);
      await manager.grant({ provider: 'huggingface' });
      await manager.revoke('huggingface');
      const status = await manager.status('huggingface');
      expect(status.granted).toBe(false);
      expect(status.revokedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('defaults the scopes for a provider when none are supplied', async () => {
      const manager = new ConsentManager(new MemoryConsentStore(), fixedNow);
      const record = await manager.grant({ provider: 'openrouter' });
      expect(record.scopes).toEqual(['prompt', 'seed-and-options']);
    });
  });

  describe('ImageStudioCredentialManager', () => {
    function makeManager(): { manager: ImageStudioCredentialManager; vault: SecretVault; store: ConsentStore } {
      const vault = new MemorySecretVault(new Rot13Cipher());
      const store = new MemoryConsentStore();
      const manager = new ImageStudioCredentialManager(vault, new ConsentManager(store, fixedNow));
      return { manager, vault, store };
    }

    it('configures a provider, storing the key encrypted, not as plaintext', async () => {
      const { manager, vault } = makeManager();
      const status = await manager.configure({ provider: 'openrouter', apiKey: OPENROUTER_KEY });
      expect(status.configured).toBe(true);
      expect(status.consented).toBe(true);
      expect(status.keyMasked).toContain('****');
      const refs = await vault.listSecrets();
      expect(refs).toContainEqual({ provider: 'openrouter', keyName: 'openrouter-api-key' });
    });

    it('rejects an invalid key at configure time', async () => {
      const { manager } = makeManager();
      await expect(
        manager.configure({ provider: 'openrouter', apiKey: 'not-a-real-key-format' })
      ).rejects.toThrow(/sk-or-v1-/);
    });

    it('resolves the live key only when configured and consented', async () => {
      const { manager } = makeManager();
      await manager.configure({ provider: 'huggingface', apiKey: HF_KEY });
      await expect(manager.resolveKey('huggingface')).resolves.toBe(HF_KEY);
    });

    it('blocks resolveKey when the provider has no key', async () => {
      const { manager } = makeManager();
      await expect(manager.resolveKey('openrouter')).rejects.toThrow(/No API key configured/);
    });

    it('blocks resolveKey after consent is revoked', async () => {
      const { manager, store } = makeManager();
      await manager.configure({ provider: 'huggingface', apiKey: HF_KEY });
      const consent = new ConsentManager(store, fixedNow);
      await consent.revoke('huggingface');
      await expect(manager.resolveKey('huggingface')).rejects.toThrow(/Consent/);
    });

    it('clears the key and revokes consent together', async () => {
      const { manager } = makeManager();
      await manager.configure({ provider: 'openrouter', apiKey: OPENROUTER_KEY });
      const status = await manager.clear('openrouter');
      expect(status.configured).toBe(false);
      expect(status.consented).toBe(false);
      await expect(manager.hasKey('openrouter')).resolves.toBe(false);
    });

    it('reports status without a configured credential', async () => {
      const { manager } = makeManager();
      const status = await manager.status('openrouter');
      expect(status).toMatchObject({
        provider: 'openrouter',
        configured: false,
        requiresKey: true,
        requiresConsent: true,
        consented: false,
      });
    });
  });
});
