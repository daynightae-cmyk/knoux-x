import { DSPSystemManager } from '../../src/core/dsp/DSPSystemManager';

describe('DSPSystemManager runtime compatibility', () => {
  let originalAudioContext: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: undefined,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalAudioContext) {
      Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
    } else {
      Reflect.deleteProperty(globalThis, 'AudioContext');
    }
  });

  test('continues with software DSP when Web Audio is unavailable in the host process', async () => {
    const dsp = new DSPSystemManager({ enabled: true, quality: 'high' });

    await expect(dsp.initialize()).resolves.toBeUndefined();

    expect(dsp.isEnabled()).toBe(true);
    expect(dsp.getAllEffects()).toHaveLength(5);
    await expect(dsp.shutdown()).resolves.toBeUndefined();
  });
});
