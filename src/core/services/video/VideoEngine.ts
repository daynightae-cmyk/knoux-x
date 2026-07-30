/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Video Engine
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * محرك الفيديو - يدير تشغيل ومعالجة الفيديو
 * 
 * @module Services/Video
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import EventEmitter from 'events';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  gamma: number;
}

export interface VideoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoTrack {
  id: string;
  language: string;
  label: string;
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// فئة محرك الفيديو
// ═══════════════════════════════════════════════════════════════════════════

export class VideoEngine extends EventEmitter {
  private settings: VideoSettings;
  private crop: VideoCrop | null = null;
  private zoom = 1.0;
  private aspectRatio = 'auto';
  private videoElement: HTMLVideoElement | null = null;
  private isInitialized = false;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor() {
    super();
    this.settings = {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      hue: 0,
      gamma: 100,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing Video Engine...');
      
      // Create canvas for screenshot functionality
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      
      this.isInitialized = true;
      console.log('Video Engine initialized');
    } catch (error) {
      console.error('Failed to initialize Video Engine:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    this.detach();
    this.isInitialized = false;
    console.log('Video Engine shutdown');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إدارة عنصر الفيديو
  // ═════════════════════════════════════════════════════════════════════════

  public attachToVideoElement(element: HTMLVideoElement): void {
    this.detach();
    this.videoElement = element;
    this.applyVideoFilters();
    this.emit('attached', element);
  }

  public detach(): void {
    this.videoElement = null;
    this.emit('detached');
  }

  public getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // عوامل تصفية الفيديو
  // ═════════════════════════════════════════════════════════════════════════

  private applyVideoFilters(): void {
    if (!this.videoElement) return;

    const filter = this.buildFilterString();
    this.videoElement.style.filter = filter;
  }

  private buildFilterString(): string {
    const { brightness, contrast, saturation, hue, gamma } = this.settings;
    
    return [
      `brightness(${brightness}%)`,
      `contrast(${contrast}%)`,
      `saturate(${saturation}%)`,
      `hue-rotate(${hue}deg)`,
      // Gamma is approximated using brightness
      gamma !== 100 ? `brightness(${Math.pow(gamma / 100, 2) * 100}%)` : '',
    ].filter(Boolean).join(' ');
  }

  public async setBrightness(value: number): Promise<void> {
    this.settings.brightness = Math.max(0, Math.min(200, value));
    this.applyVideoFilters();
    this.emit('brightness-change', this.settings.brightness);
  }

  public async setContrast(value: number): Promise<void> {
    this.settings.contrast = Math.max(0, Math.min(200, value));
    this.applyVideoFilters();
    this.emit('contrast-change', this.settings.contrast);
  }

  public async setSaturation(value: number): Promise<void> {
    this.settings.saturation = Math.max(0, Math.min(200, value));
    this.applyVideoFilters();
    this.emit('saturation-change', this.settings.saturation);
  }

  public async setHue(value: number): Promise<void> {
    this.settings.hue = Math.max(-180, Math.min(180, value));
    this.applyVideoFilters();
    this.emit('hue-change', this.settings.hue);
  }

  public async setGamma(value: number): Promise<void> {
    this.settings.gamma = Math.max(10, Math.min(300, value));
    this.applyVideoFilters();
    this.emit('gamma-change', this.settings.gamma);
  }

  public getSettings(): VideoSettings {
    return { ...this.settings };
  }

  public async applySettings(settings: Partial<VideoSettings>): Promise<void> {
    if (settings.brightness !== undefined) {
      await this.setBrightness(settings.brightness);
    }
    if (settings.contrast !== undefined) {
      await this.setContrast(settings.contrast);
    }
    if (settings.saturation !== undefined) {
      await this.setSaturation(settings.saturation);
    }
    if (settings.hue !== undefined) {
      await this.setHue(settings.hue);
    }
    if (settings.gamma !== undefined) {
      await this.setGamma(settings.gamma);
    }
  }

  public resetFilters(): void {
    this.settings = {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      hue: 0,
      gamma: 100,
    };
    this.applyVideoFilters();
    this.emit('filters-reset');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // القص والتكبير
  // ═════════════════════════════════════════════════════════════════════════

  public async setCrop(crop: VideoCrop | null): Promise<void> {
    this.crop = crop;
    
    if (this.videoElement) {
      if (crop) {
        this.videoElement.style.objectFit = 'none';
        this.videoElement.style.objectPosition = `${crop.x}px ${crop.y}px`;
        this.videoElement.style.width = `${crop.width}px`;
        this.videoElement.style.height = `${crop.height}px`;
      } else {
        this.videoElement.style.objectFit = 'contain';
        this.videoElement.style.objectPosition = 'center';
        this.videoElement.style.width = '100%';
        this.videoElement.style.height = '100%';
      }
    }

    this.emit('crop-change', this.crop);
  }

  public getCrop(): VideoCrop | null {
    return this.crop ? { ...this.crop } : null;
  }

  public async setZoom(zoom: number): Promise<void> {
    this.zoom = Math.max(0.5, Math.min(3, zoom));
    
    if (this.videoElement) {
      this.videoElement.style.transform = `scale(${this.zoom})`;
    }

    this.emit('zoom-change', this.zoom);
  }

  public getZoom(): number {
    return this.zoom;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // نسبة العرض إلى الارتفاع
  // ═════════════════════════════════════════════════════════════════════════

  public setAspectRatio(ratio: string): void {
    this.aspectRatio = ratio;
    
    if (this.videoElement) {
      const ratios: Record<string, string> = {
        auto: '',
        '16:9': '16/9',
        '4:3': '4/3',
        '1:1': '1/1',
        '21:9': '21/9',
        '2.35:1': '2.35/1',
      };

      this.videoElement.style.aspectRatio = ratios[ratio] || '';
    }

    this.emit('aspect-ratio-change', this.aspectRatio);
  }

  public getAspectRatio(): string {
    return this.aspectRatio;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // لقطة شاشة
  // ═════════════════════════════════════════════════════════════════════════

  public takeScreenshot(): string {
    if (!this.videoElement || !this.canvas || !this.ctx) {
      throw new Error('Video element not attached');
    }

    const video = this.videoElement;
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;

    // Apply filters to canvas context
    this.ctx.filter = this.buildFilterString();
    
    // Draw video frame
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);

    // Reset filter
    this.ctx.filter = 'none';

    // Convert to data URL
    return this.canvas.toDataURL('image/png', 1.0);
  }

  public async saveScreenshot(filePath: string): Promise<void> {
    const dataUrl = this.takeScreenshot();
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Save using file API
    await window.knouxAPI.file.writeFile(filePath, buffer);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // المسارات
  // ═════════════════════════════════════════════════════════════════════════

  public getVideoTracks(): VideoTrack[] {
    if (!this.videoElement) return [];

    // This would work with more advanced video sources
    // For now, return a single track
    return [
      {
        id: 'default',
        language: 'und',
        label: 'Default',
        enabled: true,
      },
    ];
  }

  public setVideoTrack(trackId: string): void {
    // Implementation for multi-track video
    this.emit('track-change', trackId);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // معلومات الفيديو
  // ═════════════════════════════════════════════════════════════════════════

  public getVideoInfo(): {
    width: number;
    height: number;
    duration: number;
    currentTime: number;
    playbackRate: number;
  } {
    if (!this.videoElement) {
      return {
        width: 0,
        height: 0,
        duration: 0,
        currentTime: 0,
        playbackRate: 1,
      };
    }

    return {
      width: this.videoElement.videoWidth,
      height: this.videoElement.videoHeight,
      duration: this.videoElement.duration,
      currentTime: this.videoElement.currentTime,
      playbackRate: this.videoElement.playbackRate,
    };
  }
}
