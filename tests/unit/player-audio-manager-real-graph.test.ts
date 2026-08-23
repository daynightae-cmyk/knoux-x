/**
 * Focused Player Audio test.
 *
 * Verifies REAL renderer AudioNode state (mutable node params + connection
 * topology) produced by the actual PlayerAudioManager and the canonical
 * effect IDs / parameter names from DSPSystemManager.
 *
 * The AudioContext below is a controlled test double. It is NOT a call-recording
 * mock: every node exposes mutable, observable AudioParam state and a real
 * connection ledger.
 */

import { PlayerAudioManager } from '../../src/features/player/PlayerAudioManager';

// ─────────────────────────────────────────────────────────────────────────────
// Controlled AudioContext test double
// ─────────────────────────────────────────────────────────────────────────────

class FakeParam {
  public value: number;
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(v: number, _time?: number): FakeParam {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  setValueCurveAtTime(): FakeParam {
    return this;
  }
  cancelScheduledValues(): FakeParam {
    return this;
  }
}

class FakeNode {
  public readonly nodeType: string;
  public readonly context: FakeAudioContext;
  public readonly element: unknown;
  public type = 'peaking';
  public buffer: unknown = null;
  public fftSize = 2048;
  public smoothingTimeConstant = 0.8;
  public frequencyBinCount = 128;

  public gain = new FakeParam(1);
  public pan = new FakeParam(0);
  public frequency = new FakeParam(0);
  public Q = new FakeParam(1);
  public delayTime = new FakeParam(0);
  public threshold = new FakeParam(0);
  public ratio = new FakeParam(1);
  public knee = new FakeParam(0);
  public attack = new FakeParam(0);
  public release = new FakeParam(0);

  public connectedTo: FakeNode[] = [];

  constructor(nodeType: string, context: FakeAudioContext, element?: unknown) {
    this.nodeType = nodeType;
    this.context = context;
    this.element = element;
    context.register(this);
  }

  connect(dest: FakeNode): FakeNode {
    this.connectedTo.push(dest);
    return dest;
  }

  disconnect(): void {
    this.connectedTo = [];
  }

  getByteFrequencyData(arr: Uint8Array): void {
    arr.fill(0);
  }
  getByteTimeDomainData(arr: Uint8Array): void {
    arr.fill(128);
  }
  getFloatFrequencyData(arr: Float32Array): void {
    arr.fill(0);
  }
}

class FakeBuffer {
  public readonly numberOfChannels: number;
  public readonly length: number;
  public readonly sampleRate: number;
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }
  getChannelData(_channel: number): Float32Array {
    return new Float32Array(this.length);
  }
}

class FakeAudioContext {
  public sampleRate = 48000;
  public currentTime = 0;
  public state = 'running';
  public destination: FakeNode;
  public readonly nodes: FakeNode[] = [];
  public readonly sourceByElement = new Map<unknown, FakeNode[]>();

  constructor(_opts?: unknown) {
    this.destination = new FakeNode('destination', this);
    this.nodes.push(this.destination);
  }

  register(node: FakeNode): void {
    this.nodes.push(node);
  }

