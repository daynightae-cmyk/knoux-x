import {
  colourRamp,
  contrastRatio,
  evaluateContrast,
  extractPalette,
  parseHex,
  relativeLuminance,
  toHex,
} from '../../src/core/creative/paletteExtraction';
import {
  decodeWav,
  encodeWav,
  pcmDurationSeconds,
  resampleLinear,
  toMono,
} from '../../src/core/creative/wavEncode';

function solid(r: number, g: number, b: number, a = 255) {
  return { r, g, b, a };
}

function pixelField(colours: Array<{ r: number; g: number; b: number; a: number }>): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(colours.length * 4);
  colours.forEach((colour, index) => {
    data[index * 4] = colour.r;
    data[index * 4 + 1] = colour.g;
    data[index * 4 + 2] = colour.b;
    data[index * 4 + 3] = colour.a;
  });
  return { data, width: colours.length, height: 1 };
}

describe('palette extraction', () => {
  test('the dominant colour wins the first slot', () => {
    const colours = [
      ...Array.from({ length: 60 }, () => solid(200, 40, 40)),
      ...Array.from({ length: 30 }, () => solid(30, 180, 90)),
      ...Array.from({ length: 10 }, () => solid(40, 60, 200)),
    ];
    const palette = extractPalette(pixelField(colours), { count: 3, granularity: 16 });
    expect(palette).toHaveLength(3);
    const first = parseHex(palette[0].hex)!;
    expect(first.r).toBeGreaterThan(first.g);
    expect(palette[0].share).toBeGreaterThan(0.4);
  });

  test('a saturated minority survives next to a large flat area', () => {
    const colours = [
      ...Array.from({ length: 80 }, () => solid(128, 128, 128)),
      ...Array.from({ length: 8 }, () => solid(250, 20, 120)),
    ];
    const palette = extractPalette(pixelField(colours), { count: 3, granularity: 8 });
    expect(palette.some((swatch) => swatch.hex === '#fa1478')).toBe(true);
  });

  test('transparent pixels are skipped so a cut-out does not win by area', () => {
    const palette = extractPalette(pixelField([
      ...Array.from({ length: 50 }, () => solid(0, 0, 0, 0)),
      ...Array.from({ length: 10 }, () => solid(255, 255, 255, 255)),
    ]), { count: 2 });
    expect(palette[0].hex).toBe('#ffffff');
  });

  test('an empty frame yields no swatches rather than a black one', () => {
    expect(extractPalette({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toEqual([]);
  });

  test('shares add up to a plausible fraction of what was sampled', () => {
    const palette = extractPalette(pixelField(Array.from({ length: 120 }, (_, index) => solid(index % 3 === 0 ? 250 : 20, 30, 90))), { count: 4, granularity: 32 });
    const total = palette.reduce((sum, swatch) => sum + swatch.share, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(1.0001);
  });

  test('colourRamp goes dark → source → light and keeps the source in the middle', () => {
    const ramp = colourRamp('#8b3dff', 5);
    expect(ramp).toHaveLength(5);
    expect(ramp[2]).toBe('#8b3dff');
    expect(parseHex(ramp[0])!.r).toBeLessThan(parseHex(ramp[4])!.r);
  });
});

describe('contrast maths', () => {
  test('WCAG reference values hold', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 4);
    expect(relativeLuminance(0, 0, 0)).toBe(0);
  });

  test('AA and AAA thresholds are reported separately for normal and large text', () => {
    const grey = evaluateContrast('#767676', '#ffffff');
    expect(grey.normalAA).toBe(true);
    expect(grey.normalAAA).toBe(false);
    const pale = evaluateContrast('#cccccc', '#ffffff');
    expect(pale.normalAA).toBe(false);
    expect(pale.largeAA).toBe(false);
    expect(grey.largeAA).toBe(true);
  });

  test('an unparseable colour degrades to a safe ratio instead of throwing', () => {
    expect(contrastRatio('not-a-colour', '#ffffff')).toBe(1);
    expect(parseHex('rebecca')).toBeNull();
  });

  test('three-digit hex expands the way CSS does', () => {
    expect(toHex(255, 255, 255)).toBe('#ffffff');
    expect(parseHex('#f0a')!.g).toBe(0);
    expect(parseHex('#ff00aa')!.g).toBe(0);
  });
});

describe('wav encoding', () => {
  test('a round trip keeps samples, rate and channel count', () => {
    const source = {
      channels: [Float32Array.from([0, 0.25, -0.5, 1, -1]), Float32Array.from([0.5, 0.5, 0.5, 0.5, 0.5])],
      sampleRate: 48_000,
    };
    const bytes = encodeWav(source, { bitDepth: 16 });
    const decoded = decodeWav(bytes);
    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.channels).toHaveLength(2);
    expect(decoded.channels[0].length).toBe(5);
    expect(decoded.channels[0][1]).toBeCloseTo(0.25, 3);
    expect(decoded.channels[0][3]).toBeCloseTo(1, 3);
    expect(decoded.channels[0][4]).toBeCloseTo(-1, 3);
  });

  test('the header is a real RIFF/WAVE with a PCM format chunk', () => {
    const bytes = encodeWav({ channels: [new Float32Array([0])], sampleRate: 44_100 });
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('RIFF');
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe('WAVE');
    expect(String.fromCharCode(bytes[36], bytes[37], bytes[38], bytes[39])).toBe('data');
    expect(bytes.length).toBe(46); // 44-byte header + one stereo-free 16-bit frame
  });

  test('8-bit output is unsigned and centred on 128', () => {
    const bytes = encodeWav({ channels: [Float32Array.from([0, 1, -1])], sampleRate: 8_000 }, { bitDepth: 8 });
    expect(bytes[44]).toBe(128);
    expect(bytes[45]).toBe(255);
    expect(bytes[46]).toBe(0);   // -1.0 maps to the bottom of the unsigned range
    const decoded = decodeWav(bytes);
    expect(decoded.bitDepth).toBe(8);
    expect(decoded.channels[0][0]).toBeCloseTo(0, 2);
  });

  test('clipping is honest: out-of-range samples land on the ceiling', () => {
    const bytes = encodeWav({ channels: [Float32Array.from([4, -4])], sampleRate: 8_000 });
    const decoded = decodeWav(bytes);
    expect(decoded.channels[0][0]).toBeCloseTo(1, 3);
    expect(decoded.channels[0][1]).toBeCloseTo(-1, 3);
  });

  test('resampling changes the frame count and keeps the shape', () => {
    const input = Float32Array.from([0, 1, 0, -1]);
    const up = resampleLinear(input, 8_000, 16_000);
    expect(up.length).toBe(8);
    expect(resampleLinear(input, 8_000, 8_000)).toBe(input);
  });

  test('mono downmix averages the channels', () => {
    const mixed = toMono({ channels: [Float32Array.from([1, 0]), Float32Array.from([-1, 1])], sampleRate: 8_000 });
    expect(mixed.channels).toHaveLength(1);
    expect(mixed.channels[0][0]).toBeCloseTo(0, 5);
    expect(mixed.channels[0][1]).toBeCloseTo(0.5, 5);
    expect(toMono(mixed)).toBe(mixed);
  });

  test('duration follows the frame count, not the byte count', () => {
    expect(pcmDurationSeconds({ channels: [new Float32Array(48_000)], sampleRate: 48_000 })).toBe(1);
    expect(pcmDurationSeconds({ channels: [new Float32Array(10)], sampleRate: 0 })).toBe(0);
  });

  test('silence and empty input are refused, not written as a broken file', () => {
    expect(() => encodeWav({ channels: [], sampleRate: 44_100 })).toThrow(/no audio/i);
    expect(() => encodeWav({ channels: [new Float32Array(0)], sampleRate: 44_100 })).toThrow(/no audio/i);
  });

  test('a non-PCM or non-RIFF buffer is rejected with a reason', () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/RIFF/i);
  });
});
