import { PlayerAudioManager } from '../../src/features/player/PlayerAudioManager';

class Param {
  value = 0;
  setTargetAtTime(value: number): void { this.value = value; }
}

class Node {
  gain = new Param();
  pan = new Param();
  frequency = new Param();
  Q = new Param();
  delayTime = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  fftSize = 0;
  smoothingTimeConstant = 0;
  frequencyBinCount = 128;
  buffer: AudioBuffer | null = null;
  connect(destination: Node): Node { return destination; }
  disconnect(): void {}
  getByteFrequencyData(values: Uint8Array): void { values.fill(0); }
  getByteTimeDomainData(values: Uint8Array): void { values.fill(128); }
  getFloatFrequencyData(values: Float32Array): void { values.fill(-120); }
}

class Context {
  currentTime = 0;
  state: AudioContextState = 'running';
  sampleRate = 48_000;
  destination = new Node();
  createMediaElementSource(): Node { return new Node(); }
  createGain(): Node { return new Node(); }
  createStereoPanner(): Node { return new Node(); }
  createDelay(): Node { return new Node(); }
  createDynamicsCompressor(): Node { return new Node(); }
  createAnalyser(): Node { return new Node(); }
  createBiquadFilter(): Node { return new Node(); }
  createChannelSplitter(): Node { return new Node(); }
  createChannelMerger(): Node { return new Node(); }
  createConvolver(): Node { return new Node(); }
  createBuffer(): AudioBuffer { return { getChannelData: () => new Float32Array(1) } as unknown as AudioBuffer; }
  close(): Promise<void> { return Promise.resolve(); }
  resume(): Promise<void> { return Promise.resolve(); }
}

describe('PlayerAudioManager boost separation', () => {
  const original = globalThis.AudioContext;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: original });
  });

  it('keeps normal volume at 0..1 while boost owns the 1..2 multiplier', async () => {
    const manager = new PlayerAudioManager();
    manager.attachToMediaElement({} as HTMLAudioElement);

    await manager.setVolume(2);
    await manager.setBoost(2);

    const internal = manager as unknown as { gainNode: Node; boostGainNode: Node };
    expect(internal.gainNode.gain.value).toBe(1);
    expect(internal.boostGainNode.gain.value).toBe(2);
    expect(manager.getSettings().volume).toBe(1);
    expect(manager.getSettings().boost).toBe(2);
  });
});
