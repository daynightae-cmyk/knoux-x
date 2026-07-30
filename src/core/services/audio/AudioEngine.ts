/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Audio Engine
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * محرك الصوت - يدير تشغيل ومعالجة الصوت
 * 
 * @module Services/Audio
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import EventEmitter from 'events';
import { DSPSystemManager } from '../../dsp/DSPSystemManager';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface AudioSettings {
  volume: number;
  muted: boolean;
  balance: number;
  equalizer: number[];
  effects: Record<string, unknown>;
}

export interface AudioDevice {
  id: string;
  name: string;
  type: 'output' | 'input';
  isDefault: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// فئة محرك الصوت
// ═══════════════════════════════════════════════════════════════════════════

export class AudioEngine extends EventEmitter {
  private dsp: DSPSystemManager;
  private settings: AudioSettings;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private mediaElement: HTMLAudioElement | HTMLVideoElement | null = null;
  private isInitialized = false;

  constructor(dsp: DSPSystemManager) {
    super();
    this.dsp = dsp;
    this.settings = {
      volume: 1.0,
      muted: false,
      balance: 0,
      equalizer: new Array(10).fill(0),
      effects: {},
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والإغلاق
  // ═════════════════════════════════════════════════════════════════════════

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing Audio Engine...');
      this.isInitialized = true;
      console.log('Audio Engine initialized');
    } catch (error) {
      console.error('Failed to initialize Audio Engine:', error);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    this.disconnect();
    this.isInitialized = false;
    console.log('Audio Engine shutdown');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إدارة مصدر الصوت
  // ═════════════════════════════════════════════════════════════════════════

  public attachToMediaElement(element: HTMLAudioElement | HTMLVideoElement): void {
    this.disconnect();
    this.mediaElement = element;

    try {
      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'playback',
      });

      // Create source node
      this.sourceNode = this.audioContext.createMediaElementSource(element);

      // Create gain node for volume
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.settings.muted ? 0 : this.settings.volume;

      // Create stereo panner for balance
      this.stereoPanner = this.audioContext.createStereoPanner();
      this.stereoPanner.pan.value = this.settings.balance;

      // Create analyser for visualizations
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect nodes: source -> gain -> panner -> analyser -> destination
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.stereoPanner);
      this.stereoPanner.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      this.emit('attached', element);
    } catch (error) {
      console.error('Failed to attach to media element:', error);
      throw error;
    }
  }

  public disconnect(): void {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.stereoPanner) {
      this.stereoPanner.disconnect();
      this.stereoPanner = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.mediaElement = null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // التحكم في الصوت
  // ═════════════════════════════════════════════════════════════════════════

  public async setVolume(volume: number): Promise<void> {
    this.settings.volume = Math.max(0, Math.min(1, volume));

    if (this.gainNode && !this.settings.muted) {
      this.gainNode.gain.setValueAtTime(this.settings.volume, this.audioContext!.currentTime);
    }

    this.emit('volume-change', this.settings.volume);
  }

  public async setMuted(muted: boolean): Promise<void> {
    this.settings.muted = muted;

    if (this.gainNode) {
      const volume = muted ? 0 : this.settings.volume;
      this.gainNode.gain.setValueAtTime(volume, this.audioContext!.currentTime);
    }

    this.emit('mute-change', this.settings.muted);
  }

  public async setBalance(balance: number): Promise<void> {
    this.settings.balance = Math.max(-1, Math.min(1, balance));

    if (this.stereoPanner) {
      this.stereoPanner.pan.setValueAtTime(this.settings.balance, this.audioContext!.currentTime);
    }

    this.emit('balance-change', this.settings.balance);
  }

  public getVolume(): number {
    return this.settings.volume;
  }

  public isMuted(): boolean {
    return this.settings.muted;
  }

  public getBalance(): number {
    return this.settings.balance;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الميكروفون المتساوي
  // ═════════════════════════════════════════════════════════════════════════

  public async setEqualizer(bands: number[]): Promise<void> {
    if (bands.length !== 10) {
      throw new Error('Equalizer must have exactly 10 bands');
    }

    this.settings.equalizer = bands.map((gain) => Math.max(-20, Math.min(20, gain)));

    // Update DSP equalizer
    bands.forEach((gain, index) => {
      this.dsp.setEqualizerBand(index, gain);
    });

    this.emit('equalizer-change', this.settings.equalizer);
  }

  public getEqualizer(): number[] {
    return [...this.settings.equalizer];
  }

  // ═════════════════════════════════════════════════════════════════════════
  // التأثيرات الصوتية
  // ═════════════════════════════════════════════════════════════════════════

  public async setEffect(effect: string, params: unknown): Promise<void> {
    this.settings.effects[effect] = params;
    this.dsp.setEffectParam(effect, 'params', params as number);
    this.emit('effect-change', effect, params);
  }

  public async enableDSP(enabled: boolean): Promise<void> {
    this.dsp.enable(enabled);
    this.emit('dsp-change', enabled);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // التحليل المرئي
  // ═════════════════════════════════════════════════════════════════════════

  public getVisualizerData(): Uint8Array {
    if (!this.analyser) {
      return new Uint8Array(128);
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  public getWaveformData(): Uint8Array {
    if (!this.analyser) {
      return new Uint8Array(128);
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(dataArray);
    return dataArray;
  }

  public getFrequencyData(): Float32Array {
    if (!this.analyser) {
      return new Float32Array(128);
    }

    const dataArray = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(dataArray);
    return dataArray;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // إعدادات الصوت
  // ═════════════════════════════════════════════════════════════════════════

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  public async applySettings(settings: Partial<AudioSettings>): Promise<void> {
    if (settings.volume !== undefined) {
      await this.setVolume(settings.volume);
    }
    if (settings.muted !== undefined) {
      await this.setMuted(settings.muted);
    }
    if (settings.balance !== undefined) {
      await this.setBalance(settings.balance);
    }
    if (settings.equalizer !== undefined) {
      await this.setEqualizer(settings.equalizer);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // الأجهزة الصوتية
  // ═════════════════════════════════════════════════════════════════════════

  public async getAudioDevices(): Promise<AudioDevice[]> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      
      return devices
        .filter((device) => device.kind === 'audiooutput')
        .map((device) => ({
          id: device.deviceId,
          name: device.label || `Device ${device.deviceId.substring(0, 8)}`,
          type: 'output' as const,
          isDefault: device.deviceId === 'default',
        }));
    } catch (error) {
      console.error('Failed to get audio devices:', error);
      return [];
    }
  }

  public async setAudioDevice(deviceId: string): Promise<void> {
    if (this.mediaElement) {
      if (typeof (this.mediaElement as any).setSinkId === 'function') {
        await (this.mediaElement as any).setSinkId(deviceId);
        this.emit('device-change', deviceId);
      }
    }
  }
}