/**
 * OpenRouter AI Service
 * Handles all interactions with the OpenRouter API for AI-powered features
 */

export interface AIConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxRetries: number;
  timeout: number;
}

export interface AIResponse {
  success: boolean;
  content?: string;
  error?: string;
}

export interface StreamCallback {
  onChunk(text: string): void;
  onError(error: Error): void;
  onComplete(): void;
}

class OpenRouterService {
  private config: AIConfig = {
    apiKey: '',
    model: 'mistralai/mistral-7b-instruct',
    baseUrl: 'https://openrouter.ai/api/v1',
    maxRetries: 3,
    timeout: 30000,
  };

  private isInitialized = false;

  /**
   * Initialize the service with API key from settings
   */
  async initialize(): Promise<boolean> {
    try {
      if (!window.knouxAPI) {
        console.warn('IPC API not available, running in offline mode');
        return false;
      }

      const apiKey = await window.knouxAPI.settings.get<string>('ai.apiKey', '');
      const model = await window.knouxAPI.settings.get<string>('ai.model', this.config.model);

      if (!apiKey) {
        console.info('No OpenRouter API key configured');
        return false;
      }

      this.config.apiKey = apiKey;
      this.config.model = model;
      this.isInitialized = true;

      // Validate the API key
      const isValid = await this.validateApiKey();
      if (!isValid) {
        console.warn('OpenRouter API key validation failed');
        this.isInitialized = false;
        return false;
      }

      console.info('OpenRouter AI service initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize OpenRouter service:', error);
      return false;
    }
  }

  /**
   * Validate the API key by making a test request
   */
  private async validateApiKey(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.baseUrl}/auth/key`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch (error) {
      console.error('API key validation error:', error);
      return false;
    }
  }

  /**
   * Check if the service is properly initialized
   */
  isReady(): boolean {
    return this.isInitialized && !!this.config.apiKey;
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<AIConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Update the API key
   */
  async setApiKey(apiKey: string): Promise<boolean> {
    try {
      this.config.apiKey = apiKey;
      const isValid = await this.validateApiKey();
      if (isValid && window.knouxAPI) {
        await window.knouxAPI.settings.set('ai.apiKey', apiKey);
        this.isInitialized = true;
        return true;
      }
      this.isInitialized = false;
      return false;
    } catch (error) {
      console.error('Failed to set API key:', error);
      return false;
    }
  }

  /**
   * Update the model
   */
  async setModel(model: string): Promise<void> {
    this.config.model = model;
    if (window.knouxAPI) {
      await window.knouxAPI.settings.set('ai.model', model);
    }
  }

  /**
   * Send a message and get a response
   */
  async sendMessage(message: string, retries = 0): Promise<AIResponse> {
    if (!this.isReady()) {
      return {
        success: false,
        error: 'OpenRouter service not initialized. Please configure API key.',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: message }],
          temperature: 0.7,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `API error: ${response.status} - ${errorData.error?.message || response.statusText}`
        );
      }

      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      const content = data.choices?.[0]?.message?.content;

      return {
        success: !!content,
        content,
        error: content ? undefined : 'No content in response',
      };
    } catch (error) {
      if (retries < this.config.maxRetries && error instanceof Error && error.name !== 'AbortError') {
        console.warn(`Retrying request (${retries + 1}/${this.config.maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retries + 1)));
        return this.sendMessage(message, retries + 1);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to send message:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Stream a message response (for real-time typing effect)
   */
  async streamMessage(message: string, callbacks: StreamCallback): Promise<void> {
    if (!this.isReady()) {
      callbacks.onError(new Error('OpenRouter service not initialized'));
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout * 3);

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: message }],
          stream: true,
          temperature: 0.7,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} - ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines[lines.length - 1];

          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                break;
              }
              try {
                const json = JSON.parse(data) as { choices: Array<{ delta: { content?: string } }> };
                const chunk = json.choices?.[0]?.delta?.content;
                if (chunk) {
                  callbacks.onChunk(chunk);
                }
              } catch {
                // Ignore parsing errors for individual chunks
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      callbacks.onComplete();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Stream error:', errorMessage);
      callbacks.onError(new Error(errorMessage));
    }
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    this.isInitialized = false;
  }
}

// Export singleton instance
export const openRouterService = new OpenRouterService();
