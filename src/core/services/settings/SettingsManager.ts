/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Settings Manager
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * مدير الإعدادات - يدير حفظ واسترجاع إعدادات التطبيق
 * 
 * @module Services/Settings
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import EventEmitter from 'events';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface AppSettings {
  // General
  language: string;
  theme: 'light' | 'dark' | 'auto';
  accentColor: string;
  
  // Playback
  autoPlay: boolean;
  resumePlayback: boolean;
  defaultVolume: number;
  muted: boolean;
  playbackRate: number;
  
  // Audio
  audioDevice: string;
  equalizer: number[];
  enableDSP: boolean;
  
  // Video
  hardwareAcceleration: boolean;
  deinterlace: boolean;
  aspectRatio: string;
  
  // Subtitles
  subtitleEnabled: boolean;
  subtitleLanguage: string;
  subtitleSize: number;
  subtitleColor: string;
  
  // Library
  libraryPaths: string[];
  autoScan: boolean;
  
  // Interface
  minimizeToTray: boolean;
  showNotifications: boolean;
  
  // Advanced
  cacheSize: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const defaultSettings: AppSettings = {
  language: 'en',
  theme: 'dark',
  accentColor: '#00f0ff',
  
  autoPlay: true,
  resumePlayback: true,
  defaultVolume: 0.8,
  muted: false,
  playbackRate: 1.0,
  
  audioDevice: 'default',
  equalizer: new Array(10).fill(0),
  enableDSP: true,
  
  hardwareAcceleration: true,
  deinterlace: false,
  aspectRatio: 'auto',
  
  subtitleEnabled: true,
  subtitleLanguage: 'en',
  subtitleSize: 24,
  subtitleColor: '#ffffff',
  
  libraryPaths: [],
  autoScan: false,
  
  minimizeToTray: true,
  showNotifications: true,
  
  cacheSize: 512,
  logLevel: 'info',
};

// ═══════════════════════════════════════════════════════════════════════════
// فئة مدير الإعدادات
// ═══════════════════════════════════════════════════════════════════════════

export class SettingsManager extends EventEmitter {
  private settings: Map<string, unknown> = new Map();
  private isInitialized = false;

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing Settings Manager...');
      await this.loadSettings();
      this.isInitialized = true;
      console.log('Settings Manager initialized');
    } catch (error) {
      console.error('Failed to initialize Settings Manager:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    await this.saveSettings();
    this.isInitialized = false;
    console.log('Settings Manager shutdown');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إدارة الإعدادات
  // ═════════════════════════════════════════════════════════════════════════

  public async get<T>(key: string, defaultValue?: T): Promise<T> {
    try {
      const value = await window.knouxAPI.settings.get<T>(key, defaultValue);
      this.settings.set(key, value);
      return value;
    } catch {
      return defaultValue as T;
    }
  }

  public async set<T>(key: string, value: T): Promise<void> {
    const oldValue = this.settings.get(key);
    this.settings.set(key, value);
    
    try {
      await window.knouxAPI.settings.set(key, value);
      this.emit('change', key, value, oldValue);
    } catch (error) {
      console.error('Failed to save setting:', key, error);
      throw error;
    }
  }

  public async getAll(): Promise<Record<string, unknown>> {
    return window.knouxAPI.settings.getAll();
  }

  public async reset(key?: string): Promise<void> {
    if (key) {
      const defaultValue = (defaultSettings as unknown as Record<string, unknown>)[key];
      await this.set(key, defaultValue);
    } else {
      // Reset all settings
      for (const [k, v] of Object.entries(defaultSettings)) {
        await this.set(k, v);
      }
    }
    this.emit('reset', key);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // تحميل وحفظ الإعدادات
  // ═════════════════════════════════════════════════════════════════════════

  private async loadSettings(): Promise<void> {
    try {
      const allSettings = await this.getAll();
      for (const [key, value] of Object.entries(allSettings)) {
        this.settings.set(key, value);
      }
    } catch (error) {
      console.warn('Failed to load settings:', error);
    }
  }

  private async saveSettings(): Promise<void> {
    // Settings are saved individually via set()
    console.log('Settings saved');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // استيراد وتصدير
  // ═════════════════════════════════════════════════════════════════════════

  public async export(): Promise<string> {
    const allSettings = await this.getAll();
    return JSON.stringify(allSettings, null, 2);
  }

  public async import(data: string): Promise<void> {
    try {
      const settings = JSON.parse(data);
      
      for (const [key, value] of Object.entries(settings)) {
        await this.set(key, value);
      }
      
      this.emit('import', settings);
    } catch (error) {
      console.error('Failed to import settings:', error);
      throw new Error('Invalid settings file');
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إعدادات محددة
  // ═════════════════════════════════════════════════════════════════════════

  public async getPlaybackSettings(): Promise<{
    autoPlay: boolean;
    resumePlayback: boolean;
    defaultVolume: number;
    muted: boolean;
    playbackRate: number;
  }> {
    return {
      autoPlay: await this.get('autoPlay', defaultSettings.autoPlay),
      resumePlayback: await this.get('resumePlayback', defaultSettings.resumePlayback),
      defaultVolume: await this.get('defaultVolume', defaultSettings.defaultVolume),
      muted: await this.get('muted', defaultSettings.muted),
      playbackRate: await this.get('playbackRate', defaultSettings.playbackRate),
    };
  }

  public async getAudioSettings(): Promise<{
    audioDevice: string;
    equalizer: number[];
    enableDSP: boolean;
  }> {
    return {
      audioDevice: await this.get('audioDevice', defaultSettings.audioDevice),
      equalizer: await this.get('equalizer', defaultSettings.equalizer),
      enableDSP: await this.get('enableDSP', defaultSettings.enableDSP),
    };
  }

  public async getVideoSettings(): Promise<{
    hardwareAcceleration: boolean;
    deinterlace: boolean;
    aspectRatio: string;
  }> {
    return {
      hardwareAcceleration: await this.get('hardwareAcceleration', defaultSettings.hardwareAcceleration),
      deinterlace: await this.get('deinterlace', defaultSettings.deinterlace),
      aspectRatio: await this.get('aspectRatio', defaultSettings.aspectRatio),
    };
  }

  public async getSubtitleSettings(): Promise<{
    subtitleEnabled: boolean;
    subtitleLanguage: string;
    subtitleSize: number;
    subtitleColor: string;
  }> {
    return {
      subtitleEnabled: await this.get('subtitleEnabled', defaultSettings.subtitleEnabled),
      subtitleLanguage: await this.get('subtitleLanguage', defaultSettings.subtitleLanguage),
      subtitleSize: await this.get('subtitleSize', defaultSettings.subtitleSize),
      subtitleColor: await this.get('subtitleColor', defaultSettings.subtitleColor),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الاشتراك في التغييرات
  // ═════════════════════════════════════════════════════════════════════════

  public onChange(callback: (key: string, value: unknown, oldValue: unknown) => void): () => void {
    this.on('change', callback);
    return () => this.off('change', callback);
  }
}