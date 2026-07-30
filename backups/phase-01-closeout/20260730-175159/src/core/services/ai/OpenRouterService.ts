/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - OpenRouter AI Service
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * خدمة OpenRouter AI - واجهة مجانية للنماذج اللغوية القوية
 * تدعم: Llama, Mistral, Qwen, DeepSeek, وأكثر
 * 
 * @module Services/AI
 * @author KNOUX Development Team
 * @version 2.0.0
 */

import EventEmitter from 'events';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface ChatContext {
  messages: ChatMessage[];
  currentMedia?: string;
  mediaInfo?: {
    title: string;
    artist?: string;
    duration: number;
  };
}

export interface MediaAnalysis {
  summary: string;
  tags: string[];
  mood: string;
  recommendations: string[];
}

export interface PlaylistRecommendation {
  title: string;
  reason: string;
  confidence: number;
}

export interface AIModel {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  pricing: {
    prompt: number;
    completion: number;
  };
}

export interface ServiceStatus {
  isOnline: boolean;
  latency: number;
  model: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// نماذج AI المتاحة (مجانية)
// ═══════════════════════════════════════════════════════════════════════════

export const AVAILABLE_MODELS: AIModel[] = [
  {
    id: 'meta-llama/llama-3.2-11b-vision-instruct:free',
    name: 'Llama 3.2 11B Vision',
    description: 'نموذج Meta القوي مع دعم الرؤية',
    contextLength: 131072,
    pricing: { prompt: 0, completion: 0 },
  },
  {
    id: 'google/gemma-2-9b-it:free',
    name: 'Gemma 2 9B',
    description: 'نموذج Google المفتوح المصدر',
    contextLength: 8192,
    pricing: { prompt: 0, completion: 0 },
  },
  {
    id: 'microsoft/phi-3.5-mini-instruct:free',
    name: 'Phi 3.5 Mini',
    description: 'نموذج Microsoft المدمج والسريع',
    contextLength: 131072,
    pricing: { prompt: 0, completion: 0 },
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
    name: 'Nemotron 70B',
    description: 'نموذج NVIDIA القوي جداً',
    contextLength: 131072,
    pricing: { prompt: 0, completion: 0 },
  },
  {
    id: 'deepseek/deepseek-chat:free',
    name: 'DeepSeek Chat',
    description: 'نموذج DeepSeek للمحادثات',
    contextLength: 65536,
    pricing: { prompt: 0, completion: 0 },
  },
  {
    id: 'qwen/qwen-2-7b-instruct:free',
    name: 'Qwen 2 7B',
    description: 'نموذج Alibaba القوي',
    contextLength: 32768,
    pricing: { prompt: 0, completion: 0 },
  },
  {
    id: 'huggingfaceh4/zephyr-7b-beta:free',
    name: 'Zephyr 7B',
    description: 'نموذج Hugging Face المحسّن',
    contextLength: 32768,
    pricing: { prompt: 0, completion: 0 },
  },
  {
    id: 'gryphe/mythomist-7b:free',
    name: 'MythoMist 7B',
    description: 'نموذج متوازن للمحادثات',
    contextLength: 32768,
    pricing: { prompt: 0, completion: 0 },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// فئة خدمة OpenRouter
// ═══════════════════════════════════════════════════════════════════════════

export class OpenRouterService extends EventEmitter {
  private apiKey: string | null = null;
  private baseUrl = 'https://openrouter.ai/api/v1';
  private currentModel: string = AVAILABLE_MODELS[0].id;
  private context: ChatContext = { messages: [] };
  private isInitialized = false;
  private abortController: AbortController | null = null;
  private requestQueue: Promise<any> = Promise.resolve();
  private status: ServiceStatus = {
    isOnline: false,
    latency: 0,
    model: AVAILABLE_MODELS[0].id,
  };

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('🚀 Initializing OpenRouter AI Service...');

      // Get API key from settings
      this.apiKey = await window.knouxAPI.settings.get<string>('openRouterApiKey', '');

      if (this.apiKey) {
        // Load saved model preference
        const savedModel = await window.knouxAPI.settings.get<string>('aiModel', '');
        if (savedModel && AVAILABLE_MODELS.some(m => m.id === savedModel)) {
          this.currentModel = savedModel;
        }

        // Test connection
        await this.testConnection();
      }

      this.isInitialized = true;
      console.log('✅ OpenRouter Service initialized with model:', this.currentModel);
      this.emit('initialized', { model: this.currentModel });
    } catch (error) {
      console.error('❌ Failed to initialize OpenRouter Service:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isInitialized = false;
    this.context = { messages: [] };
    console.log('🛑 OpenRouter Service shutdown');
    this.emit('shutdown');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // اختبار الاتصال
  // ═════════════════════════════════════════════════════════════════════════

  private async testConnection(): Promise<boolean> {
    if (!this.apiKey) return false;

    const startTime = Date.now();
    
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://knoux-player.app',
          'X-Title': 'KNOUX Player X',
        },
      });

      this.status.latency = Date.now() - startTime;
      this.status.isOnline = response.ok;
      this.status.model = this.currentModel;

      if (response.ok) {
        console.log(`🌐 OpenRouter connected (${this.status.latency}ms)`);
        this.emit('connected', this.status);
      }

      return response.ok;
    } catch (error) {
      this.status.isOnline = false;
      console.error('❌ Connection test failed:', error);
      this.emit('connection-failed', error);
      return false;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الطلبات API
  // ═════════════════════════════════════════════════════════════════════════

  private async makeRequest(endpoint: string, body: any): Promise<any> {
    if (!this.apiKey) {
      throw new Error('API key not configured');
    }

    return this.requestQueue = this.requestQueue.then(async () => {
      this.abortController = new AbortController();

      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://knoux-player.app',
            'X-Title': 'KNOUX Player X',
          },
          body: JSON.stringify(body),
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
          throw new Error(error.error?.message || `HTTP ${response.status}`);
        }

        return response.json();
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Request cancelled');
        }
        throw error;
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الدردشة
  // ═════════════════════════════════════════════════════════════════════════

  public async chat(message: string, context?: ChatContext): Promise<string> {
    if (!this.apiKey) {
      return '⚠️ OpenRouter AI is not configured. Please set your API key in settings to use free AI models like Llama, Mistral, and more.';
    }

    try {
      // Update context if provided
      if (context) {
        this.context = { ...this.context, ...context };
      }

      // Build messages array
      const messages = this.buildMessages(message);

      // Send request
      const response = await this.makeRequest('/chat/completions', {
        model: this.currentModel,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 0.9,
      });

      const content = response.choices?.[0]?.message?.content || 'No response';

      // Store in context
      this.context.messages.push(
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'assistant', content, timestamp: new Date() }
      );

      // Keep only last 20 messages
      if (this.context.messages.length > 20) {
        this.context.messages = this.context.messages.slice(-20);
      }

      this.emit('message', { role: 'assistant', content });
      return content;
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `❌ Error: ${errorMessage}. Please try again or check your API key.`;
    }
  }

  public async *streamChat(message: string): AsyncGenerator<string> {
    if (!this.apiKey) {
      yield '⚠️ Please configure your OpenRouter API key in settings to access free AI models.';
      return;
    }

    try {
      const messages = this.buildMessages(message);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://knoux-player.app',
          'X-Title': 'KNOUX Player X',
        },
        body: JSON.stringify({
          model: this.currentModel,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream chat error:', error);
      yield `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private buildMessages(userMessage: string): any[] {
    const messages: any[] = [
      {
        role: 'system',
        content: `You are KNOUX AI, an intelligent assistant for KNOUX Player X media player. 
You help users with media playback, playlist creation, library management, and answer questions about their media.
Be concise, helpful, and friendly. Use emojis occasionally to make responses engaging.
Current date: ${new Date().toLocaleDateString()}
${this.context.currentMedia ? `Currently playing: "${this.context.mediaInfo?.title}" by ${this.context.mediaInfo?.artist || 'Unknown'}` : ''}`,
      },
    ];

    // Add recent context
    this.context.messages.slice(-10).forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    });

    // Add current message with context
    let enhancedMessage = userMessage;
    if (this.context.currentMedia && this.context.mediaInfo) {
      enhancedMessage = `[Context: Playing "${this.context.mediaInfo.title}" by ${this.context.mediaInfo.artist || 'Unknown'}] ${userMessage}`;
    }

    messages.push({ role: 'user', content: enhancedMessage });

    return messages;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // تحليل الوسائط
  // ═════════════════════════════════════════════════════════════════════════

  public async analyzeMedia(filePath: string): Promise<MediaAnalysis> {
    if (!this.apiKey) {
      return {
        summary: 'AI analysis requires OpenRouter API key. Get a free key at openrouter.ai',
        tags: [],
        mood: 'unknown',
        recommendations: [],
      };
    }

    try {
      const fileName = filePath.split('/').pop() || filePath;
      
      const prompt = `Analyze this media file: "${fileName}". 
Provide a brief analysis in JSON format with these fields:
- summary: 1-2 sentence description
- tags: array of 3-5 relevant tags
- mood: overall mood/atmosphere
- recommendations: array of 3 similar content suggestions

Respond ONLY with valid JSON.`;

      const response = await this.makeRequest('/chat/completions', {
        model: this.currentModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 500,
      });

      const content = response.choices?.[0]?.message?.content || '{}';

      // Try to parse JSON response
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          return {
            summary: analysis.summary || 'No summary available',
            tags: Array.isArray(analysis.tags) ? analysis.tags : [],
            mood: analysis.mood || 'unknown',
            recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
          };
        }
      } catch {
        // Fallback
      }

      return {
        summary: content.substring(0, 200),
        tags: [],
        mood: 'unknown',
        recommendations: [],
      };
    } catch (error) {
      console.error('Media analysis error:', error);
      return {
        summary: 'Analysis failed. Please try again.',
        tags: [],
        mood: 'unknown',
        recommendations: [],
      };
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // توصيات قائمة التشغيل
  // ═════════════════════════════════════════════════════════════════════════

  public async generatePlaylist(mood: string, count = 10): Promise<string[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      const prompt = `Generate a playlist of ${count} songs/movies for a "${mood}" mood. 
Return ONLY the titles, one per line, no numbering or extra text.`;

      const response = await this.makeRequest('/chat/completions', {
        model: this.currentModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 500,
      });

      const text = response.choices?.[0]?.message?.content || '';

      return text
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0 && !line.match(/^\d+\./) && !line.startsWith('-'));
    } catch (error) {
      console.error('Playlist generation error:', error);
      return [];
    }
  }

  public async getRecommendations(basedOn: string[]): Promise<PlaylistRecommendation[]> {
    if (!this.apiKey || basedOn.length === 0) {
      return [];
    }

    try {
      const prompt = `Based on these items: ${basedOn.join(', ')}, 
recommend 5 similar movies/songs. 
Format each as: Title - Brief reason why it's similar
One per line.`;

      const response = await this.makeRequest('/chat/completions', {
        model: this.currentModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
      });

      const text = response.choices?.[0]?.message?.content || '';

      return text
        .split('\n')
        .filter((line: string) => line.trim().length > 0)
        .map((line: string) => {
          const parts = line.split(' - ');
          return {
            title: parts[0]?.replace(/^\d+\.\s*/, '').trim() || line,
            reason: parts[1]?.trim() || '',
            confidence: 0.8,
          };
        });
    } catch (error) {
      console.error('Recommendations error:', error);
      return [];
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // مساعدة المستخدم
  // ═════════════════════════════════════════════════════════════════════════

  public async getHelp(topic: string): Promise<string> {
    const helpTopics: Record<string, string> = {
      playback: `🎬 Playback Controls:
• Space: Play/Pause
• ←/→ Arrow: Seek backward/forward 10s
• ↑/↓ Arrow: Volume up/down
• F: Fullscreen toggle
• M: Mute toggle
• S: Take screenshot`,

      playlist: `📋 Playlist Management:
• Drag & drop files to add
• Double-click to play
• Right-click for options
• Ctrl+Shift+O: Open folder
• Use AI to generate playlists based on mood`,

      subtitles: `📝 Subtitle Controls:
• V: Toggle subtitles
• Shift+L: Load subtitle file
• +/-: Adjust subtitle delay
• AI Sync: Auto-sync subtitles`,

      audio: `🎵 Audio Controls:
• Use equalizer in Audio menu
• Enable Neural DSP for enhanced sound
• Select audio tracks from menu
• Adjust spatial audio settings`,

      ai: `🤖 AI Features:
• Chat with KNOUX AI for help
• Auto-generate playlists by mood
• Get media recommendations
• Smart subtitle synchronization
• Media content analysis`,

      shortcuts: `⌨️ Keyboard Shortcuts:
• Ctrl+O: Open file
• Ctrl+Shift+O: Open folder
• Ctrl+L: Show library
• F11: Fullscreen
• Esc: Exit fullscreen`,
    };

    return helpTopics[topic.toLowerCase()] || 
      `💡 I can help you with: playback, playlist, subtitles, audio, ai, shortcuts. Just ask!`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إعدادات
  // ═════════════════════════════════════════════════════════════════════════

  public async setApiKey(apiKey: string): Promise<void> {
    this.apiKey = apiKey;
    await window.knouxAPI.settings.set('openRouterApiKey', apiKey);
    
    if (apiKey) {
      await this.testConnection();
    }
    
    this.emit('api-key-set');
  }

  public async setModel(modelId: string): Promise<void> {
    if (!AVAILABLE_MODELS.some(m => m.id === modelId)) {
      throw new Error('Invalid model ID');
    }

    this.currentModel = modelId;
    this.status.model = modelId;
    await window.knouxAPI.settings.set('aiModel', modelId);
    this.emit('model-changed', modelId);
  }

  public getAvailableModels(): AIModel[] {
    return AVAILABLE_MODELS;
  }

  public getCurrentModel(): string {
    return this.currentModel;
  }

  public getStatus(): ServiceStatus {
    return { ...this.status };
  }

  public hasApiKey(): boolean {
    return !!this.apiKey;
  }

  public clearContext(): void {
    this.context = { messages: [] };
    this.emit('context-cleared');
  }

  public setCurrentMedia(mediaInfo: ChatContext['mediaInfo']): void {
    this.context.currentMedia = mediaInfo?.title;
    this.context.mediaInfo = mediaInfo;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // وظائف إضافية متقدمة
  // ═════════════════════════════════════════════════════════════════════════

  public async summarizeContent(text: string, maxLength = 100): Promise<string> {
    if (!this.apiKey) return text.substring(0, maxLength);

    try {
      const prompt = `Summarize this in ${maxLength} characters or less:\n${text}`;
      
      const response = await this.makeRequest('/chat/completions', {
        model: this.currentModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 100,
      });

      return response.choices?.[0]?.message?.content || text.substring(0, maxLength);
    } catch {
      return text.substring(0, maxLength);
    }
  }

  public async translateText(text: string, targetLang: string): Promise<string> {
    if (!this.apiKey) return text;

    try {
      const prompt = `Translate to ${targetLang}:\n${text}`;
      
      const response = await this.makeRequest('/chat/completions', {
        model: this.currentModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      });

      return response.choices?.[0]?.message?.content || text;
    } catch {
      return text;
    }
  }

  public async generateSubtitles(audioContext: string): Promise<string[]> {
    if (!this.apiKey) return [];

    try {
      const prompt = `Generate subtitle timestamps for this audio context:\n${audioContext}\nFormat: [HH:MM:SS] Text`;
      
      const response = await this.makeRequest('/chat/completions', {
        model: this.currentModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 1000,
      });

      const text = response.choices?.[0]?.message?.content || '';
      return text.split('\n').filter((line: string) => line.trim().length > 0);
    } catch {
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton Instance
// ═══════════════════════════════════════════════════════════════════════════

export const openRouterService = new OpenRouterService();
export default openRouterService;
