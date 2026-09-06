/**
 * KNOUX X - Renderer Audio Manager
 *
 * Local Web Audio processing shared by desktop and Android player surfaces.
 * Video playback uses a synchronized audio mirror so signed A/V delay can be
 * applied without mutating the original media file.
 */

export interface RendererAudioSettings {
  volume: number;
  boost: number;
  muted: boolean;
  balance: number;
  delayMs: number;
  equalizer: number[];
  effects: Record<string, Record<string, number>>;
}

type Listener = (data: unknown) => void;
type EffectStage = { input: AudioNode; output: AudioNode; dispose?(): void };

let resolveActivePlayerAudioManager = (): PlayerAudioManager | null => null;

export async function setActivePlayerAudioDelay(delayMs: number): Promise<boolean> {
  const manager = resolveActivePlayerAudioManager();
  if (!manager) return false;
  await manager.setDelay(delayMs);
  return true;
}

export async function setActivePlayerAudioBoost(multiplier: number): Promise<boolean> {
  const manager = resolveActivePlayerAudioManager();
  if (!manager) return false;
  await manager.setBoost(multiplier);
  return true;
}

export async function setActivePlayerAudioEffect(effectId: string, enabled: boolean, params: Record<string, number> = {}): Promise<boolean> {
  const manager = resolveActivePlayerAudioManager();
  if (!manager) return false;
  if (enabled) await manager.setEffect(effectId, params);
  else await manager.removeEffect(effectId);
  return true;
}

export async function resumeActivePlayerAudio(): Promise<void> {
  await resolveActivePlayerAudioManager()?.resume();
}

export class PlayerAudioManager {
  private settings: RendererAudioSettings;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private boostGainNode: GainNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private delayNode: DelayNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaElement: HTMLAudioElement | HTMLVideoElement | null = null;
  private sourceElement: HTMLAudioElement | HTMLVideoElement | null = null;
  private audioMirror: HTMLAudioElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private effectStages: Map<string, EffectStage> = new Map();
  private isInitialized = false;
  private listeners: Map<string, Listener[]> = new Map();
  private mirrorSyncTimer: number | null = null;
  private mirrorListeners: Array<() => void> = [];

  constructor() {
    this.settings = {
      volume: 1,
      boost: 1,
      muted: false,
      balance: 0,
      delayMs: 0,
      equalizer: new Array(10).fill(0),
      effects: {},
    };
  }

  private emit(event: string, data?: unknown): void {
    this.listeners.get(event)?.forEach((listener) => listener(data));
  }

  public on(event: string, listener: Listener): () => void {
    const eventListeners = this.listeners.get(event) || [];
    eventListeners.push(listener);
    this.listeners.set(event, eventListeners);
    return () => this.off(event, listener);
  }

