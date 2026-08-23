/**
 * Post-merge PR29 review regression tests
 * Covers 5 required scenarios:
 * 1. effect OFF uses removeEffect (graph returns to direct path)
 * 2. effect-change payload contract canonical
 * 3. media switch clears subtitle state
 * 4. startup media beats workspace restore
 * 5. normal launch still restores saved workspace
 */

/* eslint-disable @typescript-eslint/no-explicit-any, import/order */
import * as fs from 'fs';
import * as path from 'path';
import { PlayerAudioManager } from '../../src/features/player/PlayerAudioManager';

// ── Fake AudioContext for 1+2 ───────────────────────────────────────────
class FakeParam {
  public value = 0;
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v: number) { this.value = v; return this; }
}
class FakeNode {
  public type = 'peaking';
  public gain = new FakeParam();
  public pan = new FakeParam();
  public frequency = new FakeParam();
  public Q = new FakeParam();
  public delayTime = new FakeParam();
  public threshold = new FakeParam();
  public ratio = new FakeParam();
  public knee = new FakeParam();
  public attack = new FakeParam();
  public release = new FakeParam();
  public buffer: unknown = null;
  public fftSize = 256;
  public smoothingTimeConstant = 0.8;
  public frequencyBinCount = 128;
  public connectedTo: FakeNode[] = [];
  constructor(public nodeType: string, public context: FakeAudioContext, public element?: unknown) { context.register(this); }
  connect(dest: FakeNode) { this.connectedTo.push(dest); return dest; }
  disconnect() { this.connectedTo = []; }
  getByteFrequencyData(a: Uint8Array) { a.fill(0); }
  getByteTimeDomainData(a: Uint8Array) { a.fill(0); }
  getFloatFrequencyData(a: Float32Array) { a.fill(0); }
}
class FakeBuffer {
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {}
  getChannelData() { return new Float32Array(this.length); }
}
class FakeAudioContext {
  public sampleRate = 48000; public currentTime = 0; public state = 'running';
  public destination: FakeNode;
  public nodes: FakeNode[] = [];
  public sourceByElement = new Map<unknown, FakeNode[]>();
  constructor() { this.destination = new FakeNode('destination', this); this.nodes.push(this.destination); }
  register(n: FakeNode) { this.nodes.push(n); }
  createMediaElementSource(el: unknown) {
    const n = new FakeNode('MediaElementSource', this, el);
    const l = this.sourceByElement.get(el) || []; l.push(n); this.sourceByElement.set(el, l); return n;
  }
  createGain() { return new FakeNode('Gain', this); }
  createStereoPanner() { return new FakeNode('StereoPanner', this); }
  createAnalyser() { return new FakeNode('Analyser', this); }
  createBiquadFilter() { return new FakeNode('BiquadFilter', this); }
  createDelay() { return new FakeNode('Delay', this); }
  createDynamicsCompressor() { return new FakeNode('DynamicsCompressor', this); }
  createConvolver() { return new FakeNode('Convolver', this); }
  createChannelMerger() { return new FakeNode('ChannelMerger', this); }
  createBuffer(c: number, l: number, s: number) { return new FakeBuffer(c, l, s) as unknown as AudioBuffer; }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

function makeEl(id: string) { return { __id: id } as unknown as HTMLMediaElement; }
let savedCtx: unknown;
beforeEach(() => { savedCtx = (globalThis as any).AudioContext; (globalThis as any).AudioContext = FakeAudioContext; });
afterEach(() => { (globalThis as any).AudioContext = savedCtx; });
function getInternal(m: PlayerAudioManager): any { return m as any; }

// 1. EFFECT OFF uses removeEffect
describe('post-merge PR29: effect OFF uses removeEffect', () => {
  it('OFF removes node and graph returns to direct path (not recreating with defaults)', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeEl('v'));
    const internal = getInternal(mgr);
    const panner = internal.stereoPanner as FakeNode;
    const analyser = internal.analyser as FakeNode;

    // ON
    await mgr.setEffect('bass-boost', { amount: 50, frequency: 100 });
    expect(internal.effectNodes.has('bass-boost')).toBe(true);
    const node = internal.effectNodes.get('bass-boost') as FakeNode;
    expect(panner.connectedTo).toContain(node);
    expect(node.connectedTo).toContain(analyser);

    // OFF via removeEffect (production path)
    await mgr.removeEffect('bass-boost');
    expect(internal.effectNodes.has('bass-boost')).toBe(false);
    expect(internal.effectNodes.size).toBe(0);
    // graph must be direct: panner -> analyser, no orphan
    expect(panner.connectedTo).toContain(analyser);
    expect(panner.connectedTo).not.toContain(node);
    expect(node.connectedTo).not.toContain(analyser);
  });

