/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Gemini Service
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * خدمة Gemini AI - يدمج قدرات الذكاء الاصطناعي
 * 
 * @module Services/AI
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import EventEmitter from 'events';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: 'user' | 'model';
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

// ═══════════════════════════════════════════════════════════════════════════
// فئة خدمة Gemini
// ═══════════════════════════════════════════════════════════════════════════

export class GeminiService extends EventEmitter {
  private genAI: GoogleGenerativeAI | null = null;
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;
  private chatSession: ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['startChat']> | null = null;
  private context: ChatContext = { messages: [] };
  private isInitialized = false;
  private apiKey: string | null = null;

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing Gemini Service...');

      // Get API key from settings
      this.apiKey = await window.knouxAPI.settings.get<string>('geminiApiKey', '');

      if (this.apiKey) {
        this.setupGemini();
      }

      this.isInitialized = true;
      console.log('Gemini Service initialized');
    } catch (error) {
      console.error('Failed to initialize Gemini Service:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    this.chatSession = null;
    this.model = null;
    this.genAI = null;
    this.isInitialized = false;
    console.log('Gemini Service shutdown');
  }

  private setupGemini(): void {
    if (!this.apiKey) return;

    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-pro',
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    });

    this.startNewChat();
  }

  private startNewChat(): void {
    if (!this.model) return;

    this.chatSession = this.model.startChat({
      history: [
        {
          role: 'user',
          parts: 'You are KNOUX AI, an intelligent assistant for KNOUX Player X media player. You can help users with media playback, playlist creation, and answer questions about their media library. Be concise and helpful.',
        },
        {
          role: 'model',
          parts: 'I understand. I am KNOUX AI, ready to assist you with your media player. I can help with playback controls, playlist management, media recommendations, and more. How can I help you today?',
        },
      ],
    });

    this.context.messages = [];
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الدردشة
  // ═════════════════════════════════════════════════════════════════════════

  public async chat(message: string, context?: ChatContext): Promise<string> {
    if (!this.chatSession) {
      return 'Gemini AI is not configured. Please set your API key in settings.';
    }

    try {
      // Update context if provided
      if (context) {
        this.context = { ...this.context, ...context };
      }

      // Add context to message if available
      let enhancedMessage = message;
      if (this.context.currentMedia && this.context.mediaInfo) {
        enhancedMessage = `[Currently playing: "${this.context.mediaInfo.title}" by ${this.context.mediaInfo.artist || 'Unknown'}] ${message}`;
      }

      // Send message
      const result = await this.chatSession.sendMessage(enhancedMessage);
      const response = await result.response;
      const text = response.text();

      // Store in context
      this.context.messages.push(
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'model', content: text, timestamp: new Date() }
      );

      // Keep only last 20 messages
      if (this.context.messages.length > 20) {
        this.context.messages = this.context.messages.slice(-20);
      }

      this.emit('message', { role: 'model', content: text });
      return text;
    } catch (error) {
      console.error('Chat error:', error);
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  public async *streamChat(message: string): AsyncGenerator<string> {
    if (!this.chatSession) {
      yield 'Gemini AI is not configured. Please set your API key in settings.';
      return;
    }

    try {
      const result = await this.chatSession.sendMessageStream(message);
      
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield text;
        }
      }
    } catch (error) {
      console.error('Stream chat error:', error);
      yield 'Sorry, I encountered an error. Please try again.';
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // تحليل الوسائط
  // ═════════════════════════════════════════════════════════════════════════

  public async analyzeMedia(filePath: string): Promise<MediaAnalysis> {
    if (!this.model) {
      return {
        summary: 'AI analysis not available. Please configure your API key.',
        tags: [],
        mood: 'unknown',
        recommendations: [],
      };
    }

    try {
      const fileName = filePath.split('/').pop() || filePath;
      
      const prompt = `Analyze this media file: "${fileName}". 
        Provide:
        1. A brief summary (1-2 sentences)
        2. Relevant tags (3-5 tags)
        3. Mood/atmosphere
        4. Similar content recommendations
        
        Format as JSON with keys: summary, tags (array), mood, recommendations (array)`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Try to parse JSON response
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          return {
            summary: analysis.summary || 'No summary available',
            tags: analysis.tags || [],
            mood: analysis.mood || 'unknown',
            recommendations: analysis.recommendations || [],
          };
        }
      } catch {
        // Fallback to default structure
      }

      return {
        summary: text.substring(0, 200),
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
    if (!this.model) {
      return [];
    }

    try {
      const prompt = `Generate a playlist of ${count} songs/movies for a "${mood}" mood. 
        Return only the titles, one per line, no numbering.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.match(/^\d+\./));
    } catch (error) {
      console.error('Playlist generation error:', error);
      return [];
    }
  }

  public async getRecommendations(basedOn: string[]): Promise<PlaylistRecommendation[]> {
    if (!this.model || basedOn.length === 0) {
      return [];
    }

    try {
      const prompt = `Based on these items: ${basedOn.join(', ')}, 
        recommend 5 similar movies/songs. 
        Format: Title - Brief reason why it's similar`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      return text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
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
      playback: `Playback Controls:
- Space: Play/Pause
- Left/Right Arrow: Seek backward/forward
- Up/Down Arrow: Volume up/down
- F: Fullscreen
- M: Mute`,

      playlist: `Playlist Management:
- Add files by dragging and dropping
- Double-click to play
- Right-click for more options
- Use the sidebar to manage playlists`,

      subtitles: `Subtitle Controls:
- V: Toggle subtitles
- Shift + L: Load subtitle file
- Use AI sync for automatic synchronization`,

      audio: `Audio Controls:
- Use the equalizer in Audio menu
- Enable DSP for enhanced sound
- Select audio tracks from the Audio menu`,

      shortcuts: `Keyboard Shortcuts:
- Ctrl + O: Open file
- Ctrl + Shift + O: Open folder
- Ctrl + L: Show library
- F11: Fullscreen`,
    };

    return helpTopics[topic.toLowerCase()] || `I can help you with: playback, playlist, subtitles, audio, shortcuts. Just ask!`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إعدادات
  // ═════════════════════════════════════════════════════════════════════════

  public async setApiKey(apiKey: string): Promise<void> {
    this.apiKey = apiKey;
    await window.knouxAPI.settings.set('geminiApiKey', apiKey);
    this.setupGemini();
    this.emit('api-key-set');
  }

  public hasApiKey(): boolean {
    return !!this.apiKey;
  }

  public clearContext(): void {
    this.context = { messages: [] };
    this.startNewChat();
    this.emit('context-cleared');
  }

  public setCurrentMedia(mediaInfo: ChatContext['mediaInfo']): void {
    this.context.currentMedia = mediaInfo?.title;
    this.context.mediaInfo = mediaInfo;
  }
}