  public off(event: string, listener: Listener): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;
    const index = eventListeners.indexOf(listener);
    if (index !== -1) eventListeners.splice(index, 1);
  }

  public attachToMediaElement(element: HTMLAudioElement | HTMLVideoElement): void {
    if (this.mediaElement === element && this.isInitialized) {
      resolveActivePlayerAudioManager = () => this;
      return;
    }
    this.detach();
    this.mediaElement = element;

    try {
      this.audioContext = new AudioContext({ sampleRate: 48_000, latencyHint: 'playback' });

      if (element instanceof HTMLVideoElement) {
        const mirror = document.createElement('audio');
        mirror.preload = 'auto';
        mirror.src = element.currentSrc || element.src;
        mirror.crossOrigin = element.crossOrigin;
        mirror.loop = element.loop;
        mirror.playbackRate = element.playbackRate;
        mirror.preservesPitch = (element as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch ?? true;
        mirror.style.display = 'none';
        mirror.setAttribute('aria-hidden', 'true');
        document.body.appendChild(mirror);
        this.audioMirror = mirror;
        this.sourceElement = mirror;
        // The original video keeps rendering pictures; Web Audio owns its sound.
        element.muted = true;
        this.installMirrorSynchronization(element, mirror);
      } else {
        this.sourceElement = element;
      }

      this.sourceNode = this.audioContext.createMediaElementSource(this.sourceElement);
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.settings.muted ? 0 : this.settings.volume;
      this.boostGainNode = this.audioContext.createGain();
      this.boostGainNode.gain.value = this.settings.boost;
      this.stereoPanner = this.audioContext.createStereoPanner();
      this.stereoPanner.pan.value = this.settings.balance;
      this.delayNode = this.audioContext.createDelay(5);
      this.delayNode.delayTime.value = this.audioMirror ? 0 : Math.max(0, this.settings.delayMs) / 1000;
      this.limiterNode = this.audioContext.createDynamicsCompressor();
      this.limiterNode.threshold.value = -1;
      this.limiterNode.knee.value = 8;
      this.limiterNode.ratio.value = 20;
      this.limiterNode.attack.value = 0.002;
      this.limiterNode.release.value = 0.08;
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.createEqualizerFilters();
      this.connectGraph();
      this.isInitialized = true;
      resolveActivePlayerAudioManager = () => this;
      this.syncMirror(true);
      this.emit('attached', element);
    } catch (error) {
      console.error('Failed to attach to media element:', error);
      this.detach();
      throw error;
    }
  }

  private installMirrorSynchronization(video: HTMLVideoElement, mirror: HTMLAudioElement): void {
    const add = (type: string, listener: EventListener): void => {
      video.addEventListener(type, listener);
      this.mirrorListeners.push(() => video.removeEventListener(type, listener));
    };
    add('play', () => { void this.resume().then(() => this.syncMirror(true)); });
    add('pause', () => mirror.pause());
    add('seeking', () => this.syncMirror(true));
    add('seeked', () => this.syncMirror(true));
    add('ratechange', () => { mirror.playbackRate = video.playbackRate; this.syncMirror(true); });
    add('ended', () => mirror.pause());
    add('emptied', () => mirror.pause());
    this.mirrorSyncTimer = window.setInterval(() => this.syncMirror(false), 180);
  }

  private syncMirror(force: boolean): void {
    const video = this.mediaElement instanceof HTMLVideoElement ? this.mediaElement : null;
    const mirror = this.audioMirror;
    if (!video || !mirror) return;
    const offset = this.settings.delayMs / 1000;
    const target = video.currentTime - offset;
    mirror.playbackRate = video.playbackRate;
    if (target < 0 || video.paused || video.ended) {
      if (!mirror.paused) mirror.pause();
      return;
    }
    const max = Number.isFinite(mirror.duration) && mirror.duration > 0 ? mirror.duration : target;
    const bounded = Math.max(0, Math.min(max, target));
    if (force || Math.abs(mirror.currentTime - bounded) > 0.12) {
      try { mirror.currentTime = bounded; } catch { /* metadata may still be loading */ }
    }
    if (!this.settings.muted && mirror.paused && !video.paused) void mirror.play().catch(() => undefined);
  }

  private createEqualizerFilters(): void {
    const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.eqFilters = frequencies.map((frequency) => {
      const filter = this.audioContext!.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.4;
      filter.gain.value = 0;
      return filter;
    });
  }

  private connectGraph(): void {
    if (!this.sourceNode || !this.gainNode || !this.boostGainNode || !this.stereoPanner || !this.delayNode || !this.limiterNode || !this.analyser || !this.audioContext) return;
    let lastNode: AudioNode = this.sourceNode;
    this.eqFilters.forEach((filter) => { lastNode.connect(filter); lastNode = filter; });
    lastNode.connect(this.gainNode);
    this.gainNode.connect(this.boostGainNode);
    this.boostGainNode.connect(this.delayNode);
    this.delayNode.connect(this.stereoPanner);
    lastNode = this.stereoPanner;
    this.effectStages.forEach((stage) => {
      lastNode.connect(stage.input);
      lastNode = stage.output;
    });
    lastNode.connect(this.limiterNode);
    this.limiterNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
  }

  private disconnectGraph(): void {
    try { this.sourceNode?.disconnect(); } catch { /* already detached */ }
    try { this.gainNode?.disconnect(); } catch { /* already detached */ }
    try { this.boostGainNode?.disconnect(); } catch { /* already detached */ }
    try { this.stereoPanner?.disconnect(); } catch { /* already detached */ }
    try { this.delayNode?.disconnect(); } catch { /* already detached */ }
    try { this.limiterNode?.disconnect(); } catch { /* already detached */ }
    try { this.analyser?.disconnect(); } catch { /* already detached */ }
    this.eqFilters.forEach((filter) => { try { filter.disconnect(); } catch { /* ignore */ } });
    this.effectStages.forEach((stage) => {
      try { stage.input.disconnect(); } catch { /* ignore */ }
      if (stage.output !== stage.input) try { stage.output.disconnect(); } catch { /* ignore */ }
    });
  }

  private reconnectGraph(): void {
    if (!this.isInitialized) return;
    this.disconnectGraph();
    this.connectGraph();
  }

  public detach(): void {
    if (resolveActivePlayerAudioManager() === this) resolveActivePlayerAudioManager = () => null;
    if (this.mirrorSyncTimer !== null) window.clearInterval(this.mirrorSyncTimer);
    this.mirrorSyncTimer = null;
    this.mirrorListeners.splice(0).forEach((remove) => remove());
    this.audioMirror?.pause();
    this.audioMirror?.removeAttribute('src');
    this.audioMirror?.load();
    this.audioMirror?.remove();
    this.audioMirror = null;
    if (this.mediaElement instanceof HTMLVideoElement) this.mediaElement.muted = this.settings.muted;

    this.disconnectGraph();
    this.sourceNode = null;
    this.gainNode = null;
    this.boostGainNode = null;
    this.stereoPanner = null;
    this.delayNode = null;
    this.limiterNode = null;
    this.analyser = null;
    this.eqFilters = [];
    this.effectStages.forEach((stage) => stage.dispose?.());
    this.effectStages.clear();
    if (this.audioContext) void this.audioContext.close();
    this.audioContext = null;
    this.mediaElement = null;
    this.sourceElement = null;
    this.isInitialized = false;
    this.emit('detached');
  }

  public async resume(): Promise<void> {
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
    this.syncMirror(true);
  }

  public async setVolume(volume: number): Promise<void> {
    // Primary volume remains a conventional 0..100% control. Extra gain is
    // intentionally separate so changing normal volume never overwrites boost.
    this.settings.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    if (this.gainNode && !this.settings.muted && this.audioContext) {
      this.gainNode.gain.setTargetAtTime(this.settings.volume, this.audioContext.currentTime, 0.01);
    }
    this.emit('volume-change', this.settings.volume);
  }

  public async setBoost(multiplier: number): Promise<void> {
    this.settings.boost = Math.max(1, Math.min(2, Number.isFinite(multiplier) ? multiplier : 1));
    if (this.boostGainNode && this.audioContext) {
      this.boostGainNode.gain.setTargetAtTime(this.settings.boost, this.audioContext.currentTime, 0.01);
    }
    this.emit('boost-change', this.settings.boost);
  }

  public async setMuted(muted: boolean): Promise<void> {
    this.settings.muted = muted;
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setTargetAtTime(muted ? 0 : this.settings.volume, this.audioContext.currentTime, 0.01);
    }
    if (muted) this.audioMirror?.pause();
    else this.syncMirror(true);
    this.emit('mute-change', muted);
  }

  public async setBalance(balance: number): Promise<void> {
    this.settings.balance = Math.max(-1, Math.min(1, balance));
    if (this.stereoPanner && this.audioContext) this.stereoPanner.pan.setTargetAtTime(this.settings.balance, this.audioContext.currentTime, 0.01);
    this.emit('balance-change', this.settings.balance);
  }

  public async setDelay(delayMs: number): Promise<void> {
    this.settings.delayMs = Math.max(-5000, Math.min(5000, Number.isFinite(delayMs) ? delayMs : 0));
    if (this.delayNode && this.audioContext) {
      // Video uses the independent audio mirror and therefore supports signed
      // delay. Audio-only playback can physically delay sound, but cannot
      // advance beyond decoded media that does not exist yet.
      const directDelay = this.audioMirror ? 0 : Math.max(0, this.settings.delayMs) / 1000;
      this.delayNode.delayTime.setTargetAtTime(directDelay, this.audioContext.currentTime, 0.01);
    }
    this.syncMirror(true);
    this.emit('delay-change', this.settings.delayMs);
  }

  public async setEqualizer(bands: number[]): Promise<void> {
    if (bands.length !== 10) throw new Error('Equalizer must have exactly 10 bands');
    this.settings.equalizer = bands.map((gain) => Math.max(-20, Math.min(20, gain)));
    if (this.audioContext) this.eqFilters.forEach((filter, index) => filter.gain.setTargetAtTime(this.settings.equalizer[index], this.audioContext!.currentTime, 0.01));
    this.emit('equalizer-change', [...this.settings.equalizer]);
  }

  public async setEffect(effectId: string, params: Record<string, number>): Promise<void> {
    this.settings.effects[effectId] = { ...params };
    const previous = this.effectStages.get(effectId);
    if (previous) {
      previous.dispose?.();
      this.effectStages.delete(effectId);
    }
    const stage = this.createEffectStage(effectId, params);
    if (stage) this.effectStages.set(effectId, stage);
    this.reconnectGraph();
    this.emit('effect-change', { effectId, enabled: Boolean(stage), params });
  }

  public async removeEffect(effectId: string): Promise<void> {
    const stage = this.effectStages.get(effectId);
    stage?.dispose?.();
    this.effectStages.delete(effectId);
    delete this.settings.effects[effectId];
    this.reconnectGraph();
    this.emit('effect-change', { effectId, enabled: false, params: {} });
  }

  private createEffectStage(effectId: string, params: Record<string, number>): EffectStage | null {
    const context = this.audioContext;
    if (!context) return null;
    const single = (node: AudioNode): EffectStage => ({ input: node, output: node });
    switch (effectId) {
      case 'bass-boost': {
        const filter = context.createBiquadFilter();
        filter.type = 'lowshelf';
        filter.frequency.value = params.frequency || 110;
        filter.gain.value = Math.max(0, Math.min(18, (params.amount ?? 55) * 0.18));
        return single(filter);
      }
      case 'surround':
      case 'stereo-widening': {
        const input = context.createGain();
        const splitter = context.createChannelSplitter(2);
        const merger = context.createChannelMerger(2);
        const rightDelay = context.createDelay(0.05);
        rightDelay.delayTime.value = Math.max(0.004, Math.min(0.03, (params.delay ?? 12) / 1000));
        input.connect(splitter);
        splitter.connect(merger, 0, 0);
        splitter.connect(rightDelay, 1);
        rightDelay.connect(merger, 0, 1);
        return { input, output: merger, dispose: () => { splitter.disconnect(); rightDelay.disconnect(); merger.disconnect(); input.disconnect(); } };
      }
      case 'night-mode':
      case 'loudness-normalization': {
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = effectId === 'night-mode' ? -24 : -18;
        compressor.knee.value = 18;
        compressor.ratio.value = effectId === 'night-mode' ? 6 : 3;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.2;
        return single(compressor);
      }
      case 'voice-enhance':
      case 'dialogue-boost':
      case 'vocal-focus': {
        const filter = context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = effectId === 'dialogue-boost' ? 1900 : 3000;
        filter.Q.value = effectId === 'vocal-focus' ? 1.8 : 1;
        filter.gain.value = Math.max(2, Math.min(12, params.clarity ?? params.amount ?? 6));
        return single(filter);
      }
      case 'noise-reduction':
      case 'background-reduction': {
        const input = context.createBiquadFilter();
        input.type = 'highpass';
        input.frequency.value = effectId === 'noise-reduction' ? 80 : 120;
        input.Q.value = 0.7;
        const output = context.createBiquadFilter();
        output.type = 'lowpass';
        output.frequency.value = effectId === 'noise-reduction' ? 15_000 : 10_500;
        input.connect(output);
        return { input, output, dispose: () => { input.disconnect(); output.disconnect(); } };
      }
      case 'mono':
      case 'left-only':
      case 'right-only': {
        const input = context.createGain();
        const splitter = context.createChannelSplitter(2);
        const merger = context.createChannelMerger(2);
        input.connect(splitter);
        if (effectId === 'left-only') {
          splitter.connect(merger, 0, 0); splitter.connect(merger, 0, 1);
        } else if (effectId === 'right-only') {
          splitter.connect(merger, 1, 0); splitter.connect(merger, 1, 1);
        } else {
          const left = context.createGain(); left.gain.value = 0.5;
          const right = context.createGain(); right.gain.value = 0.5;
          splitter.connect(left, 0); splitter.connect(right, 1);
          left.connect(merger, 0, 0); left.connect(merger, 0, 1);
          right.connect(merger, 0, 0); right.connect(merger, 0, 1);
        }
        return { input, output: merger, dispose: () => { input.disconnect(); splitter.disconnect(); merger.disconnect(); } };
      }
      case 'reverb': {
        const input = context.createGain();
        const output = context.createGain();
        const dry = context.createGain();
        const wet = context.createGain();
        const convolver = context.createConvolver();
        wet.gain.value = Math.max(0, Math.min(1, (params.wet ?? 25) / 100));
        dry.gain.value = 1 - wet.gain.value;
        convolver.buffer = this.createImpulseResponse(params.room ?? 30, params.damp ?? 50, context.sampleRate);
        input.connect(dry).connect(output);
        input.connect(convolver).connect(wet).connect(output);
        return { input, output, dispose: () => { input.disconnect(); dry.disconnect(); convolver.disconnect(); wet.disconnect(); output.disconnect(); } };
      }
      default:
        return null;
    }
  }

  private createImpulseResponse(room: number, damp: number, sampleRate: number): AudioBuffer {
    const length = Math.max(1, Math.floor(sampleRate * Math.max(0.1, room / 100) * 2));
    const buffer = this.audioContext!.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const decay = Math.pow(1 - Math.max(0, Math.min(0.99, damp / 100)), index / length);
        data[index] = (Math.random() * 2 - 1) * decay * 0.5;
      }
    }
    return buffer;
  }

  public async enableDSP(enabled: boolean): Promise<void> {
    if (!enabled) this.detach();
    this.emit('dsp-change', enabled);
  }

  public getVisualizerData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(128);
    const values = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(values);
    return values;
  }

  public getWaveformData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(128);
    const values = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(values);
    return values;
  }

  public getFrequencyData(): Float32Array {
    if (!this.analyser) return new Float32Array(128);
    const values = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(values);
    return values;
  }

  public getSettings(): RendererAudioSettings {
    return { ...this.settings, equalizer: [...this.settings.equalizer], effects: structuredClone(this.settings.effects) };
  }

  public isAttached(): boolean {
    return this.isInitialized && this.mediaElement !== null;
  }
}
