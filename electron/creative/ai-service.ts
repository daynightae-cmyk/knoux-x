import { safeStorage } from 'electron';
import Store from 'electron-store';

export type AIProvider = 'disabled' | 'gemini';

export interface AISettings {
  provider: AIProvider;
  model: string;
  hasCredential: boolean;
  secureStorageAvailable: boolean;
}

export interface AIConfigureRequest {
  provider: AIProvider;
  model?: string;
  apiKey?: string;
}

export interface AIChatMessage {
  role: 'user' | 'model';
  content: string;
}

interface AIStoreSchema {
  provider: AIProvider;
  model: string;
  encryptedKey: string | null;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

const DEFAULT_MODEL = 'gemini-3.6-flash';
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_HISTORY_MESSAGES = 20;
const REQUEST_TIMEOUT_MS = 30_000;
const MODEL_PATTERN = /^gemini-[A-Za-z0-9.-]{1,80}$/;

function validateModel(model: string): string {
  const value = model.trim();
  if (!MODEL_PATTERN.test(value)) throw new TypeError('Gemini model identifier is invalid.');
  return value;
}

function validateApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (value.length < 20 || value.length > 512 || /\s/.test(value)) {
    throw new TypeError('Gemini API key format is invalid.');
  }
  return value;
}

function validateMessage(message: string): string {
  const value = message.normalize('NFC').trim();
  if (value.length === 0 || value.length > MAX_MESSAGE_LENGTH) {
    throw new RangeError(`AI message must contain 1-${MAX_MESSAGE_LENGTH} characters.`);
  }
  return value;
}

export class AIService {
  private readonly store = new Store<AIStoreSchema>({
    name: 'creative-ai',
    defaults: { provider: 'disabled', model: DEFAULT_MODEL, encryptedKey: null },
  });
  private activeController: AbortController | null = null;

  getSettings(): AISettings {
    return {
      provider: this.store.get('provider'),
      model: this.store.get('model'),
      hasCredential: Boolean(this.store.get('encryptedKey')),
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  configure(request: AIConfigureRequest): AISettings {
    if (request.provider !== 'disabled' && request.provider !== 'gemini') {
      throw new TypeError('Unsupported AI provider.');
    }
    if (request.provider === 'disabled') {
      this.store.set('provider', 'disabled');
      this.cancel();
      return this.getSettings();
    }

    const model = validateModel(request.model ?? this.store.get('model') ?? DEFAULT_MODEL);
    this.store.set('model', model);
    if (request.apiKey !== undefined) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure credential storage is unavailable on this system.');
      }
      const encrypted = safeStorage.encryptString(validateApiKey(request.apiKey)).toString('base64');
      this.store.set('encryptedKey', encrypted);
    }
    if (!this.store.get('encryptedKey')) throw new Error('A Gemini API key is required before enabling AI.');
    this.store.set('provider', 'gemini');
    return this.getSettings();
  }

  clearCredential(): AISettings {
    this.cancel();
    this.store.set({ provider: 'disabled', encryptedKey: null });
    return this.getSettings();
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const startedAt = Date.now();
    try {
      const text = await this.request('Reply with exactly: KNOUX_OK', []);
      return {
        ok: text.includes('KNOUX_OK'),
        latencyMs: Date.now() - startedAt,
        message: text,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : 'AI connection test failed.',
      };
    }
  }

  async chat(message: string, history: AIChatMessage[] = []): Promise<string> {
    const safeHistory = history
      .slice(-MAX_HISTORY_MESSAGES)
      .filter((entry) => (entry.role === 'user' || entry.role === 'model') && typeof entry.content === 'string')
      .map((entry) => ({ role: entry.role, content: validateMessage(entry.content) }));
    return this.request(validateMessage(message), safeHistory);
  }

  cancel(): boolean {
    if (!this.activeController) return false;
    this.activeController.abort();
    this.activeController = null;
    return true;
  }

  private decryptKey(): string {
    const encrypted = this.store.get('encryptedKey');
    if (!encrypted || !safeStorage.isEncryptionAvailable()) {
      throw new Error('AI credential is not configured in secure storage.');
    }
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  private async request(message: string, history: AIChatMessage[]): Promise<string> {
    if (this.store.get('provider') !== 'gemini') {
      throw new Error('AI is disabled. Enable Gemini explicitly in Settings before sending text.');
    }
    const key = this.decryptKey();
    const model = validateModel(this.store.get('model'));
    this.cancel();
    const controller = new AbortController();
    this.activeController = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const contents = [
        ...history.map((entry) => ({ role: entry.role, parts: [{ text: entry.content }] })),
        { role: 'user' as const, parts: [{ text: message }] },
      ];
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
          }),
          signal: controller.signal,
        },
      );
      const payload = await response.json() as GeminiResponse;
      if (!response.ok) throw new Error(payload.error?.message ?? `Gemini request failed with HTTP ${response.status}.`);
      if (payload.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt: ${payload.promptFeedback.blockReason}.`);
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
      if (!text) throw new Error('Gemini returned an empty response.');
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('AI request was canceled or timed out.');
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.activeController === controller) this.activeController = null;
    }
  }
}