  it('PlayerView toggle OFF now calls removeEffect (source check)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/features/player/PlayerView.tsx'), 'utf8');
    expect(source).toContain('removeEffect(effectId)');
    // must NOT call setEffect with empty object for OFF
    // The OFF branch should be: if (activeEffect === effectId) { void audioManagerRef.current?.removeEffect
    const offBranch = source.match(/if\s*\(\s*activeEffect\s*===\s*effectId\s*\)\s*\{[^}]+\}/s);
    expect(offBranch).not.toBeNull();
    expect(offBranch![0]).toContain('removeEffect');
    expect(offBranch![0]).not.toContain('setEffect(effectId, {})');
  });
});

// 2. EFFECT-CHANGE contract
describe('post-merge PR29: effect-change canonical contract', () => {
  it('setEffect emits {effectId, enabled:true, params:object}', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeEl('v'));
    const payloads: any[] = [];
    mgr.on('effect-change', (p) => payloads.push(p));
    await mgr.setEffect('bass-boost', { amount: 50, frequency: 100 });
    expect(payloads.length).toBe(1);
    expect(payloads[0]).toEqual({ effectId: 'bass-boost', enabled: true, params: { amount: 50, frequency: 100 } });
    expect(typeof payloads[0].enabled).toBe('boolean');
    expect(typeof payloads[0].params).toBe('object');
    expect(payloads[0].params).not.toBeNull();
  });
  it('removeEffect emits {effectId, enabled:false, params:{}}', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeEl('v'));
    await mgr.setEffect('bass-boost', { amount: 50 });
    const payloads: any[] = [];
    mgr.on('effect-change', (p) => payloads.push(p));
    await mgr.removeEffect('bass-boost');
    expect(payloads.length).toBe(1);
    expect(payloads[0]).toEqual({ effectId: 'bass-boost', enabled: false, params: {} });
    expect(payloads[0].enabled).toBe(false);
    expect(typeof payloads[0].params).toBe('object');
    expect(payloads[0].params).not.toBeNull();
  });
  it('both payloads share same keys (no null deref)', async () => {
    const mgr = new PlayerAudioManager();
    mgr.attachToMediaElement(makeEl('v'));
    const all: any[] = [];
    mgr.on('effect-change', (p) => all.push(p));
    await mgr.setEffect('surround', { width: 75 });
    await mgr.removeEffect('surround');
    expect(all[0].enabled).toBe(true);
    expect(all[1].enabled).toBe(false);
    expect(Object.keys(all[0]).sort()).toEqual(Object.keys(all[1]).sort());
  });
});

// 3. MEDIA SWITCH subtitle reset
describe('post-merge PR29: media switch subtitle reset', () => {
  it('PlayerView resets subtitle when currentMedia changes (source check)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/features/player/PlayerView.tsx'), 'utf8');
    // must have effect that watches currentMedia and clears subtitle
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*setSubtitle\(null\);\s*\},\s*\[currentMedia\]\)/);
  });
});

// 4 & 5. WORKSPACE RESTORATION PRIORITY
describe('post-merge PR29: startup media priority vs workspace', () => {
  const appPath = path.join(__dirname, '../../src/App.tsx');
  const appSource = () => fs.readFileSync(appPath, 'utf8');
  it('App guards workspace restoration with startupMediaHandledRef', () => {
    const s = appSource();
    expect(s).toContain('startupMediaHandledRef');
    expect(s).toContain('if (startupMediaHandledRef.current)');
  });
  it('App sets startupMediaHandledRef on successful probe', () => {
    const s = appSource();
    expect(s).toMatch(/startupMediaHandledRef\.current\s*=\s*true/);
  });
  it('normal launch still restores lastOpenedSection when no startup media', () => {
    const s = appSource();
    // The guard must be conditional, not unconditional skip
    // Ensure the normal path still calls setView(workspace.lastOpenedSection)
    expect(s).toContain("setView(workspace.lastOpenedSection as ViewType)");
    // Ensure guard returns early only when handled
    const guardBlock = s.match(/if\s*\(\s*startupMediaHandledRef\.current\s*\)\s*\{[^}]+\}/s);
    expect(guardBlock).not.toBeNull();
  });
});