  createMediaElementSource(el: unknown): FakeNode {
    const node = new FakeNode('MediaElementSource', this, el);
    const list = this.sourceByElement.get(el) || [];
    list.push(node);
    this.sourceByElement.set(el, list);
    return node;
  }
  createGain(): FakeNode {
    return new FakeNode('Gain', this);
  }
  createStereoPanner(): FakeNode {
    return new FakeNode('StereoPanner', this);
  }
  createAnalyser(): FakeNode {
    return new FakeNode('Analyser', this);
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode('BiquadFilter', this);
  }
  createDelay(): FakeNode {
    return new FakeNode('Delay', this);
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode('DynamicsCompressor', this);
  }
  createConvolver(): FakeNode {
    return new FakeNode('Convolver', this);
  }
  createChannelMerger(_n?: number): FakeNode {
    return new FakeNode('ChannelMerger', this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeMediaElement(id: string): HTMLAudioElement {
  return { __id: id } as unknown as HTMLAudioElement;
}

let savedAudioContext: unknown;

beforeEach(() => {
  savedAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = savedAudioContext;
});

function getInternal(mgr: PlayerAudioManager): Record<string, unknown> {
  return mgr as unknown as Record<string, unknown>;
}

function ctxOf(mgr: PlayerAudioManager): FakeAudioContext {
  return getInternal(mgr).audioContext as FakeAudioContext;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. VOLUME
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — volume', () => {
  it('maps setVolume to actual gainNode.gain.value', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const gain = getInternal(mgr).gainNode as FakeNode;

    await mgr.setVolume(0.25);
    expect(gain.gain.value).toBeCloseTo(0.25);

    await mgr.setVolume(0);
    expect(gain.gain.value).toBeCloseTo(0);

    await mgr.setVolume(1);
    expect(gain.gain.value).toBeCloseTo(1);

    // clamp above 1
    await mgr.setVolume(2);
    expect(gain.gain.value).toBeCloseTo(1);
  });

  it('does not change gain while muted (only stores volume)', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const gain = getInternal(mgr).gainNode as FakeNode;

    await mgr.setMuted(true);
    await mgr.setVolume(0.4);
    expect(gain.gain.value).toBeCloseTo(0);
    expect(mgr.getSettings().volume).toBeCloseTo(0.4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. MUTE
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — mute', () => {
  it('toggles gain and restores previous audible gain', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const gain = getInternal(mgr).gainNode as FakeNode;

    await mgr.setVolume(0.25);
    expect(gain.gain.value).toBeCloseTo(0.25);

    await mgr.setMuted(true);
    expect(gain.gain.value).toBeCloseTo(0);
    expect(mgr.getSettings().muted).toBe(true);

    await mgr.setMuted(false);
    expect(gain.gain.value).toBeCloseTo(0.25);
    expect(mgr.getSettings().muted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. BALANCE
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — balance', () => {
  it('maps to StereoPannerNode.pan.value', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const panner = getInternal(mgr).stereoPanner as FakeNode;

    await mgr.setBalance(-1);
    expect(panner.pan.value).toBeCloseTo(-1);

    await mgr.setBalance(0);
    expect(panner.pan.value).toBeCloseTo(0);

    await mgr.setBalance(1);
    expect(panner.pan.value).toBeCloseTo(1);

    await mgr.setBalance(5);
    expect(panner.pan.value).toBeCloseTo(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. EQ 10-BAND
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — 10-band EQ', () => {
  const FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  it('updates all ten BiquadFilterNodes and keeps canonical frequency/Q/type', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const filters = getInternal(mgr).eqFilters as FakeNode[];
    expect(filters.length).toBe(10);

    const gains = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    await mgr.setEqualizer(gains);

    filters.forEach((f, i) => {
      expect(f.gain.value).toBeCloseTo(gains[i]);
      expect(f.frequency.value).toBeCloseTo(FREQS[i]);
      expect(f.Q.value).toBeCloseTo(1.4);
      expect(f.type).toBe('peaking');
    });
  });

  it('rejects non-10-band input', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    await expect(mgr.setEqualizer([1, 2, 3])).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. DSP ENABLE / DISABLE  (real graph teardown + rebuild)
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — DSP enable/disable', () => {
  it('disable detaches the real graph; re-attach rebuilds it', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    expect(mgr.isAttached()).toBe(true);
    const ctx = ctxOf(mgr);
    const nodesBefore = ctx.nodes.length;
    expect(nodesBefore).toBeGreaterThan(0);

    await mgr.enableDSP(false);
    expect(mgr.isAttached()).toBe(false);
    expect(getInternal(mgr).audioContext).toBeNull();
    expect(getInternal(mgr).gainNode).toBeNull();

    // re-enable (rebuild)
    mgr.attachToMediaElement(makeMediaElement('v'));
    expect(mgr.isAttached()).toBe(true);
    expect(ctxOf(mgr).nodes.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. EFFECT ENABLE / DISABLE  (bass-boost)
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — effect enable/disable', () => {
  it('bass-boost OFF -> ON -> OFF changes real graph topology', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const internal = getInternal(mgr);
    const effectNodes = internal.effectNodes as Map<string, FakeNode>;
    const panner = internal.stereoPanner as FakeNode;
    const analyser = internal.analyser as FakeNode;

    // OFF (initial)
    expect(effectNodes.has('bass-boost')).toBe(false);
    expect(panner.connectedTo).toContain(analyser);

    // ON
    await mgr.setEffect('bass-boost', { amount: 80, frequency: 100 });
    expect(effectNodes.has('bass-boost')).toBe(true);
    const node = effectNodes.get('bass-boost') as FakeNode;
    expect(node.nodeType).toBe('BiquadFilter');
    expect(node.type).toBe('lowshelf');
    expect(node.frequency.value).toBeCloseTo(100);
    expect(node.gain.value).toBeCloseTo(8.0);
    expect(panner.connectedTo).toContain(node);
    expect(node.connectedTo).toContain(analyser);

    // OFF again
    await mgr.removeEffect('bass-boost');
    expect(effectNodes.has('bass-boost')).toBe(false);
    expect(panner.connectedTo).not.toContain(node);
    expect(node.connectedTo).not.toContain(analyser);
    expect(panner.connectedTo).toContain(analyser);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. EFFECT PARAMETERS  (bass-boost single node + surround composite)
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — effect parameters', () => {
  it('bass-boost amount maps to lowshelf gain', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const effectNodes = getInternal(mgr).effectNodes as Map<string, FakeNode>;

    await mgr.setEffect('bass-boost', { amount: 60, frequency: 100 });
    expect((effectNodes.get('bass-boost') as FakeNode).gain.value).toBeCloseTo(6.0);

    await mgr.setEffect('bass-boost', { amount: 120, frequency: 100 });
    const node = effectNodes.get('bass-boost') as FakeNode;
    expect(node.gain.value).toBeCloseTo(12.0);
  });

  it('surround (composite) delay param maps to DelayNode.delayTime', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const effectNodes = getInternal(mgr).effectNodes as Map<string, FakeNode>;

    await mgr.setEffect('surround', { delay: 30, width: 75 });
    const d1 = effectNodes.get('surround') as FakeNode;
    expect(d1.nodeType).toBe('Delay');
    expect(d1.delayTime.value).toBeCloseTo(0.03);

    await mgr.setEffect('surround', { delay: 50, width: 75 });
    const d2 = effectNodes.get('surround') as FakeNode;
    expect(d2.delayTime.value).toBeCloseTo(0.05);
  });

  it('reverb builds a processing node graph', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const effectNodes = getInternal(mgr).effectNodes as Map<string, FakeNode>;

    await mgr.setEffect('reverb', { room: 30, damp: 50, wet: 25 });
    const merger = effectNodes.get('reverb') as FakeNode;
    expect(merger.nodeType).toBe('ChannelMerger');
    expect(merger.connectedTo.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. MEDIA SWITCH
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — media switch', () => {
  it('detaches old source, connects new source, no duplicate per element', async () => {
    const mgr = new PlayerAudioManager();
    const internal = getInternal(mgr);

    const A = makeMediaElement('A');
    const B = makeMediaElement('B');

    mgr.attachToMediaElement(A);
    const ctxA = ctxOf(mgr);
    const sourceA = internal.sourceNode as FakeNode;
    expect(sourceA.element).toBe(A);
    expect((ctxA as FakeAudioContext).sourceByElement.get(A)?.length).toBe(1);

    mgr.attachToMediaElement(B);
    const ctxB = ctxOf(mgr);
    const sourceB = internal.sourceNode as FakeNode;
    expect(sourceB.element).toBe(B);
    // no duplicate source for either element (within each active context)
    expect((ctxA as FakeAudioContext).sourceByElement.get(A)?.length).toBe(1);
    expect((ctxB as FakeAudioContext).sourceByElement.get(B)?.length).toBe(1);
    // old source detached, new source connected onward
    expect(sourceA.connectedTo).toHaveLength(0);
    expect(sourceB.connectedTo.length).toBeGreaterThan(0);
    expect(sourceB).not.toBe(sourceA);

    // controls still update the active graph after switch
    const gain = internal.gainNode as FakeNode;
    await mgr.setVolume(0.5);
    expect(gain.gain.value).toBeCloseTo(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. AUDIOCONTEXT FALLBACK  (no AudioContext)
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — AudioContext fallback', () => {
  it('degrades safely without AudioContext; control methods do not corrupt state', () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;

    const mgr = new PlayerAudioManager();

    // attach must not leave partial state / must not mark Web Audio active
    expect(() => mgr.attachToMediaElement(makeMediaElement('v'))).toThrow();
    expect(mgr.isAttached()).toBe(false);
    expect(getInternal(mgr).audioContext).toBeNull();
    expect(getInternal(mgr).gainNode).toBeNull();

    // control methods remain safe and update settings state
    expect(() => {
      void mgr.setVolume(0.5);
      void mgr.setMuted(true);
      void mgr.setBalance(0.5);
      void mgr.setEqualizer(new Array(10).fill(2));
    }).not.toThrow();

    expect(mgr.getSettings().volume).toBeCloseTo(0.5);
    expect(mgr.getSettings().muted).toBe(true);
    expect(mgr.getSettings().balance).toBeCloseTo(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerAudioManager — cleanup', () => {
  it('detach disconnects nodes, closes context, idempotent', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeMediaElement('v'));
    const internal = getInternal(mgr);
    const ctx = ctxOf(mgr);
    const gain = internal.gainNode as FakeNode;
    const panner = internal.stereoPanner as FakeNode;

    mgr.detach();
    expect(gain.connectedTo).toHaveLength(0);
    expect(panner.connectedTo).toHaveLength(0);
    expect(ctx.state).toBe('closed');
    expect(internal.audioContext).toBeNull();
    expect(internal.isInitialized).toBe(false);

    // second detach must not throw
    expect(() => mgr.detach()).not.toThrow();
  });
});
