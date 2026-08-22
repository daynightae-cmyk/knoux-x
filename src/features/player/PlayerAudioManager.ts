import EventEmitter from 'events';

import { DSPSystemManager } from '../../core/dsp/DSPSystemManager';

/**
 * Renderer-side audio manager that handles actual Web Audio graph creation
 * and processing. This lives in the renderer and owns the audio graph.
 */
export interface RendererAudioSettings {
  volume: number;
  muted: boolean;
  balance: number;
  equalizer: number[];
  effects: Record<string, unknown>;
}

export class PlayerAudioManager extends EventEmitter {
  private dsp: DSPSystemManager;
  private settings: RendererAudioSettings;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
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

  /**
   * Initialize the audio manager (called once)
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    // No AudioContext creation here - done when attaching to media element
    this.isInitialized = true;
  }

  /**
   * Shutdown and dispose of resources
   */
  public async shutdown(): Promise<void> {
    this.disconnect();
    this.isInitialized = false;
  }

  /**
   * Attach the audio graph to a media element
   * @param element The video/audio element to attach to
   */
  public attachToMediaElement(element: HTMLVideoElement): void {
    // Disconnect any existing connections first
    this.disconnect();

    try {
      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'playback',
      });

      // Create source node from media element
      this.sourceNode = this.audioContext.createMediaElementSource(element);

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.settings.muted ? 0 : this.settings.volume;

      // Create stereo panner for balance
      this.stereoPanner = this.audioContext.createStereoPanner();
      this.stereoPanner.pan.value = this.settings.balance;

      // Create analyser for visualizations
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect the audio graph: source -> gain -> panner -> analyser -> destination
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.stereoPanner);
      this.stereoPanner.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      // Apply initial DSP settings
      this.applyEqualizer(this.settings.equalizer);
      this.dsp.enable(Object.values(this.settings.effects).some(e => e !== 0 && e !== false));

      this.emit('attached', element);
    } catch (error) {
      console.error('Failed to attach audio graph to media element:', error);
      this.disconnect();
      throw error;
    }
  }

  /**
   * Disconnect and clean up audio graph nodes
   */
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
  }

  /**
   * Apply volume setting to the gain node
   */
  public async setVolume(volume: number): Promise<void> {
    this.settings.volume = Math.max(0, Math.min(1, volume));

    if (this.gainNode && !this.settings.muted) {
      this.gainNode.gain.setValueAtTime(this.settings.volume, this.audioContext!.currentTime);
    }

    this.emit('volume-change', this.settings.volume);
  }

  /**
   * Apply mute setting to the gain node
   */
  public async setMuted(muted: boolean): Promise<void> {
    this.settings.muted = muted;

    if (this.gainNode) {
      const volume = muted ? 0 : this.settings.volume;
      this.gainNode.gain.setValueAtTime(volume, this.audioContext!.currentTime);
    }

    this.emit('mute-change', this.settings.muted);
  }

  /**
   * Apply balance setting to the stereo panner
   */
  public async setBalance(balance: number): Promise<void> {
    this.settings.balance = Math.max(-1, Math.min(1, balance));

    if (this.stereoPanner) {
      this.stereoPanner.pan.setValueAtTime(this.settings.balance, this.audioContext!.currentTime);
    }

    this.emit('balance-change', this.settings.balance);
  }

  /**
   * Get current volume setting
   */
  public getVolume(): number {
    return this.settings.volume;
  }

  /**
   * Check if audio is muted
   */
  public isMuted(): boolean {
    return this.settings.muted;
  }

  /**
   * Get current balance setting
   */
  public getBalance(): number {
    return this.settings.balance;
  }

  /**
   * Apply equalizer bands to DSP
   */
  public async setEqualizer(bands: number[]): Promise<void> {
    if (bands.length !== 10) {
      throw new Error('Equalizer must have exactly 10 bands');
    }

    this.settings.equalizer = bands.map((gain) => Math.max(-20, Math.min(20, gain)));
    this.applyEqualizer(this.settings.equalizer);

    this.emit('equalizer-change', this.settings.equalizer);
  }

  /**
   * Apply equalizer settings to DSP system
   */
  private applyEqualizer(bands: number[]): void {
    bands.forEach((gain, index) => {
      this.dsp.setEqualizerBand(index, gain);
    });
  }

  /**
   * Get current equalizer settings
   */
  public getEqualizer(): number[] {
    return [...this.settings.equalizer];
  }

  /**
   * Set effect parameter
   */
  public async setEffect(effect: string, params: unknown): Promise<void> {
    this.settings.effects[effect] = params;

    // Map effect names to DSP effect IDs and parameter names
    const effectParamMap: Record<string, string[]> = {
      'bass-boost': ['amount', 'frequency'],
      'surround': ['width', 'delay'],
      'night-mode': ['compression', 'limit'],
      'voice-enhance': ['clarity', 'presence'],
      'reverb': ['room', 'damp', 'wet'],
    };

    const validParams = effectParamMap[effect];
    if (validParams && typeof params === 'object' && params !== null) {
      const paramsObj = params as Record<string, unknown>;
      for (const paramName of validParams) {
        const value = paramsObj[paramName];
        if (typeof value === 'number') {
          this.dsp.setEffectParam(effect, paramName, value);
        }
      }
      // Enable the effect in DSP
      this.dsp.setEffectEnabled(effect, true);
    }

    // Update DSP enabled state based on whether any effects are active
    const hasActiveEffects = Object.values(this.settings.effects).some(
      value => value !== 0 && value !== false && value !== null
    );
    this.dsp.enable(hasActiveEffects);

    this.emit('effect-change', effect, params);
  }

  /**
   * Enable or disable DSP processing
   */
  public async enableDSP(enabled: boolean): Promise<void> {
    this.dsp.enable(enabled);
    this.emit('dsp-change', enabled);
  }

  /**
   * Apply multiple audio settings at once
   */
  public async applySettings(settings: Partial<RendererAudioSettings>): Promise<void> {
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
    if (settings.effects !== undefined) {
      // Apply each effect
      for (const [effect, params] of Object.entries(settings.effects)) {
        await this.setEffect(effect, params);
      }
    }
  }

  /**
   * Get current audio settings
   */
  public getSettings(): RendererAudioSettings {
    return { ...this.settings };
  }

  /**
   * Get visualizer data from analyser node
   */
  public getVisualizerData(): Uint8Array {
    if (!this.analyser) {
      return new Uint8Array(128);
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  /**
   * Get waveform data from analyser node
   */
  public getWaveformData(): Uint8Array {
    if (!this.analyser) {
      return new Uint8Array(128);
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(dataArray);
    return dataArray;
  }

  /**
   * Get frequency data from analyser node
   */
  public getFrequencyData(): Float32Array {
    if (!this.analyser) {
      return new Float32Array(128);
    }

    const dataArray = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(dataArray);
    return dataArray;
  }
}