/**
 * KNOUX Player XT - Renderer Audio Manager
 *
 * Browser/Web Audio API only - no Node.js dependencies.
 * Designed to run in Electron renderer with nodeIntegration: false, sandbox: true.
 */

export interface RendererAudioSettings {
  volume: number;
  muted: boolean;
  balance: number;
  equalizer: number[];
  effects: Record<string, Record<string, number>>;
}

type Listener = (data: unknown) => void;

export class PlayerAudioManager {
  private settings: RendererAudioSettings;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaElement: HTMLAudioElement | HTMLVideoElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private effectNodes: Map<string, AudioNode> = new Map();
  private isInitialized = false;
  private listeners: Map<string, Listener[]> = new Map();

  constructor() {
    this.settings = {
      volume: 1.0,
      muted: false,
      balance: 0,
      equalizer: new Array(10).fill(0),
      effects: {},
    };
  }

  private emit(event: string, data?: unknown): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => listener(data));
    }
  }

  public on(event: string, listener: Listener): () => void {
    const eventListeners = this.listeners.get(event) || [];
    eventListeners.push(listener);
    this.listeners.set(event, eventListeners);
    return () => this.off(event, listener);
  }

  public off(event: string, listener: Listener): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index !== -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  public attachToMediaElement(element: HTMLAudioElement | HTMLVideoElement): void {
    if (this.mediaElement === element && this.isInitialized) {
      return;
    }

    this.detach();

    this.mediaElement = element;

    try {
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'playback',
      });

      this.sourceNode = this.audioContext.createMediaElementSource(element);

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.settings.muted ? 0 : this.settings.volume;

      this.stereoPanner = this.audioContext.createStereoPanner();
      this.stereoPanner.pan.value = this.settings.balance;

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      this.createEqualizerFilters();

      this.connectGraph();

      this.isInitialized = true;
      this.emit('attached', element);
    } catch (error) {
      console.error('Failed to attach to media element:', error);
      this.detach();
      throw error;
    }
  }

  private createEqualizerFilters(): void {
    const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.eqFilters = frequencies.map((freq) => {
      const filter = this.audioContext!.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = 0;
      return filter;
    });
  }

  private connectGraph(): void {
    if (!this.sourceNode || !this.gainNode || !this.stereoPanner || !this.analyser) {
      return;
    }

    let lastNode: AudioNode = this.sourceNode;

    this.eqFilters.forEach((filter) => {
      lastNode.connect(filter);
      lastNode = filter;
    });

    lastNode.connect(this.gainNode);
    this.gainNode.connect(this.stereoPanner);

    this.effectNodes.forEach((node) => {
      this.stereoPanner!.connect(node);
      node.connect(this.analyser!);
    });

    if (this.effectNodes.size === 0) {
      this.stereoPanner.connect(this.analyser);
    }

    this.analyser.connect(this.audioContext!.destination);
  }

  private reconnectGraph(): void {
    if (!this.isInitialized) return;

    this.gainNode?.disconnect();
    this.stereoPanner?.disconnect();
    this.analyser?.disconnect();
    this.eqFilters.forEach((filter) => filter.disconnect());
    this.effectNodes.forEach((node) => node.disconnect());

    this.connectGraph();
  }

  public detach(): void {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    this.gainNode?.disconnect();
    this.gainNode = null;

    this.stereoPanner?.disconnect();
    this.stereoPanner = null;

    this.analyser?.disconnect();
    this.analyser = null;

    this.eqFilters.forEach((filter) => filter.disconnect());
    this.eqFilters = [];

    this.effectNodes.forEach((node) => node.disconnect());
    this.effectNodes.clear();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.mediaElement = null;
    this.isInitialized = false;
    this.emit('detached');
  }

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

  public async setEqualizer(bands: number[]): Promise<void> {
    if (bands.length !== 10) {
      throw new Error('Equalizer must have exactly 10 bands');
    }

    this.settings.equalizer = bands.map((gain) => Math.max(-20, Math.min(20, gain)));

    this.eqFilters.forEach((filter, index) => {
      filter.gain.setValueAtTime(this.settings.equalizer[index], this.audioContext!.currentTime);
    });

    this.emit('equalizer-change', this.settings.equalizer);
  }

  public async setEffect(effectId: string, params: Record<string, number>): Promise<void> {
    this.settings.effects[effectId] = params;

    const existingNode = this.effectNodes.get(effectId);
    if (existingNode) {
      existingNode.disconnect();
      this.effectNodes.delete(effectId);
    }

    const effectNode = this.createEffectNode(effectId, params);
    if (effectNode) {
      this.effectNodes.set(effectId, effectNode);
    }

    this.reconnectGraph();
    this.emit('effect-change', { effectId, enabled: true, params });
  }

  public async removeEffect(effectId: string): Promise<void> {
    const existingNode = this.effectNodes.get(effectId);
    if (existingNode) {
      existingNode.disconnect();
      this.effectNodes.delete(effectId);
      this.reconnectGraph();
    }
    delete this.settings.effects[effectId];
    this.emit('effect-change', { effectId, enabled: false, params: {} });
  }

  private createEffectNode(effectId: string, params: Record<string, number>): AudioNode | null {
    if (!this.audioContext) return null;

    switch (effectId) {
      case 'bass-boost': {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowshelf';
        filter.frequency.value = params.frequency || 100;
        filter.gain.value = (params.amount || 50) / 10;
        return filter;
      }
      case 'surround': {
        const delay = this.audioContext.createDelay();
        delay.delayTime.value = (params.delay || 20) / 1000;
        const gain = this.audioContext.createGain();
        gain.gain.value = (params.width || 75) / 100;
        delay.connect(gain);
        return delay;
      }
      case 'night-mode': {
        const compressor = this.audioContext.createDynamicsCompressor();
        compressor.threshold.value = params.limit || -10;
        compressor.ratio.value = 1 + (params.compression || 60) / 20;
        compressor.knee.value = 30;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        return compressor;
      }
      case 'voice-enhance': {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = 3000;
        filter.Q.value = 1;
        filter.gain.value = (params.clarity || 50) / 25;
        return filter;
      }
      case 'reverb': {
        const convolver = this.audioContext.createConvolver();
        const wetGain = this.audioContext.createGain();
        wetGain.gain.value = (params.wet || 25) / 100;
        const dryGain = this.audioContext.createGain();
        dryGain.gain.value = 1 - wetGain.gain.value;

        const impulse = this.createImpulseResponse(
          params.room || 30,
          params.damp || 50,
          this.audioContext.sampleRate
        );
        convolver.buffer = impulse;

        const merger = this.audioContext.createChannelMerger(2);
        dryGain.connect(merger, 0, 0);
        convolver.connect(wetGain);
        wetGain.connect(merger, 0, 1);

        return merger;
      }
      default:
        return null;
    }
  }

  private createImpulseResponse(room: number, damp: number, sampleRate: number): AudioBuffer {
    const length = sampleRate * (room / 100) * 2;
    const buffer = this.audioContext!.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - damp / 100, i / length);
        data[i] = (Math.random() * 2 - 1) * decay * 0.5;
      }
    }

    return buffer;
  }

  public async enableDSP(enabled: boolean): Promise<void> {
    if (enabled && !this.isInitialized && this.mediaElement) {
      this.attachToMediaElement(this.mediaElement);
    } else if (!enabled) {
      this.detach();
    }
    this.emit('dsp-change', enabled);
  }

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

  public getSettings(): RendererAudioSettings {
    return { ...this.settings };
  }

  public isAttached(): boolean {
    return this.isInitialized && this.mediaElement !== null;
  }
}
