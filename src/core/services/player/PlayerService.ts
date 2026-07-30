/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Player Service
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * خدمة المشغل - تنسيق بين جميع محركات الوسائط
 * 
 * @module Services/Player
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import EventEmitter from 'events';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface PlayerState {
  playing: boolean;
  paused: boolean;
  stopped: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  loop: boolean;
  shuffle: boolean;
  buffered: TimeRanges | null;
  seeking: boolean;
  ended: boolean;
  error: Error | null;
}

export interface MediaInfo {
  path: string;
  title: string;
  artist?: string;
  album?: string;
  duration: number;
  format: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// فئة خدمة المشغل
// ═══════════════════════════════════════════════════════════════════════════

export class PlayerService extends EventEmitter {
  private state: PlayerState;
  private mediaElement: HTMLVideoElement | null = null;
  private currentMedia: MediaInfo | null = null;
  private playlist: string[] = [];
  private currentIndex = -1;
  private isInitialized = false;

  constructor() {
    super();
    this.state = {
      playing: false,
      paused: false,
      stopped: true,
      currentTime: 0,
      duration: 0,
      volume: 1.0,
      muted: false,
      playbackRate: 1.0,
      loop: false,
      shuffle: false,
      buffered: null,
      seeking: false,
      ended: false,
      error: null,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing Player Service...');
      this.isInitialized = true;
      console.log('Player Service initialized');
    } catch (error) {
      console.error('Failed to initialize Player Service:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    this.stop();
    this.isInitialized = false;
    console.log('Player Service shutdown');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إدارة عنصر الوسائط
  // ═════════════════════════════════════════════════════════════════════════

  public attachToMediaElement(element: HTMLVideoElement): void {
    this.detach();
    this.mediaElement = element;
    this.setupMediaEventListeners();
  }

  public detach(): void {
    if (this.mediaElement) {
      this.removeMediaEventListeners();
      this.mediaElement = null;
    }
  }

  private setupMediaEventListeners(): void {
    if (!this.mediaElement) return;

    this.mediaElement.addEventListener('play', this.handlePlay);
    this.mediaElement.addEventListener('pause', this.handlePause);
    this.mediaElement.addEventListener('ended', this.handleEnded);
    this.mediaElement.addEventListener('timeupdate', this.handleTimeUpdate);
    this.mediaElement.addEventListener('durationchange', this.handleDurationChange);
    this.mediaElement.addEventListener('volumechange', this.handleVolumeChange);
    this.mediaElement.addEventListener('progress', this.handleProgress);
    this.mediaElement.addEventListener('seeking', this.handleSeeking);
    this.mediaElement.addEventListener('seeked', this.handleSeeked);
    this.mediaElement.addEventListener('error', this.handleError);
    this.mediaElement.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.mediaElement.addEventListener('waiting', this.handleWaiting);
    this.mediaElement.addEventListener('playing', this.handlePlaying);
    this.mediaElement.addEventListener('canplay', this.handleCanPlay);
    this.mediaElement.addEventListener('ratechange', this.handleRateChange);
  }

  private removeMediaEventListeners(): void {
    if (!this.mediaElement) return;

    this.mediaElement.removeEventListener('play', this.handlePlay);
    this.mediaElement.removeEventListener('pause', this.handlePause);
    this.mediaElement.removeEventListener('ended', this.handleEnded);
    this.mediaElement.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.mediaElement.removeEventListener('durationchange', this.handleDurationChange);
    this.mediaElement.removeEventListener('volumechange', this.handleVolumeChange);
    this.mediaElement.removeEventListener('progress', this.handleProgress);
    this.mediaElement.removeEventListener('seeking', this.handleSeeking);
    this.mediaElement.removeEventListener('seeked', this.handleSeeked);
    this.mediaElement.removeEventListener('error', this.handleError);
    this.mediaElement.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.mediaElement.removeEventListener('waiting', this.handleWaiting);
    this.mediaElement.removeEventListener('playing', this.handlePlaying);
    this.mediaElement.removeEventListener('canplay', this.handleCanPlay);
    this.mediaElement.removeEventListener('ratechange', this.handleRateChange);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // معالجات الأحداث
  // ═════════════════════════════════════════════════════════════════════════

  private handlePlay = (): void => {
    this.state.playing = true;
    this.state.paused = false;
    this.state.stopped = false;
    this.emit('play');
    this.emit('state-change', this.getState());
  };

  private handlePause = (): void => {
    this.state.playing = false;
    this.state.paused = true;
    this.emit('pause');
    this.emit('state-change', this.getState());
  };

  private handleEnded = (): void => {
    this.state.ended = true;
    this.state.playing = false;
    this.emit('ended');
    this.emit('state-change', this.getState());

    if (this.loop) {
      this.play();
    } else if (this.currentIndex < this.playlist.length - 1) {
      this.next();
    }
  };

  private handleTimeUpdate = (): void => {
    if (this.mediaElement) {
      this.state.currentTime = this.mediaElement.currentTime;
      this.emit('time-update', this.state.currentTime);
    }
  };

  private handleDurationChange = (): void => {
    if (this.mediaElement) {
      this.state.duration = this.mediaElement.duration;
      this.emit('duration-change', this.state.duration);
    }
  };

  private handleVolumeChange = (): void => {
    if (this.mediaElement) {
      this.state.volume = this.mediaElement.volume;
      this.state.muted = this.mediaElement.muted;
      this.emit('volume-change', this.state.volume, this.state.muted);
    }
  };

  private handleProgress = (): void => {
    if (this.mediaElement) {
      this.state.buffered = this.mediaElement.buffered;
      this.emit('progress', this.state.buffered);
    }
  };

  private handleSeeking = (): void => {
    this.state.seeking = true;
    this.emit('seeking');
  };

  private handleSeeked = (): void => {
    this.state.seeking = false;
    this.emit('seeked');
  };

  private handleError = (): void => {
    const error = this.mediaElement?.error;
    if (error) {
      this.state.error = new Error(`Media error: ${error.message || error.code}`);
      this.emit('error', this.state.error);
    }
  };

  private handleLoadedMetadata = (): void => {
    this.emit('metadata-loaded');
  };

  private handleWaiting = (): void => {
    this.emit('waiting');
  };

  private handlePlaying = (): void => {
    this.emit('playing');
  };

  private handleCanPlay = (): void => {
    this.emit('can-play');
  };

  private handleRateChange = (): void => {
    if (this.mediaElement) {
      this.state.playbackRate = this.mediaElement.playbackRate;
      this.emit('rate-change', this.state.playbackRate);
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // التحكم في التشغيل
  // ═════════════════════════════════════════════════════════════════════════

  public async load(filePath: string): Promise<void> {
    if (!this.mediaElement) {
      throw new Error('No media element attached');
    }

    try {
      this.state.error = null;
      this.state.ended = false;
      
      this.mediaElement.src = `file://${filePath}`;
      this.currentMedia = {
        path: filePath,
        title: filePath.split('/').pop() || filePath,
        duration: 0,
        format: filePath.split('.').pop() || 'unknown',
      };

      await this.mediaElement.load();
      this.emit('load', filePath);
    } catch (error) {
      this.state.error = error as Error;
      this.emit('error', error);
      throw error;
    }
  }

  public async play(): Promise<void> {
    if (!this.mediaElement) return;

    try {
      await this.mediaElement.play();
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  public async pause(): Promise<void> {
    if (!this.mediaElement) return;
    this.mediaElement.pause();
  }

  public async stop(): Promise<void> {
    if (!this.mediaElement) return;
    
    this.mediaElement.pause();
    this.mediaElement.currentTime = 0;
    this.state.stopped = true;
    this.state.playing = false;
    this.state.paused = false;
    this.emit('stop');
    this.emit('state-change', this.getState());
  }

  public async seek(time: number): Promise<void> {
    if (!this.mediaElement) return;
    
    const clampedTime = Math.max(0, Math.min(time, this.state.duration));
    this.mediaElement.currentTime = clampedTime;
  }

  public async setPlaybackRate(rate: number): Promise<void> {
    if (!this.mediaElement) return;
    
    this.mediaElement.playbackRate = Math.max(0.25, Math.min(4, rate));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // قائمة التشغيل
  // ═════════════════════════════════════════════════════════════════════════

  public setPlaylist(items: string[]): void {
    this.playlist = [...items];
    this.currentIndex = items.length > 0 ? 0 : -1;
    this.emit('playlist-change', this.playlist);
  }

  public getPlaylist(): string[] {
    return [...this.playlist];
  }

  public addToPlaylist(item: string): void {
    this.playlist.push(item);
    this.emit('playlist-change', this.playlist);
  }

  public removeFromPlaylist(index: number): void {
    if (index >= 0 && index < this.playlist.length) {
      this.playlist.splice(index, 1);
      if (this.currentIndex >= this.playlist.length) {
        this.currentIndex = this.playlist.length - 1;
      }
      this.emit('playlist-change', this.playlist);
    }
  }

  public async next(): Promise<void> {
    if (this.playlist.length === 0) return;

    if (this.shuffle) {
      this.currentIndex = Math.floor(Math.random() * this.playlist.length);
    } else {
      this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
    }

    await this.load(this.playlist[this.currentIndex]);
    await this.play();
    this.emit('next', this.currentIndex);
  }

  public async previous(): Promise<void> {
    if (this.playlist.length === 0) return;

    this.currentIndex = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
    await this.load(this.playlist[this.currentIndex]);
    await this.play();
    this.emit('previous', this.currentIndex);
  }

  public setLoop(loop: boolean): void {
    this.state.loop = loop;
    if (this.mediaElement) {
      this.mediaElement.loop = loop;
    }
    this.emit('loop-change', loop);
  }

  public setShuffle(shuffle: boolean): void {
    this.state.shuffle = shuffle;
    this.emit('shuffle-change', shuffle);
  }

  public get loop(): boolean {
    return this.state.loop;
  }

  public get shuffle(): boolean {
    return this.state.shuffle;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الحالة
  // ═════════════════════════════════════════════════════════════════════════

  public getState(): PlayerState {
    return { ...this.state };
  }

  public getCurrentMedia(): MediaInfo | null {
    return this.currentMedia ? { ...this.currentMedia } : null;
  }

  public getCurrentTime(): number {
    return this.state.currentTime;
  }

  public getDuration(): number {
    return this.state.duration;
  }

  public isPlaying(): boolean {
    return this.state.playing;
  }

  public isPaused(): boolean {
    return this.state.paused;
  }

  public isStopped(): boolean {
    return this.state.stopped;
  }
}
